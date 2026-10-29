import { expect } from 'chai';
import express from 'express';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readConfig, projectNameOf } from '../server/config.mjs';
import { createApp, startFlowProxy } from '../server/index.mjs';
import { Sessions } from '../server/sessions.mjs';
import { Guard } from '../server/guard.mjs';
import { conversationRoutes } from '../server/conversation.mjs';
import { workflowRoutes } from '../server/workflow.mjs';

const project = createRequire(import.meta.url)('../module/project.json');

const PROJECT_KEY = 'demo-project-key-0123456789abcdef';

/** Listens on a free port and answers with the base URL. */
function listen(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
    });
}

/** A stand-in UAG: its capabilities (answered with `status`), and a provide that echoes what it was sent. */
async function fakeUag({ formflow, status = 200 }) {
    const calls = [];
    const uag = await listen((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            calls.push({ method: req.method, url: req.url, headers: req.headers, body });
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/agent/capabilities') {
                res.statusCode = status;
                return res.end(JSON.stringify(status === 200 ? { edition: 'enterprise', formflow } : { error: 'The request failed.' }));
            }
            res.statusCode = 404;
            res.end('{}');
        });
    });
    return { ...uag, calls };
}

/** The site, in front of a fake UAG. */
async function site(env, { formflow = { allowed: true, reason: 'hosted' }, status } = {}) {
    const uag = await fakeUag({ formflow, status });
    const config = readConfig({ DEMO_SECRET: 'secret', UAG_URL: uag.url, ...env });
    const app = createApp(config, { retention: false });
    const web = await listen(app);
    return {
        url: web.url,
        uag,
        async close() {
            app.locals.close();
            web.server.closeAllConnections();
            uag.server.closeAllConnections();
            await Promise.all([new Promise((resolve) => web.server.close(resolve)), new Promise((resolve) => uag.server.close(resolve))]);
        },
    };
}

