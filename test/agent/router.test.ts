import { expect } from 'chai';
import express from 'express';
import http from 'http';
import supertest from 'supertest';
import { EngineError, EngineRegistry, issueScopedToken, stubAgentEngine, stubDecisionEngine } from '../../src/formflow';
import { AgentRouter, FormAgentRouter, agentCredentials } from '../../src/agent/router';
import { auth as fullAuth, claimForm, makeProject, requireTestLicense } from './fixtures';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { loadUAGEngines } from '../../src/agent/engines';
// The engine reports its package's version, which moves with every release.
const jevVersion: string = require('../../engines/jev/package.json').version;

// Each test starts a fresh server on an ephemeral port. With Node's default
// keep-alive agent, a pooled socket to an earlier server on a reused port can
// carry a request to the wrong app, so these tests disable keep-alive.
http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * One server on 127.0.0.1, bound before any test, that hands each request to
 * the app of the request being made. supertest's own servers listen on every
 * interface (`::`); a random port they pick can also be held on 127.0.0.1 by
 * another local process (browser helpers hold many), which then answers.
 */
let current: express.Express | null = null;
const shared = http.createServer((req, res) => current!(req, res));
before((done) => { shared.listen(0, '127.0.0.1', done); });
after((done) => { shared.close(() => done()); });
function request(app: express.Express) {
    current = app;
    return supertest(shared);
}

/**
 * An Express app whose responses close their connection, so no client can keep
 * a socket to it that a later test's server (on the same port) would receive.
 */
function testServer() {
    const server = express();
    server.use((_req, res, next) => { res.set('Connection', 'close'); next(); });
    return server;
}

/**
 * The Agent API as the UAG mounts it: capabilities at the root, and each form's
 * operations under the form's path, after the project's authentication (here,
 * `auth`). `credentials` stands in for, or is, the agent credential check.
 */
function mount(project: any, auth: any, credentials: any) {
    const server = testServer();
    const authenticate = (req: any, _res: any, next: any) => { req.auth = auth; next(); };
    server.use(AgentRouter(project, authenticate));
    server.use('/:form', authenticate, (req: any, res: any, next: any) => {
        req.form = project.forms[req.params.form];
        if (!req.form) return res.status(404).json({ notFound: true });
        next();
    }, FormAgentRouter(project, credentials));
    return server;
}

function app(project: any, auth: any = fullAuth) {
    return mount(project, auth, (_req: any, _res: any, next: any) => next());
}

/** With the real agent credential check, behind the project's authentication of `auth`. */
function credentialApp(project: any, auth: any = {}) {
    return mount(project, auth, agentCredentials(project));
}

function setup(engines: any[], config: any = {}) {
    const project: any = makeProject({ claim: claimForm() });
    project.engines = new EngineRegistry(engines);
    project.agentConfig = config;
    // The shared mock returns template names; the API needs real MCP content.
    project.mcpJSONResponse = UAGProjectInterface.prototype.mcpJSONResponse.bind(project);
    project.mcpResponse = UAGProjectInterface.prototype.mcpResponse.bind(project);
    const form: any = project.forms.claim;
    form.saved = [];
    form.validateData = async () => [];
    form.submit = async (submission: any) => { form.saved.push(submission); return { ...submission, modified: 'now' }; };
    return { project, form };
}

/** Parse an SSE body into events. */
function events(text: string) {
    return text.trim().split('\n\n').map((block) => {
        const event = /event: (.*)/.exec(block)?.[1];
        const data = JSON.parse(/data: (.*)/.exec(block)?.[1] || 'null');
        return { event, data };
    });
}

const description = { lossDescription: 'Someone rear-ended me on I-35 yesterday.' };

/**
 * The Agent API's HTTP adapters: how requests reach Agentic Formflow in
 * @formio/appserver-core and how its results and errors are answered. The
 * behavior behind each endpoint is tested in appserver-core.
 */
