import { expect } from 'chai';
import express from 'express';
import http from 'http';
import supertest from 'supertest';
import { EngineError, EngineRegistry, issueScopedToken, stubAgentEngine, stubDecisionEngine } from '../../src/formflow';
import { AgentRouter } from '../../src/agent/router';
import { auth as fullAuth, claimForm, makeProject, requireTestLicense } from './fixtures';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { loadUAGEngines } from '../../src/agent/engines';

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

function app(project: any, auth: any = fullAuth) {
    const server = testServer();
    server.use(AgentRouter(project, (req: any, _res, next) => { req.auth = auth; next(); }));
    return server;
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
        it('returns 401 without a bearer token', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const server = testServer();
            server.use(project.uagRouter());
            const res = await request(server).post('/agent/extract').send({ form: 'claim', data: description });
            expect(res.status).to.equal(401);
        });

        it('returns 403 and calls no engine when the caller cannot fill in the form', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            const noAccess = { ...fullAuth, formPermissions: () => ({ create: false, read: false, update: false }) };
            const res = await request(app(project, noAccess)).post('/agent/extract').send({ form: 'claim', data: description });
            expect(res.status).to.equal(403);
            expect(jev.calls).to.equal(0);
        });
    });

    describe('errors', () => {
        it('returns 404 for an unknown form', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/agent/extract').send({ form: 'nope', data: {} });
            expect(res.status).to.equal(404);
            expect(res.body.error).to.contain('nope');
        });

        it('returns 400 for an unknown task, listing the form\'s tasks', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/agent/extract').send({ form: 'claim', task: 'finance', data: {} });
            expect(res.status).to.equal(400);
            expect(res.body.error).to.contain('finance').and.contain('triage');
        });

        it('returns 503 when no enabled engine can serve the operation', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/agent/generate').send({ form: 'claim', task: 'triage', data: description });
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
            expect((await request(server).post('/agent/extract').send({ form: 'claim', data: description })).status).to.equal(200);
            const res = await request(server).post('/agent/extract').send({ form: 'claim', data: description });
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
                const decided = await request(app(project)).post('/agent/decide').set('X-Request-Id', 'demo.ab12cd.first').send({ form: 'claim', data: description });
                expect(decided.status, decided.text).to.equal(200);
                const streamed = await request(app(project)).post('/agent/extract').set('X-Request-Id', 'demo.ab12cd.second').set('Accept', 'text/event-stream').send({ form: 'claim', data: description });
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
                { name: 'next', kind: 'decision', model: 'jev-1.13.0', type: 'jev', package: '@formio/uag-jev', version: '2.0.0' },
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
            expect(Object.keys(res.body.operations)).to.have.members(['extract', 'decide', 'generate', 'provide']);
            expect(res.body).to.not.have.property('tasks');
            expect(res.body.edition).to.equal('open-source');
            // Only the stub engines, unlicensed: a local project earns no allowance of its own.
            expect(res.body.formflow).to.deep.equal({ licensed: false, allowed: true, reason: 'stub-engines' });
        });
    });

    describe('POST /agent/extract', () => {
        it('returns merged data and uniform field results without saving anything', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine({ values: { 'triage.lossDate': '2026-10-19' } })]);
            const res = await request(app(project)).post('/agent/extract').send({ form: 'claim', data: description });
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
            const res = await request(app(project)).post('/agent/extract').send({ form: 'claim', data: description });
            expect(res.body.fields['triage.claimType'].status).to.equal('uncertain');
            expect(res.body.errors).to.deep.equal([{ path: 'triage.claimType', label: 'Claim type', error: 'Not allowed' }]);
        });

        it('streams a fast engine\'s results before a slow engine\'s, then the merged result', async () => {
            const { project } = setup([stubDecisionEngine({ delayMs: 5 }), stubAgentEngine({ delayMs: 80, values: { 'triage.lossDate': '2026-10-19' } })]);
            const res = await request(app(project)).post('/agent/extract').set('Accept', 'text/event-stream').send({ form: 'claim', data: description });
            expect(res.get('content-type')).to.contain('text/event-stream');
            expect(res.get('x-accel-buffering')).to.equal('no');
            const list = events(res.text);
            expect(list.map((e) => `${e.event}:${e.data.kind || ''}`)).to.deep.equal(['result:decision', 'result:value', 'done:']);
            expect(list[2].data.data.triage.lossDate).to.equal('2026-10-19');
            expect(list[2].data.tasks).to.deep.equal(['triage']);
        });

        it('extracts from plain text', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/agent/extract').send({ form: 'claim', task: 'triage', text: 'My car was stolen.' });
            expect(res.status).to.equal(200);
            expect(res.body.fields).to.have.property('triage.claimType');
        });
    });

    describe('POST /agent/decide', () => {
        it('returns only decision fields for in-flight data and saves nothing', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine()]);
            const res = await request(app(project)).post('/agent/decide').send({ form: 'claim', data: description });
            expect(Object.keys(res.body.fields)).to.not.include('triage.lossDate');
            expect(res.body.fields).to.have.property('triage.claimType');
            expect(res.body.requestId).to.be.a('string');
            expect(form.saved).to.deep.equal([]);
        });

        it('answers one JSON response even when a stream is asked for', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/agent/decide').set('Accept', 'text/event-stream').send({ form: 'claim', data: description });
            expect(res.get('content-type')).to.contain('application/json');
            expect(res.body.fields).to.have.property('triage.claimType');
        });

        it('refuses a submission id with 400, pointing to /agent/provide', async () => {
            const jev = stubDecisionEngine();
            const { project, form } = setup([jev]);
            form.submissions.push({ _id: 'sub1', data: { ...description } });
            const res = await request(app(project)).post('/agent/decide').send({ form: 'claim', submissionId: 'sub1' });
            expect(res.status).to.equal(400);
            expect(res.body.error).to.contain('/agent/provide');
            expect(jev.calls).to.equal(0);
        });
    });

    describe('POST /agent/generate', () => {
        it('generates only value fields and saves nothing', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine({ values: { 'triage.lossDate': '2026-10-19' } })]);
            const res = await request(app(project)).post('/agent/generate').send({ form: 'claim', task: 'triage', data: description });
            expect(res.status).to.equal(200);
            expect(res.body.fields['triage.lossDate']).to.include({ status: 'suggested', value: '2026-10-19', task: 'triage' });
            expect(res.body.fields).to.not.have.property('triage.claimType');
            expect(form.saved).to.deep.equal([]);
        });
    });

    describe('POST /agent/provide', () => {
        it('decides and generates the task\'s fields, and saves once with provenance', async () => {
            const { project, form } = setup([stubDecisionEngine(), stubAgentEngine({ values: { 'triage.lossDate': '2026-10-19' } })]);
            form.submissions.push({ _id: 'sub1', data: { ...description } });
            const res = await request(app(project)).post('/agent/provide').send({ form: 'claim', task: 'triage', submissionId: 'sub1' });
            expect(res.status, res.text).to.equal(200);
            expect(res.body).to.not.have.property('saved');
            expect(res.body.task).to.equal('triage');
            expect(res.body.written).to.include({ 'triage.lossDate': '2026-10-19' });
            expect(res.body.written).to.have.property('triage.claimType');
            expect(form.saved).to.have.length(1);
            expect(form.saved[0].metadata.uag.decisions['triage.claimType']).to.include({ engine: 'stub-decision' });
            expect(form.saved[0].metadata.uag.generated['triage.lossDate']).to.include({ engine: 'stub-agent' });
        });

        it('accepts a 1.x webhook payload: formName and persona', async () => {
            const { project, form } = setup([stubDecisionEngine()]);
            form.submissions.push({ _id: 'sub1', data: { ...description } });
            const res = await request(app(project)).post('/agent/provide').send({ formName: 'claim', submissionId: 'sub1', persona: 'triage' });
            expect(res.status, res.text).to.equal(200);
            expect(res.body.task).to.equal('triage');
        });

        it('returns 422 with the missing fields when the values would make the submission invalid', async () => {
            const { project, form } = setup([stubDecisionEngine()]);
            form.submissions.push({ _id: 'sub1', data: { ...description } });
            form.submit = async () => {
                const err: any = new Error('Validation failed');
                err.name = 'ValidationError';
                err.details = [{ message: 'Police report number is required', context: { path: 'policeReportNumber' } }];
                throw err;
            };
            const res = await request(app(project)).post('/agent/provide').send({ form: 'claim', task: 'triage', submissionId: 'sub1' });
            expect(res.status).to.equal(422);
            expect(res.body.details).to.deep.equal([{ path: 'policeReportNumber', message: 'Police report number is required' }]);
        });

        it('refuses with 503, and saves nothing, when the engine is down', async () => {
            const { project, form } = setup([stubDecisionEngine({ fail: new EngineError('upstream 503') })]);
            form.submissions.push({ _id: 'sub1', data: { ...description, triage: { claimType: 'theft' } } });
            const res = await request(app(project)).post('/agent/provide').send({ form: 'claim', task: 'triage', submissionId: 'sub1' });
            expect(res.status).to.equal(503);
            expect(res.body.error).to.contain('upstream 503');
            expect(form.saved).to.deep.equal([]);
        });

        it('answers 409 when the submission keeps changing while the task runs', async () => {
            const { project, form } = setup([stubDecisionEngine()]);
            let loads = 0;
            form.loadSubmission = async () => ({ _id: 'sub1', modified: `v${++loads}`, data: { ...description } });
            const res = await request(app(project)).post('/agent/provide').send({ form: 'claim', task: 'triage', submissionId: 'sub1' });
            expect(res.status).to.equal(409);
            expect(form.saved).to.deep.equal([]);
        });

        it('returns 400 without a submission id, and 404 for an unknown one', async () => {
            const { project } = setup([stubDecisionEngine()]);
            expect((await request(app(project)).post('/agent/provide').send({ form: 'claim' })).status).to.equal(400);
            expect((await request(app(project)).post('/agent/provide').send({ form: 'claim', submissionId: 'missing' })).status).to.equal(404);
        });
    });

    describe('legacy names', () => {
        it('accepts persona in place of task', async () => {
            const { project } = setup([stubDecisionEngine()]);
            const res = await request(app(project)).post('/agent/decide').send({ form: 'claim', persona: 'triage', data: description });
            expect(res.status).to.equal(200);
            expect(res.body.tasks).to.deep.equal(['triage']);
        });

        it('refuses task and persona that disagree, calling no engine', async () => {
            const jev = stubDecisionEngine();
            const { project } = setup([jev]);
            const res = await request(app(project)).post('/agent/decide').send({ form: 'claim', task: 'triage', persona: 'finance', data: description });
            expect(res.status).to.equal(400);
            expect(res.body.error).to.contain('"task"').and.contain('"persona"');
            expect(jev.calls).to.equal(0);
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
            ['/agent/extract', { form: 'claim', data: description }],
            ['/agent/decide', { form: 'claim', data: description }],
            ['/agent/generate', { form: 'claim', task: 'triage', data: description }],
            ['/agent/provide', { form: 'claim', task: 'triage', submissionId: 'sub1' }],
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
        const server = testServer();
        server.use(project.uagRouter());
        expect((await request(server).post('/agent/generate').send({ form: 'claim', data: description })).status).to.equal(401);
    });

    it('runs the built-in stub engines on a production endpoint', async () => {
        const { project } = production([stubDecisionEngine()]);
        const res = await request(app(project)).post('/agent/decide').send({ form: 'claim', data: description });
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

    it('accepts the admin key in x-admin-key as admin mode', async () => {
        const res = await request(adminApp()).post('/agent/decide').set('x-admin-key', 'admin-key').send({ form: 'claim', data: description });
        expect(res.status, `${res.status} ${res.text} ${JSON.stringify(res.headers)}`).to.equal(200);
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
        const server = testServer();
        server.use(project.uagRouter());
        // An admin token a remote engine could hold while researching.
        const token = issueScopedToken(project, { admin: true }, [], 30000);
        const res = await request(server).post('/agent/provide').set('Authorization', `Bearer ${token}`).send({ form: 'claim', submissionId: 'x' });
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
