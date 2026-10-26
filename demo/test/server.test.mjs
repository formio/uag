import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../server/config.mjs';
import { Sessions } from '../server/sessions.mjs';
import { Guard, Windows, networkOf } from '../server/guard.mjs';
import { FlowHub } from '../server/flow.mjs';
import { filterFormList, parseForms, trimHistory } from '../server/conversation.mjs';
import { render } from '../server/pages.mjs';
import http from 'node:http';
import { createServer as createFlowProxy, describeRequest } from '../flow/proxy.mjs';

const config = (env = {}) => readConfig({ ADMIN_KEY: 'key', DEMO_SECRET: 'secret', ...env });

/** A request as the guard sees it. */
const request = (session, ip = '203.0.113.1') => ({ session, ip });

describe('Demo site', function () {
    describe('configuration', function () {
        it('derives every public URL from DEMO_DOMAIN', function () {
            expect(config().publicUrl).to.equal('https://ai.onform.io');
            expect(config({ DEMO_DOMAIN: 'agents.example.com' }).publicUrl).to.equal('https://agents.example.com');
            expect(config({ DEMO_PUBLIC_URL: 'http://localhost:8080/' })).to.include({ publicUrl: 'http://localhost:8080', secure: false });
        });

        it('uses the project key against Enterprise and the admin key against Open Source', function () {
            expect(config({ ADMIN_KEY: '', PROJECT_KEY: 'pk', FORMIO_PROJECT_URL: 'http://api-server:3000/demo' }).uag)
                .to.include({ clientId: 'demo-x-token', clientSecret: 'pk' });
            expect(config().uag).to.include({ clientId: 'formio-oss-x-admin-key', clientSecret: 'key' });
        });

        it('refuses to start in production without a cookie secret', function () {
            expect(() => readConfig({ ADMIN_KEY: 'key', NODE_ENV: 'production' })).to.throw(/DEMO_SECRET/);
        });
    });

    describe('sessions', function () {
        let sessions;
        beforeEach(function () {
            sessions = new Sessions({ secret: 'secret', secure: true });
        });
        afterEach(function () {
            sessions.close();
        });

        it('accepts only a cookie it signed', function () {
            const session = sessions.create();
            const signed = `${session.id}.${sessions.sign(session.id)}`;
            expect(sessions.verify(signed)).to.equal(session.id);
            expect(sessions.verify(`${session.id}.${sessions.sign('someone-else-entirely-x')}`)).to.equal(null);
            expect(sessions.verify(`${session.id}x.${sessions.sign(session.id)}`)).to.equal(null);
            expect(sessions.verify('')).to.equal(null);
        });

        it('uses a __Host- cookie over HTTPS, so a sibling subdomain cannot plant one', function () {
            expect(sessions.cookie).to.equal('__Host-uagdemo');
            expect(new Sessions({ secret: 'secret', secure: false }).cookie).to.equal('uagdemo');
        });

        it('refuses a new session when told to, and at its cap removes one with nothing to lose', function () {
            const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set() { return this; }, json() { return this; }, append() {} };
            let started = 0;
            sessions.middleware({ allowNew: () => false })({ headers: {} }, res, () => { started++; });
            expect(res.statusCode).to.equal(429);
            expect(started).to.equal(0);
            const verified = sessions.create();
            verified.verifiedUntil = Date.now() + 60000;
            verified.lastSeen = 1;
            const idle = sessions.create();
            idle.lastSeen = 2;
            sessions.evictOldest();
            expect(sessions.byId.has(verified.id)).to.equal(true);
            expect(sessions.byId.has(idle.id)).to.equal(false);
        });

        it('makes request ids that name the session by its tag only, and are safe to forward', function () {
            const session = sessions.create();
            const id = sessions.requestId(session);
            expect(id).to.match(/^[A-Za-z0-9._:-]{1,128}$/);
            expect(id).to.not.include(session.id);
            expect(sessions.fromRequestId(id)).to.equal(session);
            expect(sessions.fromRequestId('demo.000000000000.abcd')).to.equal(null);
            expect(sessions.fromRequestId('flow-1234')).to.equal(null);
        });
    });

    describe('spend guard', function () {
        let sessions;
        let guards = [];
        const guard = (env, fetch) => {
            const created = new Guard(config(env), { fetch });
            guards.push(created);
            return created;
        };
        beforeEach(function () {
            sessions = new Sessions({ secret: 'secret' });
        });
        afterEach(function () {
            sessions.close();
            guards.forEach((g) => g.close());
            guards = [];
        });

        it('rate limits each network before each session, so a refused request leaves no session counter', function () {
            const limits = JSON.stringify({ chat: { session: { limit: 2, windowMs: 60000 }, ip: { limit: 3, windowMs: 60000 } } });
            const g = guard({ DEMO_LIMITS: limits, DEMO_DAILY_BUDGET: '0', DEMO_DAILY_NETWORK_BUDGET: '0' });
            const a = sessions.create();
            expect(g.check(request(a), 'chat', 1)).to.equal(null);
            expect(g.check(request(a), 'chat', 1)).to.equal(null);
            const refused = g.check(request(a), 'chat', 1);
            expect(refused).to.include({ status: 429, code: 'rate_limited' });
            expect(refused.retryAfter).to.be.within(1, 60);
            // The address has had three; a new session there is refused by the address, and gets no counter.
            const before = g.windows.counters.size;
            expect(g.check(request(sessions.create()), 'chat', 1)).to.include({ code: 'rate_limited' });
            expect(g.windows.counters.size).to.equal(before);
            // A new visitor elsewhere is not affected.
            expect(g.check(request(sessions.create(), '198.51.100.7'), 'chat', 1)).to.equal(null);
        });

        it('counts an IPv6 network as one client', function () {
            expect(networkOf('2001:db8:1:2:aaaa::1')).to.equal(networkOf('2001:db8:1:2:ffff:1:2:3'));
            expect(networkOf('2001:db8:1:2::1')).to.not.equal(networkOf('2001:db8:1:3::1'));
            expect(networkOf('::ffff:203.0.113.9')).to.equal('203.0.113.9');
            const limits = JSON.stringify({ chat: { ip: { limit: 2, windowMs: 60000 } } });
            const g = guard({ DEMO_LIMITS: limits, DEMO_DAILY_BUDGET: '0', DEMO_DAILY_NETWORK_BUDGET: '0' });
            expect(g.check(request(sessions.create(), '2001:db8:1:2::a'), 'chat', 1)).to.equal(null);
            expect(g.check(request(sessions.create(), '2001:db8:1:2::b'), 'chat', 1)).to.equal(null);
            expect(g.check(request(sessions.create(), '2001:db8:1:2::c'), 'chat', 1)).to.include({ code: 'rate_limited' });
        });

        it('keeps no more counters than its cap, however many keys arrive', function () {
            const windows = new Windows(100);
            for (let i = 0; i < 1000; i++) windows.hit(`k${i}`, { limit: 5, windowMs: 60000 });
            expect(windows.counters.size).to.equal(100);
            windows.close();
        });

        it('limits what one network may spend a day', function () {
            const g = guard({ DEMO_DAILY_BUDGET: '0', DEMO_DAILY_NETWORK_BUDGET: '3' });
            const a = sessions.create();
            expect(g.check(request(a), 'extract', 2)).to.equal(null);
            expect(g.check(request(a), 'extract', 2)).to.include({ status: 429, code: 'rate_limited' });
            expect(g.check(request(sessions.create(), '198.51.100.7'), 'extract', 2)).to.equal(null);
        });

        it('charges the tokens a chat turn used against the day, and says when it is spent', function () {
            const g = guard({ DEMO_DAILY_BUDGET: '10', DEMO_TOKENS_PER_UNIT: '1000', DEMO_DAILY_NETWORK_BUDGET: '0' });
            const a = sessions.create();
            expect(g.check(request(a), 'chat', 1)).to.equal(null);
            expect(g.spendTokens(request(a), 4500)).to.equal(true);
            expect(g.budget.status().used).to.equal(6);
            expect(g.spendTokens(request(a), 4000)).to.equal(false);
            expect(g.check(request(a), 'chat', 1)).to.include({ code: 'budget_exhausted' });
        });

        it('stops every demo once the daily budget is spent, and keeps the count across restarts', async function () {
            const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-'));
            try {
                const g = guard({ DEMO_DAILY_BUDGET: '3', DEMO_STATE_DIR: stateDir });
                const a = sessions.create();
                expect(g.check(request(a), 'extract', 2)).to.equal(null);
                expect(g.check(request(a), 'extract', 2)).to.include({ status: 503, code: 'budget_exhausted' });
                expect(g.check(request(a), 'extract', 1)).to.equal(null);
                expect(g.status(a).available).to.equal(false);
                await g.budget.flush();
                const restarted = guard({ DEMO_DAILY_BUDGET: '3', DEMO_STATE_DIR: stateDir });
                expect(restarted.check(request(a), 'extract', 1)).to.include({ code: 'budget_exhausted' });
            }
            finally {
                fs.rmSync(stateDir, { recursive: true, force: true });
            }
        });

        it('keeps the last count when the process dies part way through saving it', async function () {
            const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-'));
            const { writeFile } = fs.promises;
            try {
                const g = guard({ DEMO_DAILY_BUDGET: '10', DEMO_STATE_DIR: stateDir });
                const a = sessions.create();
                expect(g.check(request(a), 'extract', 4)).to.equal(null);
                await g.budget.flush();
                // The next write gets half its bytes out, and nothing after it runs.
                fs.promises.writeFile = async (file, data) => {
                    await writeFile(file, String(data).slice(0, 5));
                    throw new Error('killed');
                };
                const logged = console.error;
                console.error = () => {};
                try {
                    expect(g.check(request(a), 'extract', 1)).to.equal(null);
                    await g.budget.flush();
                }
                finally {
                    console.error = logged;
                    fs.promises.writeFile = writeFile;
                }
                expect(guard({ DEMO_DAILY_BUDGET: '10', DEMO_STATE_DIR: stateDir }).budget.status().used).to.equal(4);
            }
            finally {
                fs.promises.writeFile = writeFile;
                fs.rmSync(stateDir, { recursive: true, force: true });
            }
        });

        it('needs a solved Turnstile challenge, checked with Cloudflare, when it is configured', async function () {
            const sent = [];
            const fetch = async (url, init) => {
                sent.push({ url, body: String(init.body) });
                return { json: async () => ({ success: init.body.get('response') === 'good-token' }) };
            };
            const g = guard({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'shh', DEMO_DAILY_BUDGET: '0' }, fetch);
            const a = sessions.create();
            expect(g.status(a)).to.include({ turnstileSiteKey: 'site', verified: false });
            expect(g.check(request(a), 'chat', 1)).to.include({ status: 403, code: 'verification_required' });
            expect(await g.verify(a, 'bad-token', '203.0.113.1')).to.equal(false);
            expect(g.check(request(a), 'chat', 1)).to.include({ code: 'verification_required' });
            expect(await g.verify(a, 'good-token', '203.0.113.1')).to.equal(true);
            expect(g.check(request(a), 'chat', 1)).to.equal(null);
            expect(sent[0].url).to.equal('https://challenges.cloudflare.com/turnstile/v0/siteverify');
            expect(sent[0].body).to.include('secret=shh').and.include('remoteip=203.0.113.1');
        });

        it('asks for no challenge without Turnstile keys', function () {
            const g = guard({ DEMO_DAILY_BUDGET: '0' });
            expect(g.status(sessions.create())).to.include({ turnstileSiteKey: '', verified: true });
        });
    });

    describe('flow viewer', function () {
        let sessions;
        let hub;
        const stream = () => {
            const frames = [];
            return { frames, write: (frame) => frames.push(JSON.parse(frame.replace(/^data: /, ''))), end() {} };
        };
        beforeEach(function () {
            sessions = new Sessions({ secret: 'secret' });
            hub = new FlowHub({ url: '' }, sessions);
        });
        afterEach(function () {
            sessions.close();
        });

        it('hands each visitor the events of their own runs, and no one else\'s', function () {
            const alice = sessions.create();
            const bob = sessions.create();
            const watching = stream();
            alice.flow.clients.add(watching);
            const run = sessions.requestId(alice);
            hub.route({ id: 1, requestId: run, phase: 'request', kind: 'agent', label: '/agent/extract' });
            hub.route({ id: 2, requestId: run, phase: 'request', kind: 'engine', label: 'jev decide' });
            hub.route({ id: 3, requestId: sessions.requestId(bob), phase: 'request', kind: 'agent' });
            hub.route({ id: 4, requestId: 'flow-unknown', phase: 'request', kind: 'agent', submissionId: 'nobody' });
            expect(alice.flow.events.map((event) => event.id)).to.deep.equal([1, 2]);
            expect(watching.frames.map((event) => event.id)).to.deep.equal([1, 2]);
            expect(bob.flow.events.map((event) => event.id)).to.deep.equal([3]);
            // The request id is shown as the run, never forwarded as is.
            expect(alice.flow.events[0]).to.not.have.property('requestId');
        });

        it('gives a webhook\'s whole run to the visitor whose submission it names', function () {
            const alice = sessions.create();
            hub.own(alice, 'sub-1', 'application');
            hub.route({ id: 1, requestId: 'flow-a', phase: 'request', kind: 'agent', submissionId: 'sub-1' });
            hub.route({ id: 2, requestId: 'flow-a', phase: 'request', kind: 'engine' });
            hub.route({ id: 3, requestId: 'flow-a', phase: 'response', kind: 'agent', status: 200 });
            // A response cannot claim a run by naming a submission.
            hub.route({ id: 4, requestId: 'flow-b', phase: 'response', kind: 'agent', submissionId: 'sub-1' });
            expect(alice.flow.events.map((event) => event.id)).to.deep.equal([1, 2, 3]);
        });

        it('keeps each visitor\'s buffer to a size, truncating large bodies', function () {
            const alice = sessions.create();
            const run = sessions.requestId(alice);
            for (let i = 0; i < 600; i++) hub.route({ id: i, requestId: run, phase: 'response', kind: 'engine', detail: 'z'.repeat(20000) });
            const bytes = alice.flow.events.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
            expect(bytes).to.be.at.most(1024 * 1024);
            expect(alice.flow.events.at(-1).detail.length).to.be.lessThan(5000);
        });

        it('caps the streams one network holds open', function () {
            hub = new FlowHub({ url: '', streamsPerNetwork: 1 }, sessions);
            const closers = [];
            const open = () => {
                const req = { ip: '203.0.113.5', session: sessions.create(), on(event, handler) { if (event === 'close') closers.push(handler); } };
                const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() { return this; }, writeHead() {}, write() {}, end() {} };
                hub.stream()(req, res);
                return res.statusCode;
            };
            expect(open()).to.equal(200);
            expect(open()).to.equal(429);
            // Closing the stream frees the network's place.
            closers.forEach((close) => close());
            expect(open()).to.equal(200);
            closers.forEach((close) => close());
        });

        it('forgets a visitor\'s submissions and runs when their session ends', function () {
            const alice = sessions.create();
            hub.own(alice, 'sub-1', 'application');
            hub.route({ id: 1, requestId: 'flow-a', phase: 'request', kind: 'agent', submissionId: 'sub-1' });
            sessions.remove(alice);
            const carol = sessions.create();
            hub.route({ id: 2, requestId: 'flow-a', phase: 'request', kind: 'engine' });
            expect(carol.flow.events).to.deep.equal([]);
            expect(hub.owners.size).to.equal(0);
        });
    });

    describe('flow proxy', function () {
        it('reads the form, task and submission out of a webhook', function () {
            expect(describeRequest('/agent/provide', JSON.stringify({ form: 'application', task: 'admissions', submissionId: 'abc' })))
                .to.include({ kind: 'agent', operation: 'provide', form: 'application', task: 'admissions', submissionId: 'abc' });
            expect(describeRequest('/agent/provide', JSON.stringify({ formName: 'application', persona: 'finance', submissionId: 'abc' })))
                .to.include({ form: 'application', task: 'finance' });
        });

        it('marks token exchanges for redaction', function () {
            expect(describeRequest('/auth/token', '{"client_secret":"x"}')).to.include({ kind: 'auth', redact: true });
        });

        it('names engine calls and research tool calls', function () {
            expect(describeRequest('/v1/engines/jev/decide', JSON.stringify({ questions: { a: {} } }))).to.include({ kind: 'engine', engine: 'jev', operation: 'decide' });
            expect(describeRequest('/mcp', JSON.stringify({ method: 'tools/call', params: { name: 'find_submissions', arguments: { form_name: 'x' } } })))
                .to.include({ kind: 'mcp', tool: 'find_submissions' });
        });

        describe('in front of a service', function () {
            const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(new URL(`http://127.0.0.1:${server.address().port}`))));
            const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            let upstream;
            let proxy;
            let url;
            let events;
            let reader;
            beforeEach(async function () {
                // The service answers every request with a stream, sent in two pieces when it is asked to split one.
                upstream = http.createServer((req, res) => {
                    req.resume();
                    req.on('end', async () => {
                        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                        const frame = Buffer.from(`event: result\ndata: ${JSON.stringify({ text: 'café ✓' })}\n\n`);
                        if (req.url === '/agent/split') {
                            // Mid-way through the three bytes of the check mark.
                            const at = frame.indexOf(Buffer.from('✓')) + 1;
                            res.write(frame.subarray(0, at));
                            await pause(30);
                            res.end(frame.subarray(at));
                        }
                        else {
                            res.end(frame);
                        }
                    });
                });
                const target = await listen(upstream);
                proxy = createFlowProxy({ uag: target, engines: target });
                url = await listen(proxy);
                // The flow stream, as the demo site reads it. It replays what earlier tests sent.
                events = [];
                reader = http.get(new URL('/flow/events', url), (res) => {
                    let buffered = '';
                    res.setEncoding('utf8');
                    res.on('data', (text) => {
                        buffered += text;
                        let index;
                        while ((index = buffered.indexOf('\n\n')) >= 0) {
                            const data = buffered.slice(0, index).split('\n').find((line) => line.startsWith('data: '));
                            buffered = buffered.slice(index + 2);
                            if (data) events.push(JSON.parse(data.slice(6)));
                        }
                    });
                });
                reader.on('error', () => {});
                await pause(30);
            });
            afterEach(async function () {
                reader.destroy();
                for (const server of [proxy, upstream]) {
                    server.closeAllConnections();
                    await new Promise((resolve) => server.close(resolve));
                }
            });

            const post = (pathname, body, { hold = 0 } = {}) => new Promise((resolve, reject) => {
                const req = http.request(new URL(pathname, url), { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
                    res.resume();
                    res.on('end', resolve);
                });
                req.on('error', reject);
                if (!hold) return req.end(body);
                // A body that arrives slowly: the leg's request event waits for all of it.
                req.write(body.slice(0, 5));
                setTimeout(() => req.end(body.slice(5)), hold);
            });

            it('gives each leg its own id, however their bodies arrive', async function () {
                const slow = post('/agent/extract', JSON.stringify({ form: 'claim', task: 'triage' }), { hold: 80 });
                await pause(20);
                await post('/agent/provide', JSON.stringify({ form: 'application', task: 'admissions' }));
                await slow;
                await pause(20);
                const requests = events.filter((event) => event.phase === 'request' && ['/agent/extract', '/agent/provide'].includes(event.label));
                expect(requests.map((event) => event.label).sort()).to.deep.equal(['/agent/extract', '/agent/provide']);
                expect(new Set(requests.map((event) => event.reqId)).size).to.equal(2);
                // And each leg's response carries its own request's id.
                for (const request of requests) {
                    expect(events.find((event) => event.phase === 'response' && event.reqId === request.reqId)).to.include({ label: request.label });
                }
            });

            it('reads a character split across two pieces of a stream whole', async function () {
                await post('/agent/split', '{}');
                await pause(20);
                const split = events.filter((event) => event.label === '/agent/split');
                expect(JSON.parse(split.find((event) => event.phase === 'chunk').detail)).to.deep.equal({ text: 'café ✓' });
                expect(split.find((event) => event.phase === 'response').detail).to.include('café ✓');
            });
        });
    });

    describe('conversation', function () {
        it('drops the oldest turns past its size, starting at a message the customer typed', function () {
            const turn = (n) => [
                { role: 'user', content: `message ${n} ${'x'.repeat(100)}` },
                { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name: 'get_forms', input: {} }] },
                { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${n}`, content: 'y'.repeat(100) }] },
                { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
            ];
            const history = [...turn(1), ...turn(2), ...turn(3), { role: 'user', content: 'latest' }];
            const trimmed = trimHistory(history, 600);
            expect(trimmed[0]).to.deep.include({ role: 'user' });
            expect(trimmed[0].content).to.be.a('string');
            expect(trimmed.at(-1).content).to.equal('latest');
            expect(trimmed.length).to.be.lessThan(history.length);
            expect(trimHistory(history, 1e9)).to.equal(history);
        });

        const list = [
            'Total forms (3 total):',
            '',
            '- Service Request (**serviceRequest**):',
            '  - **Description**: Report a fault',
            '  - **Permissions**: Create, Read submissions (records)',
            '- College Application (**application**):',
            '  - **Permissions**: Create submissions (records)',
            '- First Notice of Loss (**claim**):',
            '  - **Permissions**: Create submissions (records)',
            '',
            'If the user wishes to submit a form ...',
        ].join('\n');

        it('shows the chat only the forms it may use', function () {
            const filtered = filterFormList(list, ['serviceRequest']);
            expect(parseForms(filtered)).to.deep.equal([{ title: 'Service Request', name: 'serviceRequest' }]);
            expect(filtered).to.include('Report a fault').and.include('Total forms (1 total)').and.include('If the user wishes');
            expect(filtered).to.not.include('application').and.not.include('claim');
        });
    });

    describe('templates', function () {
        it('escapes {{values}} and leaves {{{values}}} raw', function () {
            expect(render('<p>{{a}}</p>{{{b}}}', { a: '<script>"x"</script>', b: '<i>ok</i>' }))
                .to.equal('<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p><i>ok</i>');
            expect(render('{{links.portal}}', { links: { portal: 'https://portal.form.io' } })).to.equal('https://portal.form.io');
        });

        it('never reads a value as a template, so a doc can show {{placeholders}}', function () {
            const values = { doc: '<code>{{ data.country }}</code> {{{ data.country }}}', data: { country: 'NZ' } };
            expect(render('{{{doc}}}', values)).to.equal(values.doc);
            expect(render('{{doc}}', values)).to.equal('&lt;code&gt;{{ data.country }}&lt;/code&gt; {{{ data.country }}}');
        });
    });
});