describe('Agent API', () => {
    describe('authentication and authorization', () => {
        it('returns 401 without a credential, calling no engine', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            const res = await request(credentialApp(project)).post('/claim/agent/extract').send({ data: description });
            expect(res.status).to.equal(401);
            expect(jev.calls).to.equal(0);
        });

        it('runs as the user the project authenticated (a Form.io user token)', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(credentialApp(project, fullAuth)).post('/claim/agent/decide').send({ data: description });
            expect(res.status, res.text).to.equal(200);
        });

        it('verifies a UAG bearer token, keeping the form of the URL', async () => {
            const { project } = setup([stubDecisionEngine()]);
            let seen: any;
            project.authorizeRequest = (req: any, _res: any, next: any) => { seen = req; req.auth = { ...fullAuth }; next(); };
            const res = await request(credentialApp(project)).post('/claim/agent/decide').set('Authorization', 'Bearer uag-token').send({ data: description });
            expect(res.status, res.text).to.equal(200);
            expect(seen.auth.form).to.equal(project.forms.claim);
        });

        it('returns 403 and calls no engine when the caller cannot fill in the form', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            const noAccess = { ...fullAuth, formPermissions: () => ({ create: false, read: false, update: false }) };
            const res = await request(app(project, noAccess)).post('/claim/agent/extract').send({ data: description });
            expect(res.status).to.equal(403);
            expect(jev.calls).to.equal(0);
        });
    });

    describe('anonymous use', () => {
        const anonymous = { formPermissions: () => ({ create: true, read: true, update: false }) };
        const optIn = (project: any) => { project.forms.claim.form.properties = { uagAnonymous: 'true' }; };

        it('runs for an anonymous caller on a form that opts in and lets Anonymous create', async () => {
            const { project } = setup([stubDecisionEngine()]);
            optIn(project);
            const res = await request(credentialApp(project, anonymous)).post('/claim/agent/decide').send({ data: description });
            expect(res.status, res.text).to.equal(200);
        });

        it('refuses an anonymous caller on a form that does not opt in, calling no engine', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            const res = await request(credentialApp(project, anonymous)).post('/claim/agent/decide').send({ data: description });
            expect(res.status).to.equal(401);
            expect(jev.calls).to.equal(0);
        });

        it('refuses an anonymous caller when Anonymous may not create, calling no engine', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            optIn(project);
            const res = await request(credentialApp(project, { formPermissions: () => ({ create: false, read: true, update: true }) })).post('/claim/agent/decide').send({ data: description });
            expect(res.status).to.equal(403);
            expect(jev.calls).to.equal(0);
        });

        it('limits anonymous callers, without limiting signed-in users', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            optIn(project);
            project.agentConfig = { agentApi: { anonymous: { rateLimit: 2, totalRateLimit: 100 } } };
            const server = credentialApp(project, anonymous);
            for (let i = 0; i < 2; i++) expect((await request(server).post('/claim/agent/decide').send({ data: description })).status).to.equal(200);
            const calls = jev.calls;
            const refused = await request(server).post('/claim/agent/decide').send({ data: description });
            expect(refused.status).to.equal(429);
            expect(refused.get('retry-after')).to.match(/^\d+$/);
            expect(jev.calls).to.equal(calls);
            const signedIn = await request(credentialApp(project, fullAuth)).post('/claim/agent/decide').send({ data: description });
            expect(signedIn.status).to.equal(200);
        });

        it('turns anonymous use off when a limit is 0', async () => {
            const { project } = setup([stubDecisionEngine()]);
            optIn(project);
            project.agentConfig = { agentApi: { anonymous: { rateLimit: 0 } } };
            const res = await request(credentialApp(project, anonymous)).post('/claim/agent/decide').send({ data: description });
            expect(res.status).to.equal(401);
        });
    });

    describe('errors', () => {
        it('returns 404 for a form not tagged "uag", calling no engine', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            // The tag removed: the form is the project's, but not exposed to agents.
            project.forms.claim.uag = null;
            const res = await request(app(project)).post('/claim/agent/extract').send({ data: description });
            expect(res.status).to.equal(404);
            expect(res.body.error).to.contain('claim').and.contain('uag');
            expect(jev.calls).to.equal(0);
        });

        it('takes the form from the URL, not the body', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/claim/agent/decide').send({ form: 'nope', data: description });
            expect(res.status, res.text).to.equal(200);
            expect(res.body.tasks).to.deep.equal(['triage']);
        });

        it('returns 400 for an unknown task, listing the form\'s tasks', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/claim/agent/extract').send({ task: 'finance', data: {} });
            expect(res.status).to.equal(400);
            expect(res.body.error).to.contain('finance').and.contain('triage');
        });

        it('returns 503 when no enabled engine can serve the operation', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/claim/agent/generate').send({ task: 'triage', data: description });
            expect(res.status).to.equal(503);
            expect(res.body.error).to.contain('generate');
        });

        it('returns 404 for the removed /agent/run', async () => {
            const { project } = setup([stubAgentEngine()]);
            const server = app(project);
            server.use((_req: any, res: any) => res.status(404).json({ notFound: true }));
            const res = await request(server).post('/agent/run').send({ instructions: 'hello' });
            expect(res.status).to.equal(404);
        });

        it('returns 429 with Retry-After when the caller is over its limit', async () => {
            const { project } = setup([stubDecisionEngine()], { agentApi: { rateLimits: { caller: { extract: { limit: 1 } } } } });
            const server = app(project);
            expect((await request(server).post('/claim/agent/extract').send({ data: description })).status).to.equal(200);
            const res = await request(server).post('/claim/agent/extract').send({ data: description });
            expect(res.status).to.equal(429);
            expect(res.get('retry-after')).to.match(/^\d+$/);
        });

        it('includes a request id on every response', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).get('/agent/capabilities').set('X-Request-Id', 'abc');
            expect(res.get('x-request-id')).to.equal('abc');
            expect(res.body.requestId).to.equal('abc');
        });

        it('replaces a request id that is not a short token with its own', async () => {
            const { project } = setup([stubDecisionEngine()]);
            for (const unsafe of ['x'.repeat(129), 'a b', '<script>alert(1)</script>']) {
                const res = await request(app(project)).get('/agent/capabilities').set('X-Request-Id', unsafe);
                expect(res.get('x-request-id'), unsafe).to.match(/^[0-9a-f-]{36}$/);
                expect(res.body.requestId).to.equal(res.get('x-request-id'));
            }
        });

        it('sends the request id on to remote engines, streamed or not', async function () {
            requireTestLicense(this);
            const seen: (string | undefined)[] = [];
            const engines = http.createServer((req, res) => {
                if (req.url !== '/v1/engines') seen.push(req.headers['x-request-id'] as string | undefined);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(req.url === '/v1/engines'
                    ? { protocol: 1, engines: [{ name: 'jev', kind: 'decision', model: 'jev-1.13.0', maxOptions: 255 }] }
                    : { protocol: 1, model: 'jev-1.13.0', answers: {} }));
            });
            await new Promise<void>((resolve) => engines.listen(0, '127.0.0.1', resolve));
            try {
                const { project } = setup([]);
                const url = `http://127.0.0.1:${(engines.address() as any).port}`;
                project.engines = await loadUAGEngines({ retries: 1 }, { UAG_ENGINES: 'jev:remote', UAG_ENGINE_JEV_URL: url, UAG_ENGINE_JEV_KEY: 'k'.repeat(32) });
                const decided = await request(app(project)).post('/claim/agent/decide').set('X-Request-Id', 'demo.ab12cd.first').send({ data: description });
                expect(decided.status, decided.text).to.equal(200);
                const streamed = await request(app(project)).post('/claim/agent/extract').set('X-Request-Id', 'demo.ab12cd.second').set('Accept', 'text/event-stream').send({ data: description });
                expect(streamed.status, streamed.text).to.equal(200);
                expect(seen).to.deep.equal(['demo.ab12cd.first', 'demo.ab12cd.second']);
            }
            finally {
                engines.closeAllConnections();
                await new Promise((resolve) => engines.close(resolve));
            }
        });
    });

    describe('GET /agent/capabilities', () => {
        it('reports each engine\'s type, package and version, and never its settings', async () => {
            const { project } = setup([]);
            project.engines = await loadUAGEngines({ engines: ['next:jev', 'triage:stub-decision'] }, { TYPESAFE_API_KEY: 'ts-secret-key' });
            const res = await request(app(project)).get('/agent/capabilities');
            expect(res.body.engines).to.deep.equal([
                { name: 'next', kind: 'decision', model: 'jev-1.13.0', type: 'jev', package: '@formio/uag-jev', version: jevVersion },
                { name: 'triage', kind: 'decision', model: 'stub-decision-1', type: 'stub-decision' },
            ]);
            expect(JSON.stringify(res.body)).to.not.include('ts-secret-key');
        });

        it('reports engines and which operations they can serve', async () => {
            const { project } = setup([stubDecisionEngine({ name: 'jev' })]);
            project.agentConfig.license = '';
            const res = await request(app(project)).get('/agent/capabilities');
            expect(res.body.engines).to.deep.equal([{ name: 'jev', kind: 'decision', model: 'stub-decision-1' }]);
            expect(res.body.operations.decide).to.deep.equal({ available: true, engines: ['jev'] });
            expect(res.body.operations.generate.available).to.equal(false);
            expect(Object.keys(res.body.operations)).to.have.members(['extract', 'decide', 'generate', 'chat']);
            // Chat needs an agent engine; a decision engine alone cannot serve it.
            expect(res.body.operations.chat).to.deep.equal({ available: false, engines: [] });
            expect(res.body).to.not.have.property('tasks');
            expect(res.body.edition).to.equal('open-source');
            // Only the stub engines, unlicensed: a local project earns no allowance of its own.
            expect(res.body.formflow).to.deep.equal({ licensed: false, allowed: true, reason: 'stub-engines' });
        });
    });

    describe('POST /agent/extract', () => {
        it('returns merged data and uniform field results without saving anything', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine({ values: { 'triage.lossDate': '2026-10-19' } })]);
            const res = await request(app(project)).post('/claim/agent/extract').send({ data: description });
            expect(res.status).to.equal(200);
            expect(res.body.fields['triage.claimType']).to.include({ status: 'confident', engine: 'stub-decision', calibrated: true });
            expect(res.body.fields['triage.lossDate']).to.include({ status: 'suggested', engine: 'stub-agent', calibrated: false });
            expect(res.body.data.triage.lossDate).to.equal('2026-10-19');
            expect(res.body.data.triage.claimTypeConfidence).to.be.a('number');
            expect(res.body.data.lossDescription).to.equal(description.lossDescription);
            expect(form.saved).to.deep.equal([]);
        });

        it('downgrades a value that fails validation', async () => {
            const { project, form } = setup([stubDecisionEngine()]);
            form.validateData = async () => [{ path: 'triage.claimType', label: 'Claim type', error: 'Not allowed' }];
            const res = await request(app(project)).post('/claim/agent/extract').send({ data: description });
            expect(res.body.fields['triage.claimType'].status).to.equal('uncertain');
            expect(res.body.errors).to.deep.equal([{ path: 'triage.claimType', label: 'Claim type', error: 'Not allowed' }]);
        });

        it('streams a fast engine\'s results before a slow engine\'s, then the merged result', async () => {
            const { project } = setup([stubDecisionEngine({ delayMs: 5 }), stubAgentEngine({ delayMs: 80, values: { 'triage.lossDate': '2026-10-19' } })]);
            const res = await request(app(project)).post('/claim/agent/extract').set('Accept', 'text/event-stream').send({ data: description });
            expect(res.get('content-type')).to.contain('text/event-stream');
            expect(res.get('x-accel-buffering')).to.equal('no');
            const list = events(res.text);
            expect(list.map((e) => `${e.event}:${e.data.kind || ''}`)).to.deep.equal(['result:decision', 'result:value', 'done:']);
            expect(list[2].data.data.triage.lossDate).to.equal('2026-10-19');
            expect(list[2].data.tasks).to.deep.equal(['triage']);
        });

        it('extracts from plain text', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/claim/agent/extract').send({ task: 'triage', text: 'My car was stolen.' });
            expect(res.status).to.equal(200);
            expect(res.body.fields).to.have.property('triage.claimType');
        });
    });

    describe('POST /agent/decide', () => {
        it('returns only decision fields for in-flight data and saves nothing', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine()]);
            const res = await request(app(project)).post('/claim/agent/decide').send({ data: description });
            expect(Object.keys(res.body.fields)).to.not.include('triage.lossDate');
            expect(res.body.fields).to.have.property('triage.claimType');
            expect(res.body.requestId).to.be.a('string');
            expect(form.saved).to.deep.equal([]);
        });

        it('answers one JSON response even when a stream is asked for', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/claim/agent/decide').set('Accept', 'text/event-stream').send({ data: description });
            expect(res.get('content-type')).to.contain('application/json');
            expect(res.body.fields).to.have.property('triage.claimType');
        });

        it('refuses a submission id with 400, saving nothing', async () => {
            const jev = stubDecisionEngine();
            const { project, form } = setup([jev]);
            form.submissions.push({ _id: 'sub1', data: { ...description } });
            const res = await request(app(project)).post('/claim/agent/decide').send({ submissionId: 'sub1' });
            expect(res.status).to.equal(400);
            expect(res.body.error).to.contain('saves nothing');
            expect(jev.calls).to.equal(0);
        });
    });

    describe('POST /agent/generate', () => {
        it('generates only value fields and saves nothing', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine({ values: { 'triage.lossDate': '2026-10-19' } })]);
            const res = await request(app(project)).post('/claim/agent/generate').send({ task: 'triage', data: description });
            expect(res.status).to.equal(200);
            expect(res.body.fields['triage.lossDate']).to.include({ status: 'suggested', value: '2026-10-19', task: 'triage' });
            expect(res.body.fields).to.not.have.property('triage.claimType');
            expect(form.saved).to.deep.equal([]);
        });
    });

    describe('legacy names', () => {
        it('does not read persona in place of task', async () => {
            const { project } = setup([stubDecisionEngine()]);
            // A persona naming no task would be refused if it were read.
            const res = await request(app(project)).post('/claim/agent/decide').send({ persona: 'finance', data: description });
            expect(res.status, res.text).to.equal(200);
            expect(res.body.tasks).to.deep.equal(['triage']);
        });
    });
});

