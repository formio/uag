import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const js = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/js');
const UAG = 'https://uag.example.com';
const PROJECT = 'https://demo.form.io';

/**
 * A page with the site's browser scripts loaded, in a VM: `fetch` answers its
 * requests, and `events` collects what js/flow-log.js records.
 */
function page({ fetch = async () => Response.json({}), scripts = ['flow-log.js', 'guest.js'] } = {}) {
    const listeners = {};
    const store = new Map();
    const events = [];
    const window = {
        fetch,
        location: { href: 'https://ai.form.io/apps/demo/', origin: 'https://ai.form.io' },
        document: { documentElement: { dataset: { uagUrl: UAG, uagProjectUrl: `${UAG}/demo`, projectUrl: PROJECT } }, body: { dataset: {} } },
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: (key) => store.delete(key),
        },
        addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
        dispatchEvent: (event) => {
            for (const fn of listeners[event.type] || []) fn(event);
            return true;
        },
        CustomEvent: class CustomEvent {
            constructor(type, init) {
                this.type = type;
                this.detail = init && init.detail;
            }
        },
        URL, TextDecoder, Uint8Array, crypto: globalThis.crypto, atob, setTimeout,
    };
    window.window = window;
    window.parent = window;
    window.addEventListener('uag-flow', (event) => events.push(event.detail));
    vm.createContext(window);
    for (const script of scripts) vm.runInContext(fs.readFileSync(path.join(js, script), 'utf8'), window, { filename: script });
    return { window, events, store };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

describe('Demo site browser scripts', function () {
    describe('the flow log (js/flow-log.js)', function () {
        it('records the page\'s calls to the UAG and the project, and nothing else', async function () {
            const { window, events } = page();
            await window.fetch('https://cdn.jsdelivr.net/npm/x.js');
            await window.fetch(`${UAG}/form/abc/agent/chat`, { method: 'POST', body: JSON.stringify({ messages: [] }) });
            await tick();
            expect(events.map((event) => [event.phase, event.method, event.path, event.kind])).to.deep.equal([
                ['request', 'POST', '/form/abc/agent/chat', 'agent'],
                ['response', 'POST', '/form/abc/agent/chat', 'agent'],
            ]);
            expect(events[1]).to.include({ status: 200, operation: 'chat' });
        });

        it('never records a password or token, and cuts long bodies', async function () {
            const fetch = async () => Response.json({ 'x-jwt-token': 'secret-token-value', data: { note: 'y'.repeat(6000) } });
            const { window, events } = page({ fetch });
            await window.fetch(`${UAG}/demo/guest/register/submission`, { method: 'POST', body: JSON.stringify({ data: { email: 'g@guest.invalid', password: 'hunter2-password' } }) });
            await tick();
            const all = JSON.stringify(events);
            expect(all).to.not.include('hunter2-password').and.not.include('secret-token-value');
            expect(events[0].detail).to.include('[redacted]');
            expect(events[0]).to.include({ kind: 'auth' });
            expect(events[1].detail.length).to.be.below(4200);
            expect(events[1].detail).to.include('more characters');
        });

        it('says which engines answered, how fast, and the tokens they used', function () {
            const { window } = page();
            expect(window.UAGFlowLog.engineSummary({ engines: [
                { engine: 'jev', latencyMs: 180 },
                { engine: 'claude', model: 'claude-sonnet-5-5', latencyMs: 2400, usage: { inputTokens: 1000, outputTokens: 234 } },
            ] })).to.equal('engines: jev · 180 ms; claude · claude-sonnet-5-5 · 2.4 s · 1,234 tokens');
            expect(window.UAGFlowLog.engineSummary({ engine: { name: 'agent' } })).to.equal('engines: agent');
            expect(window.UAGFlowLog.engineSummary({})).to.equal('');
        });

        it('reads an event stream as it arrives, and leaves the caller the whole of it', async function () {
            const body = 'event: decision\ndata: {"path":"claimType"}\n\nevent: result\ndata: {"engines":[{"engine":"jev","latencyMs":90}]}\n\n';
            const fetch = async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
            const { window, events } = page({ fetch });
            const response = await window.fetch(`${UAG}/form/abc/agent/extract`, { method: 'POST', body: '{}' });
            expect(await response.text()).to.equal(body);
            await tick();
            expect(events.filter((event) => event.phase === 'chunk').map((event) => event.summary)).to.deep.equal(['decision', 'result · engines: jev · 90 ms']);
            expect(events.at(-1)).to.include({ phase: 'response', summary: 'engines: jev · 90 ms' });
        });

        it('records a call that never reached the UAG as status 0', async function () {
            const { window, events } = page({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
            let failed = false;
            await window.fetch(`${UAG}/form/abc/submission`, { method: 'POST', body: '{}' }).catch(() => { failed = true; });
            expect(failed).to.equal(true);
            expect(events.at(-1)).to.include({ phase: 'response', status: 0 });
        });
    });

    describe('the guest (js/guest.js)', function () {
        it('registers a guest through the UAG only when asked, keeps its token until it expires, and never its password', async function () {
            const exp = Math.floor(Date.now() / 1000) + 3600;
            const requests = [];
            const fetch = async (url, init) => {
                requests.push({ url, body: JSON.parse(init.body) });
                return new Response('{}', { status: 201, headers: { 'x-jwt-token': jwt({ exp }) } });
            };
            const { window, store } = page({ fetch });
            expect(window.UAGDemoGuest.token()).to.equal(null);
            expect(requests).to.deep.equal([]);
            const token = await window.UAGDemoGuest.start();
            expect(requests).to.have.lengthOf(1);
            expect(requests[0].url).to.equal(`${UAG}/demo/guest/register/submission`);
            expect(requests[0].body.data.email).to.match(/^guest-[0-9a-f]{24}@guest\.invalid$/);
            expect(requests[0].body.data.password).to.match(/^[0-9a-f]{48}$/);
            expect(window.UAGDemoGuest.token()).to.equal(token);
            const stored = JSON.parse(store.get('uag-demo-guest'));
            expect(stored).to.deep.equal({ token, expires: exp * 1000 });
            // A second start reuses the guest.
            await window.UAGDemoGuest.start();
            expect(requests).to.have.lengthOf(1);
        });

        it('does not use a token about to expire', function () {
            const { window, store } = page();
            store.set('uag-demo-guest', JSON.stringify({ token: 't', expires: Date.now() + 60 * 1000 }));
            expect(window.UAGDemoGuest.token()).to.equal(null);
            store.set('uag-demo-guest', JSON.stringify({ token: 't', expires: Date.now() + 60 * 60 * 1000 }));
            expect(window.UAGDemoGuest.token()).to.equal('t');
        });

        it('keeps nothing when registration fails', async function () {
            const { window, store } = page({ fetch: async () => new Response('Too many requests', { status: 429 }) });
            let error = null;
            await window.UAGDemoGuest.start().catch((caught) => { error = caught; });
            expect(error.message).to.include('429');
            expect(store.has('uag-demo-guest')).to.equal(false);
        });

        it('forgets a token the UAG refuses', async function () {
            const { window, store } = page({ fetch: async () => new Response('Unauthorized', { status: 401 }) });
            store.set('uag-demo-guest', JSON.stringify({ token: 't', expires: Date.now() + 60 * 60 * 1000 }));
            await window.fetch(`${UAG}/form/abc/agent/chat`, { method: 'POST', body: '{}' });
            await tick();
            expect(window.UAGDemoGuest.token()).to.equal(null);
        });
    });
});