describe('Demo site app', function () {
    // Other suites in the run may leave a browser-like `window` behind. The
    // site is a server.
    let leftWindow;
    before(function () {
        leftWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        if (leftWindow) delete globalThis.window;
    });
    after(function () {
        if (leftWindow) Object.defineProperty(globalThis, 'window', leftWindow);
    });

    describe('the project', function () {
        it('runs on the demo project on Form.io\'s hosted service by default', function () {
            const config = readConfig({ PROJECT_KEY });
            expect(config.formio.projectUrl).to.equal('https://uag.form.io');
            expect(config.uag).to.include({ projectPath: '/uag' });
            expect(config.formio.keyHeader).to.deep.equal({ 'x-token': PROJECT_KEY });
        });

        it('names a hosted project by its subdomain and a self-hosted one by its path', function () {
            expect(projectNameOf('https://uag.form.io')).to.equal('uag');
            expect(projectNameOf('http://api-server:3000/demo')).to.equal('demo');
            expect(readConfig({ PROJECT_KEY, FORMIO_PROJECT_NAME: 'other' }).uag.projectPath).to.equal('/other');
        });
    });

    describe('the flow proxy inside the site', function () {
        it('reaches the UAG through its own proxy on loopback, and keeps the flow stream behind a key', async function () {
            const uag = await fakeUag({ formflow: { allowed: true, reason: 'hosted' } });
            const config = readConfig({ DEMO_SECRET: 'secret', PROJECT_KEY, FLOW_UAG_URL: uag.url });
            const proxy = await startFlowProxy(config);
            const app = createApp(config, { retention: false });
            const web = await listen(app);
            try {
                expect(config.uag.url).to.match(/^http:\/\/127\.0\.0\.1:\d+$/).and.not.equal(uag.url);
                expect(config.flow.url).to.equal(config.uag.url);
                expect(config.flow.key).to.have.length(64);
                await (await fetch(`${web.url}/examples`)).text();
                const capabilities = uag.calls.find((call) => call.url === '/agent/capabilities');
                expect(capabilities, 'the site asked the UAG through the proxy').to.exist;
                expect(capabilities.headers['x-request-id']).to.be.a('string');
                expect((await fetch(`${config.flow.url}/flow/events`)).status).to.equal(401);
                // The viewer is told the engines run inside the UAG, where it cannot see their calls.
                const status = await fetch(`${web.url}/api/status`);
                const cookie = (status.headers.get('set-cookie') || '').split(';')[0];
                const stream = await fetch(`${web.url}/api/flow/stream`, { headers: { cookie } });
                const reader = stream.body.getReader();
                let text = '';
                while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
                await reader.cancel();
                const hello = JSON.parse(/^event: hello\ndata: (.*)$/m.exec(text)[1]);
                expect(hello).to.include({ enabled: true, engines: 'inside' });
            }
            finally {
                app.locals.close();
                for (const server of [web.server, proxy, uag.server]) {
                    server.closeAllConnections();
                    await new Promise((resolve) => server.close(resolve));
                }
            }
        });
    });

    describe('the license notice on the examples', function () {
        const EXAMPLES = ['/examples', '/examples/conversation', '/examples/workflow', '/examples/formflow'];

        it('says a license is needed to run the demos locally, on every example page, when this UAG cannot run Agentic Formflow', async function () {
            const demo = await site({ ADMIN_KEY: 'admin-key' }, { formflow: { allowed: false, reason: 'unlicensed' } });
            try {
                for (const pathname of EXAMPLES) {
                    const html = await (await fetch(`${demo.url}${pathname}`)).text();
                    expect(html, pathname).to.include('data-license-notice="unlicensed"').and.include('You need a UAG license to run these demos on your own machine.');
                    expect(html, pathname).to.include('href="https://ai.form.io"');
                }
                const home = await (await fetch(`${demo.url}/`)).text();
                expect(home).to.not.include('data-license-notice');
            }
            finally {
                await demo.close();
            }
        });

        /** The site with no UAG to talk to. */
        async function withoutUag(env, check) {
            const app = createApp(readConfig({ DEMO_SECRET: 'secret', ADMIN_KEY: 'admin-key', UAG_URL: 'http://127.0.0.1:1', ...env }), { retention: false });
            const web = await listen(app);
            try {
                await check(web.url);
            }
            finally {
                app.locals.close();
                web.server.closeAllConnections();
                await new Promise((resolve) => web.server.close(resolve));
            }
        }

        it('says so, too, when the demo runs locally with no UAG to talk to', async function () {
            await withoutUag({}, async (url) => {
                const html = await (await fetch(`${url}/examples/workflow`)).text();
                expect(html).to.include('data-license-notice="unreachable"').and.include('No UAG answered');
                const status = await (await fetch(`${url}/api/status`)).json();
                expect(status.formflow).to.deep.equal({ supported: false, reason: 'unreachable', edition: 'unknown' });
            });
        });

        it('is not shown by the deployed site when its UAG is down: that is an outage, not a missing license', async function () {
            await withoutUag({ NODE_ENV: 'production', DEMO_REQUIRE_TURNSTILE: 'false' }, async (url) => {
                expect(await (await fetch(`${url}/examples/workflow`)).text()).to.not.include('data-license-notice');
            });
        });

        it('is not shown by the deployed site when its UAG answers with an error: that says nothing about its license', async function () {
            const demo = await site({ PROJECT_KEY, NODE_ENV: 'production', DEMO_REQUIRE_TURNSTILE: 'false' }, { status: 503 });
            try {
                expect(await (await fetch(`${demo.url}/examples/workflow`)).text()).to.not.include('data-license-notice');
                expect((await (await fetch(`${demo.url}/api/status`)).json()).formflow).to.include({ supported: true });
            }
            finally {
                await demo.close();
            }
        });

        for (const reason of ['hosted', 'licensed']) {
            it(`is not shown when the UAG is ${reason}, such as one of your own on the demo's hosted project`, async function () {
                const demo = await site({ PROJECT_KEY }, { formflow: { allowed: true, reason } });
                try {
                    for (const pathname of EXAMPLES) {
                        expect(await (await fetch(`${demo.url}${pathname}`)).text(), pathname).to.not.include('data-license-notice');
                    }
                }
                finally {
                    await demo.close();
                }
            });
        }
    });

    describe('caching', function () {
        it('has the deployed site revalidate the demo apps\' pages on every load, and cache their assets for an hour', async function () {
            const demo = await site({ PROJECT_KEY, NODE_ENV: 'production', DEMO_REQUIRE_TURNSTILE: 'false' });
            try {
                for (const pathname of ['/apps/conversation/', '/apps/conversation/index.html', '/apps/workflow/']) {
                    const response = await fetch(`${demo.url}${pathname}`);
                    expect(response.status, pathname).to.equal(200);
                    expect(response.headers.get('cache-control'), pathname).to.equal('no-cache');
                }
                expect((await fetch(`${demo.url}/apps/conversation/chat.js`)).headers.get('cache-control')).to.equal('public, max-age=3600');
                expect((await fetch(`${demo.url}/renderer/uag-js.css`)).headers.get('cache-control')).to.equal('public, max-age=3600');
            }
            finally {
                await demo.close();
            }
        });
    });

    describe('the claims wizard', function () {
        let demo;
        before(async function () {
            demo = await site({ PROJECT_KEY, FORMIO_PROJECT_URL: 'http://127.0.0.1:1' });
        });
        after(async function () {
            if (demo) await demo.close();
        });

        // What the triage task sends the engines besides its input: its context, with every question.
        const context = project.forms.claim.components.flatMap(function walk(component) {
            return [component.properties?.uagContext, ...(component.components || []).flatMap(walk)];
        }).filter(Boolean).flatMap((list) => list.split(',').map((key) => key.trim()));

        it('refuses a claim whose context for the engines is longer than the demo takes, before the UAG sees it', async function () {
            expect(context).to.include('policyNumber');
            const post = (pathname, data) => fetch(`${demo.url}${pathname}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
            });
            for (const key of context) {
                const data = { lossDescription: 'Rear-ended at a light.', [key]: 'P'.repeat(9000) };
                expect((await post('/api/formflow/agent/extract', data)).status, key).to.equal(400);
                expect((await post('/api/formflow/claims', data)).status, key).to.equal(400);
            }
            expect(demo.uag.calls.filter((call) => call.url.includes('/agent/extract') || call.url.includes('/submission'))).to.deep.equal([]);
        });
    });

    /** Routes mounted on their own, for one visitor `session`. */
    async function routes(mount, session) {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.session = session;
            next();
        });
        const router = express.Router();
        mount(router);
        app.use(router);
        return listen(app);
    }

    describe('the conversation', function () {
        const FORM_ID = '64b000000000000000000001';

        /** The chat's relays, in front of a stand-in UAG and Form.io. */
        async function chatRoutes(uagAnswer = () => ({ status: 200, body: { reply: 'Hi!', engine: { usage: { inputTokens: 30000, outputTokens: 10000 } } } })) {
            const config = readConfig({ ADMIN_KEY: 'key', DEMO_SECRET: 'secret', DEMO_DAILY_BUDGET: '100', DEMO_TOKENS_PER_UNIT: '20000', CHAT_MAX_TURNS: '2' });
            const sessions = new Sessions(config);
            const guard = new Guard(config);
            const session = sessions.create();
            session.verifiedUntil = Date.now() + 60_000;
            const calls = [];
            const owned = [];
            const formio = {
                pathOf: async () => 'service-request',
                form: async () => ({ ok: true, status: 200, body: { _id: FORM_ID, path: 'service-request', tags: ['uag'] } }),
            };
            const respond = ({ status, body }) => ({ ok: status < 400, status, json: async () => body });
            const uag = {
                agent: async (formPath, operation, body, options) => { calls.push({ formPath, operation, body, options }); return respond(uagAnswer(body)); },
                submit: async (formPath, data, options) => { calls.push({ formPath, operation: 'submit', data, options }); return respond({ status: 201, body: { _id: 'sub1', data } }); },
            };
            const flow = { own: (who, id, form) => owned.push({ id, form }) };
            const web = await routes((router) => conversationRoutes(router, { config, sessions, guard, uag, formio, flow }), session);
            const post = (pathname, body) => fetch(`${web.url}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
            const close = async () => {
                sessions.close();
                guard.close();
                web.server.closeAllConnections();
                await new Promise((resolve) => web.server.close(resolve));
            };
            return { web, post, calls, owned, session, guard, close };
        }

        const turn = (content, data = {}) => ({ messages: [{ role: 'user', content }], data });

        it('stands in for the UAG for its one form: the form, its chat turns and its save', async function () {
            const chat = await chatRoutes();
            try {
                const form = await fetch(`${chat.web.url}/api/conversation/uag/service-request`);
                expect(form.status).to.equal(200);
                expect((await form.json())._id).to.equal(FORM_ID);
                expect((await fetch(`${chat.web.url}/api/conversation/uag/application`)).status).to.equal(404);

                // As the browser module addresses the form on the UAG: by id, with or without a project.
                for (const prefix of ['', '/project/p1']) {
                    const res = await chat.post(`/api/conversation/uag${prefix}/form/${FORM_ID}/agent/chat`, turn('My internet is down'));
                    expect(res.status, prefix).to.equal(200);
                    expect((await res.json()).reply).to.equal('Hi!');
                }
                expect(chat.calls[0]).to.deep.include({ formPath: 'service-request', operation: 'chat', body: turn('My internet is down') });
                expect(chat.calls[0].options.requestId).to.match(/^demo\./);
                expect(chat.session.chat.turns).to.equal(2);

                const saved = await chat.post(`/api/conversation/uag/project/p1/form/${FORM_ID}/submission`, { data: { fullName: 'Ada' } });
                expect(saved.status).to.equal(201);
                expect(chat.calls.at(-1)).to.deep.include({ formPath: 'service-request', operation: 'submit', data: { fullName: 'Ada' } });
                expect(chat.owned).to.deep.equal([{ id: 'sub1', form: 'serviceRequest' }]);
                // A saved request starts a new conversation.
                expect(chat.session.chat.turns).to.equal(0);
            }
            finally {
                await chat.close();
            }
        });

        it('charges each turn for the model tokens it used', async function () {
            const chat = await chatRoutes();
            try {
                const before = chat.guard.budget.status().used;
                await chat.post(`/api/conversation/uag/form/${FORM_ID}/agent/chat`, turn('hello'));
                // One unit up front, and two for 40,000 tokens at 20,000 a unit.
                expect(chat.guard.budget.status().used - before).to.equal(3);
            }
            finally {
                await chat.close();
            }
        });

        it('refuses another form, a malformed turn and a conversation past its length, without calling the UAG', async function () {
            const chat = await chatRoutes();
            try {
                expect((await chat.post('/api/conversation/uag/form/64b0000000000000000000ff/agent/chat', turn('hi'))).status).to.equal(404);
                expect((await chat.post('/api/conversation/uag/form/64b0000000000000000000ff/submission', { data: {} })).status).to.equal(404);
                const chatUrl = `/api/conversation/uag/form/${FORM_ID}/agent/chat`;
                expect((await chat.post(chatUrl, { messages: [] })).status).to.equal(400);
                expect((await chat.post(chatUrl, turn('   '))).status).to.equal(400);
                expect((await chat.post(chatUrl, turn('x'.repeat(2001)))).status).to.equal(400);
                expect((await chat.post(chatUrl, { messages: [{ role: 'assistant', content: 'hi' }] })).status).to.equal(400);
                expect((await chat.post(chatUrl, { ...turn('hi'), data: [] })).status).to.equal(400);
                expect(chat.calls).to.deep.equal([]);
                chat.session.chat.turns = 2;
                const limited = await chat.post(chatUrl, turn('one more'));
                expect(limited.status).to.equal(429);
                expect((await limited.json()).code).to.equal('conversation_limit');
                expect((await chat.post('/api/conversation/reset')).status).to.equal(200);
                expect(chat.session.chat).to.deep.equal({ turns: 0 });
                expect((await chat.post(chatUrl, turn('again'))).status).to.equal(200);
            }
            finally {
                await chat.close();
            }
        });

        it('rate-limits starting over like a turn, so it cannot get round the length limit', async function () {
            const chat = await chatRoutes();
            try {
                // The chat's session limit is 30 in ten minutes.
                const statuses = [];
                for (let i = 0; i < 31; i++) statuses.push((await chat.post('/api/conversation/reset')).status);
                expect(statuses.slice(0, 30).every((status) => status === 200)).to.equal(true);
                expect(statuses[30]).to.equal(429);
            }
            finally {
                await chat.close();
            }
        });

        it('passes the UAG\'s refusal on, and charges no tokens for it', async function () {
            const chat = await chatRoutes(() => ({ status: 429, body: { error: 'Every engine that could answer this chat is over its rate limit.' } }));
            try {
                const res = await chat.post(`/api/conversation/uag/form/${FORM_ID}/agent/chat`, turn('hi'));
                expect(res.status).to.equal(429);
                expect(chat.session.chat.turns).to.equal(0);
            }
            finally {
                await chat.close();
            }
        });
    });

    describe('the agentic workflow', function () {
        it('saves an application through the UAG, with only the applicant\'s fields and the visitor\'s request id', async function () {
            const config = readConfig({ ADMIN_KEY: 'key', DEMO_SECRET: 'secret' });
            const sessions = new Sessions(config);
            const session = sessions.create();
            const sent = [];
            const uag = {
                async submit(path, data, options) {
                    sent.push({ path, data, options });
                    return new Response(JSON.stringify({ _id: 'app-9', data }), { status: 201, headers: { 'Content-Type': 'application/json' } });
                },
            };
            const formio = { async pathOf() { return 'application'; } };
            const flow = { own: (s, id) => s.submissions.set(id, { form: 'application', created: Date.now() }) };
            const web = await routes((router) => workflowRoutes(router, { config, formio, uag, sessions, flow, guard: { protect: () => (req, res, next) => next() } }), session);
            try {
                const response = await fetch(`${web.url}/api/workflow/applications`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: { firstName: 'Ann', essay: 'Robotics club.', status: 'accepted', overallScore: 100 } }),
                });
                expect(response.status).to.equal(201);
                expect(await response.json()).to.deep.equal({ id: 'app-9' });
                expect(sent).to.have.length(1);
                expect(sent[0].path).to.equal('application');
                expect(sent[0].data).to.deep.equal({ firstName: 'Ann', essay: 'Robotics club.' });
                expect(sessions.fromRequestId(sent[0].options.requestId)).to.equal(session);
                expect(session.submissions.has('app-9')).to.equal(true);
            }
            finally {
                sessions.close();
                web.server.closeAllConnections();
                await new Promise((resolve) => web.server.close(resolve));
            }
        });

        it('reads a polled application from Form.io at most once a second', async function () {
            const config = readConfig({ ADMIN_KEY: 'key', DEMO_SECRET: 'secret' });
            const sessions = new Sessions(config);
            const session = sessions.create();
            session.submissions.set('app-1', { form: 'application', created: Date.now() });
            let reads = 0;
            const formio = {
                async submission() {
                    reads++;
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    return { ok: true, status: 200, body: { data: { status: 'submitted' }, modified: 'now' } };
                },
            };
            const web = await routes((router) => workflowRoutes(router, { config, formio, guard: { protect: () => (req, res, next) => next() } }), session);
            const poll = () => fetch(`${web.url}/api/workflow/applications/app-1`).then((response) => response.json());
            try {
                const answers = await Promise.all([poll(), poll(), poll()]);
                answers.push(await poll());
                expect(answers.map((answer) => answer.result)).to.deep.equal(Array(4).fill({ status: 'submitted' }));
                expect(reads).to.equal(1);
                expect((await fetch(`${web.url}/api/workflow/applications/someone-elses`)).status).to.equal(404);
                expect(reads).to.equal(1);
            }
            finally {
                sessions.close();
                web.server.closeAllConnections();
                await new Promise((resolve) => web.server.close(resolve));
            }
        });
    });
});
