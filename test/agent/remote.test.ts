import { expect } from 'chai';
import http from 'http';
import { AddressInfo } from 'net';
import { loadUAGEngines } from '../../src/agent/engines';
import { withRequestId } from '../../src/agent/requestId';

const KEY = 'k'.repeat(16) + 'engine-server-key';

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any; closed?: boolean };
type Handler = (seen: Seen, res: http.ServerResponse) => void | Promise<void>;

const DESCRIPTION = {
    protocol: 1,
    engines: [
        { name: 'jev', kind: 'decision', model: 'jev-1.13.0', maxOptions: 255 },
        { name: 'claude', kind: 'agent', model: 'claude-opus-5-5', toolUse: true },
    ],
};

const servers: http.Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

function json(res: http.ServerResponse, status: number, body: any) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

/** A fake engine server: describes DESCRIPTION, and hands every other request to `handle`. */
async function engineServer(handle: Handler = (_seen, res) => json(res, 500, { protocol: 1, error: 'no', expose: false }), describe: Handler = (_seen, res) => json(res, 200, DESCRIPTION)) {
    const seen: Seen[] = [];
    const server = http.createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const entry: Seen = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
        seen.push(entry);
        res.on('close', () => { entry.closed = !res.writableFinished; });
        await (req.url === '/v1/engines' ? describe(entry, res) : handle(entry, res));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const env = (url: string, extra: Record<string, string> = {}) => ({ UAG_ENGINES: 'jev:remote,claude:remote', UAG_ENGINE_JEV_URL: url, UAG_ENGINE_JEV_KEY: KEY, UAG_ENGINE_CLAUDE_URL: url, UAG_ENGINE_CLAUDE_KEY: KEY, ...extra });
const config = { retries: 3, retryDelay: 5 };
const state = { input: { Description: 'My car was stolen.' }, today: '2026-10-22' };

async function refusal(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    }
    catch (err: any) {
        return err;
    }
    throw new Error('expected a failure');
}

