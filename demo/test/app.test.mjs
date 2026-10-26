import { expect } from 'chai';
import express from 'express';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readConfig, projectNameOf } from '../server/config.mjs';
import { createApp } from '../server/index.mjs';
import { webhookUagUrl } from '../server/setup.mjs';
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
            if (req.url === '/agent/provide') return res.end(JSON.stringify({ written: { decision: 'accepted' } }));
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
    // Other suites in the run leave a browser-like `window` behind, and the
    // Anthropic SDK refuses to start under one. The site is a server.
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
            expect(config.uag).to.include({ clientId: 'uag-x-token', projectPath: '/uag', clientSecret: PROJECT_KEY });
        });

        it('names a hosted project by its subdomain and a self-hosted one by its path', function () {
            expect(projectNameOf('https://uag.form.io')).to.equal('uag');
            expect(projectNameOf('http://api-server:3000/demo')).to.equal('demo');
            expect(readConfig({ PROJECT_KEY, FORMIO_PROJECT_NAME: 'other' }).uag.clientId).to.equal('other-x-token');
        });

        it('points the project\'s webhooks at the site\'s relay, unless told otherwise', function () {
            expect(webhookUagUrl({})).to.equal('https://ai.onform.io/webhooks/uag');
            expect(webhookUagUrl({ DEMO_DOMAIN: 'agents.example.com' })).to.equal('https://agents.example.com/webhooks/uag');
            expect(webhookUagUrl({ DEMO_PUBLIC_URL: 'http://localhost:8080/' })).to.equal('http://localhost:8080/webhooks/uag');
            expect(webhookUagUrl({ WEBHOOK_UAG_URL: 'http://uag-flow:3250/' })).to.equal('http://uag-flow:3250');
        });
    });

    describe('the webhook relay', function () {
        let demo;
        before(async function () {
            demo = await site({ PROJECT_KEY });
        });
        after(async function () {
            if (demo) await demo.close();
        });

        const provide = (headers, body = { form: 'application', submissionId: 'abc', task: 'admissions' }) =>
            fetch(`${demo.url}/webhooks/uag/agent/provide`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(body),
            });

        it('passes a webhook carrying the project key on to the UAG, and its answer back', async function () {
            const response = await provide({ 'x-token': PROJECT_KEY, 'x-request-id': 'someone-elses-session', cookie: 'a=b' });
            expect(response.status).to.equal(200);
            expect(await response.json()).to.deep.equal({ written: { decision: 'accepted' } });
            const call = demo.uag.calls.find((entry) => entry.url === '/agent/provide');
            expect(JSON.parse(call.body)).to.deep.equal({ form: 'application', submissionId: 'abc', task: 'admissions' });
            expect(call.headers['x-token']).to.equal(PROJECT_KEY);
            // Nothing of the caller's but the body: a request id would name a visitor's session.
            expect(call.headers).to.not.have.any.keys('x-request-id', 'cookie');
        });

        it('refuses a webhook without the project key, and passes nothing on', async function () {
            const before = demo.uag.calls.length;
            for (const headers of [{}, { 'x-token': 'wrong' }, { 'x-token': `${PROJECT_KEY}x` }]) {
                expect((await provide(headers)).status, JSON.stringify(headers)).to.equal(401);
            }
            expect(demo.uag.calls.slice(before).filter((entry) => entry.url === '/agent/provide')).to.deep.equal([]);
        });

        it('is not there for an Open Source project, whose webhooks stay on the private network', async function () {
            const oss = await site({ ADMIN_KEY: 'admin-key' });
            try {
                const response = await fetch(`${oss.url}/webhooks/uag/agent/provide`, { method: 'POST', headers: { 'x-token': 'admin-key' } });
                expect(response.status).to.equal(404);
            }
            finally {
                await oss.close();
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
                    expect(html, pathname).to.include('href="https://ai.onform.io"');
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
            expect(demo.uag.calls.filter((call) => call.url.startsWith('/agent/extract') || call.url.includes('/submission'))).to.deep.equal([]);
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
        let anthropic;
        let replies;
        let baseUrl;
        before(async function () {
            // A stand-in for the model, which answers only when the test says so.
            replies = [];
            anthropic = await listen((req, res) => {
                req.resume();
                replies.push(() => {
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({
                        id: 'msg_1', type: 'message', role: 'assistant', model: 'test', stop_reason: 'end_turn',
                        content: [{ type: 'text', text: 'How can I help?' }], usage: { input_tokens: 10, output_tokens: 5 },
                    }));
                });
            });
            baseUrl = process.env.ANTHROPIC_BASE_URL;
            process.env.ANTHROPIC_BASE_URL = anthropic.url;
        });
        after(async function () {
            if (baseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
            else process.env.ANTHROPIC_BASE_URL = baseUrl;
            anthropic.server.closeAllConnections();
            await new Promise((resolve) => anthropic.server.close(resolve));
        });

        it('starts over cleanly while a turn is still running', async function () {
            const config = readConfig({ ADMIN_KEY: 'key', DEMO_SECRET: 'secret', CLAUDE_API_KEY: 'test', DEMO_DAILY_BUDGET: '0' });
            const sessions = new Sessions(config);
            const guard = new Guard(config);
            const mcp = { listTools: async () => ({ tools: [] }), callTool: async () => ({ content: [] }), close: async () => {} };
            const session = sessions.create();
            const web = await routes((router) => conversationRoutes(router, { config, sessions, guard, uag: { mcp: async () => mcp } }), session);
            const post = (pathname, body) => fetch(`${web.url}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
            try {
                const turn = post('/api/conversation/chat', { message: 'My sink is leaking.' });
                while (!replies.length) await new Promise((resolve) => setTimeout(resolve, 5));
                expect((await post('/api/conversation/reset')).status).to.equal(200);
                replies.shift()();
                expect((await turn).status).to.equal(200);
                // The turn answered the conversation it began in, not the one started after it.
                expect(session.chat).to.deep.include({ messages: [], turns: 0 });
                const next = post('/api/conversation/chat', { message: 'Hello again.' });
                while (!replies.length) await new Promise((resolve) => setTimeout(resolve, 5));
                replies.shift()();
                expect((await next).status).to.equal(200);
                expect(session.chat.messages.map((message) => message.role)).to.deep.equal(['user', 'assistant']);
                expect(session.chat).to.deep.include({ turns: 1, busy: false });
            }
            finally {
                sessions.close();
                guard.close();
                web.server.closeAllConnections();
                await new Promise((resolve) => web.server.close(resolve));
            }
        });
    });

    describe('the agentic workflow', function () {
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