describe('Agent API license', () => {
    /** A model-backed engine, as far as the license check can tell. */
    const realDecision = () => ({ ...stubDecisionEngine({ name: 'jev' }) });

    function production(engines: any[]) {
        const { project, form } = setup(engines);
        project.endpoint = 'https://forms.example.com';
        // Unlicensed: the fixtures' test license does not apply here.
        project.agentConfig.license = '';
        return { project, form };
    }

    it('answers 403 with the license code and edition, and calls no engine', async () => {
        const jev: any = realDecision();
        let called = false;
        jev.decide = async () => { called = true; return { model: 'x', answers: {} }; };
        const { project } = production([jev]);
        for (const [path, body] of [
            ['/claim/agent/extract', { data: description }],
            ['/claim/agent/decide', { data: description }],
            ['/claim/agent/generate', { task: 'triage', data: description }],
        ] as const) {
            const res = await request(app(project)).post(path).send(body);
            expect(res.status, path).to.equal(403);
            expect(res.body).to.include({ code: 'license_required', edition: 'open-source' });
            expect(res.body.error).to.contain('that includes the UAG');
            expect(res.body.requestId).to.be.a('string');
        }
        expect(called).to.equal(false);
    });

    it('reports the edition on capabilities, with every operation unavailable', async () => {
        const { project } = production([realDecision()]);
        const res = await request(app(project)).get('/agent/capabilities');
        expect(res.status).to.equal(200);
        expect(res.body.edition).to.equal('open-source');
        expect(res.body.formflow).to.deep.equal({ licensed: false, allowed: false, reason: 'unlicensed' });
        expect(res.body.operations.decide.available).to.equal(false);
    });

    it('answers 401, not 403, without credentials', async () => {
        const { project } = production([realDecision()]);
        expect((await request(credentialApp(project)).post('/claim/agent/generate').send({ data: description })).status).to.equal(401);
    });

    it('runs the built-in stub engines on a production endpoint', async () => {
        const { project } = production([stubDecisionEngine()]);
        const res = await request(app(project)).post('/claim/agent/decide').send({ data: description });
        expect(res.status).to.equal(200);
        expect(res.body.fields['triage.claimType'].status).to.equal('confident');
    });
});