describe('Remote engine type', () => {
    describe('startup', () => {
        it('takes each instance\'s kind, model and option limit from the engine server', async () => {
            const { url, seen } = await engineServer();
            const registry = await loadUAGEngines(config, env(url));
            expect(registry.get('jev')).to.include({ kind: 'decision', model: 'jev-1.13.0', maxOptions: 255 });
            expect(registry.get('claude')).to.include({ kind: 'agent', model: 'claude-opus-5-5', toolUse: true });
            expect(registry.source(registry.get('claude')!)).to.deep.equal({ type: 'remote' });
            expect(seen[0].headers.authorization).to.equal(`Bearer ${KEY}`);
        });

        it('uses another name on the engine server when told to', async () => {
            const { url } = await engineServer();
            const registry = await loadUAGEngines(config, { UAG_ENGINES: 'writer:remote', UAG_ENGINE_WRITER_URL: url, UAG_ENGINE_WRITER_KEY: KEY, UAG_ENGINE_WRITER_ENGINE: 'claude' });
            expect(registry.get('writer')).to.include({ kind: 'agent', model: 'claude-opus-5-5' });
        });

        it('retries while the engine server is failing, then starts', async () => {
            let failures = 2;
            const { url, seen } = await engineServer(undefined, (_seen, res) => (failures-- > 0 ? json(res, 503, {}) : json(res, 200, DESCRIPTION)));
            const registry = await loadUAGEngines(config, { UAG_ENGINES: 'claude:remote', UAG_ENGINE_CLAUDE_URL: url, UAG_ENGINE_CLAUDE_KEY: KEY });
            expect(registry.get('claude')).to.exist;
            expect(seen).to.have.length(3);
        });

        it('fails, naming the instance and the URL, when the engine server stays unreachable', async () => {
            const { url } = await engineServer();
            await new Promise((resolve) => { servers[0].closeAllConnections(); servers.pop()!.close(resolve); });
            const err = await refusal(loadUAGEngines(config, { UAG_ENGINES: 'claude:remote', UAG_ENGINE_CLAUDE_URL: url, UAG_ENGINE_CLAUDE_KEY: KEY }));
            expect(err.message).to.include('The "claude" engine could not start').and.include(`the engine server at ${url} is unreachable`);
        });

        it('refuses a URL with a user name or password, without repeating it', async () => {
            const err = await refusal(loadUAGEngines(config, { UAG_ENGINES: 'claude:remote', UAG_ENGINE_CLAUDE_URL: 'http://uag:hunter2secret@127.0.0.1:9', UAG_ENGINE_CLAUDE_KEY: KEY }));
            expect(err.message).to.include('must not include a user name or password');
            expect(err.message).to.not.include('hunter2secret');
        });

        it('fails at once when the engine server refuses the key', async () => {
            const { url, seen } = await engineServer(undefined, (_seen, res) => json(res, 401, { protocol: 1, error: 'Unauthorized', expose: true }));
            const err = await refusal(loadUAGEngines(config, { UAG_ENGINES: 'claude:remote', UAG_ENGINE_CLAUDE_URL: url, UAG_ENGINE_CLAUDE_KEY: KEY }));
            expect(err.message).to.include('"claude"').and.include('refused the engine server key');
            expect(err.message).to.not.include(KEY);
            expect(seen).to.have.length(1);
        });

        it('fails when the engine server does not host the engine, naming the ones it does', async () => {
            const { url } = await engineServer();
            const err = await refusal(loadUAGEngines(config, { UAG_ENGINES: 'gemini:remote', UAG_ENGINE_GEMINI_URL: url, UAG_ENGINE_GEMINI_KEY: KEY }));
            expect(err.message).to.include('does not host an engine named "gemini" (it hosts "jev", "claude")');
        });

        it('fails when the engine server answers in another protocol version', async () => {
            const { url } = await engineServer(undefined, (_seen, res) => json(res, 200, { ...DESCRIPTION, protocol: 2 }));
            const err = await refusal(loadUAGEngines(config, { UAG_ENGINES: 'claude:remote', UAG_ENGINE_CLAUDE_URL: url, UAG_ENGINE_CLAUDE_KEY: KEY }));
            expect(err.message).to.include('protocol 1').and.include('protocol 2');
        });

        it('needs a URL and a key of at least 32 characters, and never quotes the key', async () => {
            expect((await refusal(loadUAGEngines(config, { UAG_ENGINES: 'remote' }))).message)
                .to.equal('The "remote" engine (type "remote") needs its url setting: set UAG_ENGINE_REMOTE_URL.');
            const short = await refusal(loadUAGEngines(config, { UAG_ENGINES: 'remote', UAG_ENGINE_REMOTE_URL: 'http://engines:3300', UAG_ENGINE_REMOTE_KEY: 'short-secret' }));
            expect(short.message).to.include('at least 32 characters').and.not.include('short-secret');
            expect((await refusal(loadUAGEngines(config, { UAG_ENGINES: 'remote', UAG_ENGINE_REMOTE_URL: 'file:///etc/passwd', UAG_ENGINE_REMOTE_KEY: KEY }))).message)
                .to.include('http or https');
        });
    });

    describe('calls', () => {
        it('serves decisions through the engine server, with the same answers', async () => {
            const answers = { 'choice:type': { type: 'choice', choice: 'Theft', probabilities: { Theft: 0.9, Fire: 0.1 }, confidence: 0.8 } };
            const { url, seen } = await engineServer((_seen, res) => json(res, 200, { protocol: 1, model: 'jev-1.13.1', answers, usage: { inputTokens: 40, outputTokens: 2 } }));
            const registry = await loadUAGEngines(config, env(url));
            const questions = { 'choice:type': { type: 'choice' as const, instructions: 'Which?', options: { Theft: null, Fire: null } } };
            const result = await (registry.get('jev') as any).decide({ state, questions });
            expect(result).to.deep.equal({ model: 'jev-1.13.1', answers, usage: { inputTokens: 40, outputTokens: 2 } });
            const request = seen[seen.length - 1];
            expect(request.url).to.equal('/v1/engines/jev/decide');
            expect(request.body).to.deep.equal({ protocol: 1, state, questions });
        });

        it('sends the engine server key and no Form.io credential or scoped token for plain extraction', async () => {
            const { url, seen } = await engineServer((_seen, res) => json(res, 200, { protocol: 1, model: 'claude-opus-5-5', values: { location: 'Main Street' } }));
            const registry = await loadUAGEngines(config, env(url, { PROJECT_KEY: 'project-key-value', ADMIN_KEY: 'admin-key-value' }));
            const result = await (registry.get('claude') as any).extract({ instructions: 'Fill fields', state, fields: [{ path: 'location' }], schema: { type: 'object', properties: { location: { type: 'string' } } }, scopedToken: 'unused-for-extraction' });
            expect(result.values).to.deep.equal({ location: 'Main Street' });
            const request = seen[seen.length - 1];
            expect(request.headers.authorization).to.equal(`Bearer ${KEY}`);
            for (const header of ['x-token', 'x-admin-key', 'x-uag-scoped-token', 'x-jwt-token']) {
                expect(request.headers, header).to.not.have.property(header);
            }
            expect(JSON.stringify(request)).to.not.include('project-key-value').and.not.include('admin-key-value');
            expect(request.body).to.not.have.property('tools');
        });

        it('sends research tools, the iteration limit and the scoped token, and reports the server\'s tool calls', async () => {
            const toolCalls = [{ name: 'find_submissions', isError: false }, { name: 'get_forms', isError: true }];
            const { url, seen } = await engineServer((_seen, res) => json(res, 200, { protocol: 1, model: 'claude-opus-5-5', values: {}, toolCalls }));
            const registry = await loadUAGEngines(config, env(url));
            const tools = [{ name: 'find_submissions', description: 'Find', inputSchema: { type: 'object' } }];
            const result = await (registry.get('claude') as any).extract({ instructions: 'Research', state, fields: [], schema: { type: 'object', properties: {} }, tools, maxIterations: 4, scopedToken: 'scoped.jwt.token', callTool: async () => ({ content: [] }) });
            expect(result.toolCalls).to.deep.equal(toolCalls);
            const request = seen[seen.length - 1];
            expect(request.headers['x-uag-scoped-token']).to.equal('scoped.jwt.token');
            expect(request.body).to.include({ maxIterations: 4 });
            expect(request.body.tools).to.deep.equal(tools);
        });

        it('sends the request id on decide, extract and research extracts', async () => {
            const { url, seen } = await engineServer((entry, res) => json(res, 200, entry.url.endsWith('/decide')
                ? { protocol: 1, model: 'jev-1.13.0', answers: {} }
                : { protocol: 1, model: 'claude-opus-5-5', values: {} }));
            const registry = await loadUAGEngines(config, env(url));
            const tools = [{ name: 'find_submissions', description: 'Find', inputSchema: { type: 'object' } }];
            const before = seen.length;
            await withRequestId('demo.ab12cd.x9Y-z_1:2', async () => {
                await (registry.get('jev') as any).decide({ state, questions: {} });
                await (registry.get('claude') as any).extract({ instructions: 'Fill', state, fields: [], schema: { type: 'object', properties: {} } });
                await (registry.get('claude') as any).extract({ instructions: 'Research', state, fields: [], schema: { type: 'object', properties: {} }, tools, maxIterations: 2, scopedToken: 'scoped.jwt.token' });
            });
            const calls = seen.slice(before);
            expect(calls.map((call) => call.url)).to.deep.equal(['/v1/engines/jev/decide', '/v1/engines/claude/extract', '/v1/engines/claude/extract']);
            expect(calls.map((call) => call.headers['x-request-id'])).to.deep.equal(Array(3).fill('demo.ab12cd.x9Y-z_1:2'));
        });

        it('sends no request id that is not a short token, and none outside a request', async () => {
            const { url, seen } = await engineServer((_seen, res) => json(res, 200, { protocol: 1, model: 'claude-opus-5-5', values: {} }));
            const engine: any = (await loadUAGEngines(config, env(url))).get('claude');
            const request = { instructions: '', state, fields: [], schema: {} };
            const before = seen.length;
            for (const unsafe of ['x'.repeat(129), 'a b', 'id\r\nX-Injected: 1', '<script>', '']) {
                await withRequestId(unsafe, () => engine.extract(request));
            }
            await engine.extract(request);
            const calls = seen.slice(before);
            expect(calls).to.have.length(6);
            for (const call of calls) {
                expect(call.headers).to.not.have.property('x-request-id');
            }
        });

        it('refuses research without a scoped token, without calling the engine server', async () => {
            const { url, seen } = await engineServer();
            const registry = await loadUAGEngines(config, env(url));
            const before = seen.length;
            const err: any = await refusal((registry.get('claude') as any).extract({ instructions: 'Research', state, fields: [], schema: {}, tools: [{ name: 'get_forms', description: 'List', inputSchema: {} }], maxIterations: 2 }));
            expect(err.message).to.include('JWT_SECRET');
            expect(err.expose).to.equal(true);
            expect(seen).to.have.length(before);
        });

        it('tells callers the engine server could not be reached, without saying where it is', async () => {
            const { url } = await engineServer();
            const engine: any = (await loadUAGEngines(config, env(url))).get('claude');
            await new Promise((resolve) => { servers[0].closeAllConnections(); servers.pop()!.close(resolve); });
            const err: any = await refusal(engine.extract({ instructions: '', state, fields: [], schema: {} }));
            expect(err.message).to.equal('The engine server could not be reached.');
            expect(err.message).to.not.include(new URL(url).host);
        });

        it('passes on an error the engine server marks safe to show, and only the status otherwise', async () => {
            let reply: any = { protocol: 1, error: 'This server speaks remote engine protocol 2; the request used protocol 1.', expose: true };
            const { url } = await engineServer((_seen, res) => json(res, 400, reply));
            const engine: any = (await loadUAGEngines(config, env(url))).get('claude');
            const request = { instructions: '', state, fields: [], schema: {} };
            expect((await refusal(engine.extract(request))).message).to.equal(reply.error);
            reply = { protocol: 1, error: 'Anthropic said: invalid x-api-key sk-ant-123', expose: false };
            const hidden: any = await refusal(engine.extract(request));
            expect(hidden.message).to.equal('The engine server answered HTTP 400.');
            expect(hidden.expose).to.equal(true);
        });

        it('fails as an engine error when an answer breaks the protocol', async () => {
            const { url } = await engineServer((_seen, res) => json(res, 200, { protocol: 2, model: 'x', values: {} }));
            const engine: any = (await loadUAGEngines(config, env(url))).get('claude');
            expect((await refusal(engine.extract({ instructions: '', state, fields: [], schema: {} }))).message).to.include('did not follow the remote engine protocol');
        });

        it('aborts the request when the engine\'s timeout elapses', async () => {
            const { url, seen } = await engineServer(() => { /* never answers */ });
            const engine: any = (await loadUAGEngines(config, env(url))).get('claude');
            const err = await refusal(engine.extract({ instructions: '', state, fields: [], schema: {}, signal: AbortSignal.timeout(50) }));
            expect(err.name).to.equal('TimeoutError');
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(seen[seen.length - 1].closed).to.equal(true);
        });
    });
});
