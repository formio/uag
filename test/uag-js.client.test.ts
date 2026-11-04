import { expect } from 'chai';

/** `client`: the public browser API components of UAG features build on. */
describe('@formio/uag-js: client', () => {
    const UAG_URL = 'https://uag.test';
    let uag: any;
    let requests: any[];

    /** A fresh copy of uag-js (its registration and manifest are per module), registered with a minimal formio.js. */
    function load(options: any = {}, sdk: any = {}) {
        const uagPath = require.resolve('../packages/uag-js');
        delete require.cache[uagPath];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        uag = require('../packages/uag-js');
        const Formio = { Displays: { displays: {} }, getToken: () => 'user-token', ...sdk };
        uag.UAG(UAG_URL, { agentInput: false, ...options })(Formio);
        return uag.client;
    }

    /** A Response-like answer: server-sent events, or JSON. */
    function answer(spec: any) {
        if (spec.events) {
            const text = spec.events.map(([name, data]: any) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
            return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, text: async () => text };
        }
        return { ok: spec.status ? spec.status < 400 : true, status: spec.status || 200, headers: { get: () => 'application/json' }, json: async () => spec.body };
    }
    const fetchWith = (spec: any) => async (url: string, init: any) => {
        requests.push({ url, init, body: JSON.parse(init.body) });
        return answer(spec);
    };

    beforeEach(() => { requests = []; });

    it('is exported, the same object as UAG.client, and set on the formio.js it was registered with', () => {
        const client = load({ manifest: [] });
        const sdk: any = { Displays: { displays: {} } };
        uag.UAG(UAG_URL, { agentInput: false, manifest: [] })(sdk);
        expect(sdk.uagClient).to.equal(uag.client);
        expect(client).to.be.an('object');
        expect(uag.UAG.client).to.equal(client);
        expect(Object.keys(client)).to.include.members(['url', 'token', 'headers', 'formUrl', 'ready', 'plugins', 'plugin', 'stream', 'renderMarkdown', 'escapeHtml']);
    });

    it('gives the UAG URL, the user\'s token and a form\'s URL on the UAG', () => {
        const client = load({ manifest: [] }, { getRemoteToken: () => 'member-token' });
        expect(client.url()).to.equal(UAG_URL);
        expect(client.token()).to.equal('user-token');
        expect(client.headers()).to.deep.equal({ 'x-jwt-token': 'user-token', 'x-remote-token': 'member-token' });
        expect(client.formUrl({ _id: 'f1' })).to.equal(`${UAG_URL}/form/f1`);
        expect(client.formUrl({ form: { _id: 'f2' } })).to.equal(`${UAG_URL}/form/f2`);
    });

    it('lists the plugins of an embedded manifest, by type', async () => {
        const manifest = [{ type: 'document', name: 'extract' }, { type: 'converter', name: 'office-text' }, { type: 'feature', name: 'ai-document' }];
        const client = load({ manifest });
        await client.ready;
        expect(client.plugins('document').map((p: any) => p.name)).to.deep.equal(['extract']);
        expect(client.plugins().length).to.equal(3);
        expect(client.plugin('feature', 'ai-document')).to.include({ name: 'ai-document' });
        expect(client.plugin('feature', 'nope')).to.equal(null);
    });

    it('fetches the manifest with the user\'s token when none is embedded', async () => {
        const client = load({ fetch: async (url: string, init: any) => { requests.push({ url, init }); return { ok: true, json: async () => [{ type: 'document', name: 'analyze' }] }; } });
        await client.ready;
        expect(requests[0].url).to.equal(`${UAG_URL}/plugins`);
        expect(requests[0].init.headers['x-jwt-token']).to.equal('user-token');
        expect(client.plugins('document').map((p: any) => p.name)).to.deep.equal(['analyze']);
    });

    it('streams: passes every event on, and resolves with the done event\'s data', async () => {
        const client = load({ manifest: [], fetch: fetchWith({ events: [['progress', { progress: 0.5, message: 'Half' }], ['done', { result: { content: 'x' } }]] }) });
        const seen: any[] = [];
        const done = await client.stream(`${UAG_URL}/form/f1/sample`, { a: 1 }, { onEvent: (name: string, data: any) => seen.push([name, data]) });
        expect(done).to.deep.equal({ result: { content: 'x' } });
        expect(seen.map(([name]) => name)).to.deep.equal(['progress', 'done']);
        expect(requests[0].init.method).to.equal('POST');
        expect(requests[0].init.headers).to.include({ 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-jwt-token': 'user-token' });
        expect(requests[0].body).to.deep.equal({ a: 1 });
    });

    it('resolves with a JSON answer, and rejects with the UAG\'s message, status and code', async () => {
        let client = load({ manifest: [], fetch: fetchWith({ body: { result: 'plain' } }) });
        expect(await client.stream(`${UAG_URL}/x`, {})).to.deep.equal({ result: 'plain' });
        client = load({ manifest: [], fetch: fetchWith({ status: 415, body: { error: '"a.zip" is not accepted.', code: 'unsupported_file' } }) });
        const refused = await client.stream(`${UAG_URL}/x`, {}).catch((err: any) => err);
        expect(refused).to.include({ message: '"a.zip" is not accepted.', status: 415, code: 'unsupported_file' });
        client = load({ manifest: [], fetch: fetchWith({ events: [['failed', { error: 'It did not work.', code: 'process_failed' }]] }) });
        const failed = await client.stream(`${UAG_URL}/x`, {}).catch((err: any) => err);
        expect(failed).to.include({ message: 'It did not work.', code: 'process_failed' });
    });

    it('renders Markdown with every text escaped', () => {
        const client = load({ manifest: [] });
        expect(client.renderMarkdown('# Hi <b>there</b>')).to.equal('<h1>Hi &lt;b&gt;there&lt;/b&gt;</h1>');
        expect(client.escapeHtml('<x>')).to.equal('&lt;x&gt;');
    });
});