describe('Agent API routes', () => {
    it('claims only its own endpoints, so a project form at "agent" is still reached', async () => {
        const { project } = setup([stubDecisionEngine()]);
        const server = testServer();
        server.use(project.agentRouter());
        // Stands in for the project routes that follow the Agent API.
        server.use((req: any, res: any) => res.status(200).json({ projectRoute: req.path }));
        for (const path of ['/agent/submission', '/agent/form', '/agent', '/agent/extractions']) {
            const res = await request(server).get(path);
            expect(res.status, path).to.equal(200);
            expect(res.body.projectRoute).to.equal(path);
        }
        // The operations are the form's: the root no longer answers them.
        for (const path of ['/agent/extract', '/agent/decide', '/agent/generate']) {
            const res = await request(server).post(path).send({ form: 'claim', data: description });
            expect(res.body.projectRoute, path).to.equal(path);
        }
        expect((await request(server).get('/agent/capabilities')).status).to.equal(401);
    });
});

describe('Agent API admin credentials', () => {
    function adminApp() {
        const { project } = setup([stubDecisionEngine()]);
        project.agentConfig = { auth: { projectKey: 'project-key', adminKey: 'admin-key' } };
        const server = testServer();
        server.use(project.uagRouter());
        return server;
    }

    it('accepts the project key in x-token as admin mode', async () => {
        const res = await request(adminApp()).get('/agent/capabilities').set('x-token', 'project-key');
        expect(res.status, res.text).to.equal(200);
    });

    it('runs a form operation for a server key the project accepted', async () => {
        const { project } = setup([stubDecisionEngine()]);
        const res = await request(credentialApp(project, { ...fullAuth, admin: true })).post('/claim/agent/decide').set('x-admin-key', 'admin-key').send({ data: description });
        expect(res.status, res.text).to.equal(200);
    });

    it('refuses a form operation for a server key the project did not accept', async () => {
        const jev = stubDecisionEngine();
        const { project } = setup([jev]);
        const res = await request(credentialApp(project, {})).post('/claim/agent/decide').set('x-token', 'wrong').send({ data: description });
        expect(res.status, res.text).to.equal(401);
        expect(res.body.detail).to.contain('Invalid');
        expect(jev.calls).to.equal(0);
    });

    it('refuses a server key on a form operation from a browser', async () => {
        const { project } = setup([stubDecisionEngine()]);
        for (const [name, value] of [['Origin', 'https://app.example.com'], ['Sec-Fetch-Site', 'same-origin']]) {
            const res = await request(credentialApp(project, { admin: true })).post('/claim/agent/decide').set('x-token', 'project-key').set(name, value).send({ data: description });
            expect(res.status, name).to.equal(401);
            expect(res.body.detail).to.contain('browser');
        }
    });

    it('refuses a wrong key', async () => {
        const res = await request(adminApp()).get('/agent/capabilities').set('x-admin-key', 'wrong');
        expect(res.status, `${res.status} ${res.text} ${JSON.stringify(res.headers)}`).to.equal(401);
    });

    it('refuses admin credentials from a browser', async () => {
        const res = await request(adminApp()).get('/agent/capabilities').set('x-token', 'project-key').set('Origin', 'https://app.example.com');
        expect(res.status, `${res.status} ${res.text} ${JSON.stringify(res.headers)}`).to.equal(401);
        expect(res.body.detail).to.contain('browser');
    });

    it('refuses a scoped token, which is only for /mcp', async () => {
        const { project } = setup([stubDecisionEngine()]);
        project.agentConfig = { auth: { secret: 'test-secret' } };
        // An admin token a remote engine could hold while researching.
        const token = issueScopedToken(project, { admin: true }, [], 30000);
        const res = await request(credentialApp(project, { admin: true })).post('/claim/agent/decide').set('Authorization', `Bearer ${token}`).send({ data: {} });
        expect(res.status, res.text).to.equal(401);
        expect(res.body.detail).to.contain('/mcp');
    });

    it('never matches when no key is configured', async () => {
        const { project } = setup([stubDecisionEngine()]);
        const saved = { p: process.env.PROJECT_KEY, a: process.env.ADMIN_KEY };
        delete process.env.PROJECT_KEY;
        delete process.env.ADMIN_KEY;
        try {
            const server = testServer();
            server.use(project.uagRouter());
            const res = await request(server).get('/agent/capabilities').set('x-token', '');
            expect(res.status, `${res.status} ${res.text} ${JSON.stringify(res.headers)}`).to.equal(401);
        }
        finally {
            if (saved.p !== undefined) process.env.PROJECT_KEY = saved.p;
            if (saved.a !== undefined) process.env.ADMIN_KEY = saved.a;
        }
    });
});
