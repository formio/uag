'use strict';
const { expect } = require('chai');
const express = require('express');
const { defineEngine, EngineError } = require('@formio/uag-sdk');
const { createEngineServer } = require('..');
const { isPrivateAddress, publicAddresses } = require('../network');

const KEY = 'engine-server-test-key-0123456789abcdef';
const UAG = 'http://uag.internal:3200';
const state = { input: { Notes: 'Ada lives in London.' }, today: '2026-10-22' };
const schema = { type: 'object', properties: { name: { type: 'string' }, city: { type: 'string' } } };

/** Scripted engines: what they were sent, and what they do, are set per test. */
const seen = [];
let script = async () => ({});

const scripted = defineEngine({
    type: 'scripted',
    kinds: ['agent'],
    apiVersion: 1,
    create: ({ name }) => ({
        name,
        kind: 'agent',
        model: 'scripted-1',
        toolUse: true,
        async extract(request) {
            seen.push(request);
            return { model: 'scripted-1', ...(await script(request)) };
        },
    }),
});

const plain = defineEngine({
    type: 'plain',
    kinds: ['agent'],
    apiVersion: 1,
    create: ({ name }) => ({ name, kind: 'agent', model: 'plain-1', extract: async () => ({ model: 'plain-1', values: {} }) }),
});

const fixed = defineEngine({
    type: 'fixed',
    kinds: ['decision'],
    apiVersion: 1,
    create: ({ name }) => ({
        name,
        kind: 'decision',
        model: 'fixed-1',
        maxOptions: 255,
        decide: async () => ({ model: 'fixed-1', answers: { asked: { type: 'noul', probability: 0.9 }, unasked: { type: 'noul', probability: 0.1 } } }),
    }),
});

/** A fake MCP client: lists `listed`, answers calls, and records what it was given. */
function fakeMcp(listed = ['find_submissions', 'get_forms', 'get_form_fields']) {
    const mcp = { connects: [], calls: [], closed: 0 };
    mcp.connect = async (url, token, requestId) => {
        mcp.connects.push({ url, token, ...(requestId !== undefined && { requestId }) });
        return {
            listTools: async () => ({ tools: listed.map((name) => ({ name, description: `The ${name} tool`, inputSchema: { type: 'object', properties: {} } })) }),
            callTool: async ({ name, arguments: args }, _schema, options) => {
                mcp.calls.push({ name, args });
                await new Promise((resolve) => setTimeout(resolve, 5));
                options?.signal?.throwIfAborted();
                return { content: [{ type: 'text', text: `${name} result` }], isError: name === 'get_forms' };
            },
            close: async () => { mcp.closed++; },
        };
    };
    return mcp;
}

const servers = [];
afterEach(async () => {
    seen.length = 0;
    script = async () => ({});
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

async function start({ env = {}, connect } = {}) {
    const { app } = await createEngineServer({
        env: { UAG_ENGINE_SERVER_KEY: KEY, UAG_SERVER: UAG, UAG_ENGINES: 'scripted,plain,fixed', ...env },
        types: { scripted, plain, fixed },
        connect,
    });
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
}

function post(url, path, body, headers = {}) {
    return fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

const extract = (extra = {}) => ({ protocol: 1, instructions: 'Fill fields', state, fields: [{ path: 'name' }, { path: 'city' }], schema, ...extra });
const tools = (...names) => names.map((name) => ({ name, description: 'requested', inputSchema: { type: 'object' } }));

async function failure(promise) {
    try {
        await promise;
    }
    catch (err) {
        return err;
    }
    throw new Error('expected a failure');
}

describe('engine server', () => {
    describe('startup', () => {
        it('refuses to start without a key, or with a short one', async () => {
            expect((await failure(createEngineServer({ env: { UAG_ENGINES: 'scripted' }, types: { scripted } }))).message).to.include('UAG_ENGINE_SERVER_KEY is not set');
            expect((await failure(createEngineServer({ env: { UAG_ENGINES: 'scripted', UAG_ENGINE_SERVER_KEY: 'short' }, types: { scripted } }))).message).to.include('at least 32 characters');
        });

        it('refuses to start with nothing to serve, or a UAG_SERVER that is not a URL', async () => {
            expect((await failure(createEngineServer({ env: { UAG_ENGINE_SERVER_KEY: KEY } }))).message).to.include('names no engines');
            expect((await failure(createEngineServer({ env: { UAG_ENGINE_SERVER_KEY: KEY, UAG_ENGINES: 'scripted', UAG_SERVER: 'file:///etc' }, types: { scripted } }))).message).to.include('http or https');
        });

        it('resolves instances as the UAG does', async () => {
            const { engines } = await createEngineServer({ env: { UAG_ENGINE_SERVER_KEY: KEY, UAG_ENGINES: 'fast:scripted,deep:scripted' }, types: { scripted } });
            expect(engines.map(({ engine }) => engine.name)).to.deep.equal(['fast', 'deep']);
        });
    });

    describe('authentication', () => {
        it('answers 401 to a missing or wrong key before reading the body', async () => {
            const url = await start();
            for (const authorization of [undefined, `Bearer ${KEY}x`, `Bearer ${KEY.slice(0, -1)}`, KEY, 'Bearer ']) {
                const res = await fetch(`${url}/v1/engines/scripted/extract`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(authorization && { Authorization: authorization }) },
                    body: '{not json',
                });
                expect(res.status, String(authorization)).to.equal(401);
                expect(await res.json()).to.deep.equal({ protocol: 1, error: 'Unauthorized.', expose: true });
            }
            expect((await fetch(`${url}/health`)).status).to.equal(401);
            expect(seen).to.have.length(0);
        });
    });

    describe('protocol', () => {
        it('describes its engines, and nothing about their settings', async () => {
            const url = await start({ env: { UAG_ENGINES: 'scripted,plain,fixed' } });
            const res = await fetch(`${url}/v1/engines`, { headers: { Authorization: `Bearer ${KEY}` } });
            expect(await res.json()).to.deep.equal({
                protocol: 1,
                engines: [
                    { name: 'scripted', kind: 'agent', model: 'scripted-1', toolUse: true },
                    { name: 'plain', kind: 'agent', model: 'plain-1', toolUse: false },
                    { name: 'fixed', kind: 'decision', model: 'fixed-1', maxOptions: 255 },
                ],
            });
            expect((await fetch(`${url}/health`, { headers: { Authorization: `Bearer ${KEY}` } })).status).to.equal(200);
        });

        it('refuses an unknown engine, the wrong kind, and another protocol version', async () => {
            const url = await start();
            const unknown = await post(url, '/v1/engines/gemini/extract', extract());
            expect(unknown.status).to.equal(404);
            expect((await unknown.json()).error).to.include('"gemini"');
            expect((await post(url, '/v1/engines/fixed/extract', extract())).status).to.equal(400);
            const mismatch = await post(url, '/v1/engines/scripted/extract', extract({ protocol: 2 }));
            expect(mismatch.status).to.equal(400);
            expect(await mismatch.json()).to.deep.include({ expose: true, error: 'This side speaks remote engine protocol 1; the request used protocol 2.' });
            expect((await post(url, '/v1/engines/scripted/extract', '{not json')).status).to.equal(400);
            expect(seen).to.have.length(0);
        });

        it('answers decisions, only for the questions asked', async () => {
            const url = await start();
            const res = await post(url, '/v1/engines/fixed/decide', { protocol: 1, state, questions: { asked: { type: 'noul', instructions: 'Urgent?' } } });
            expect(await res.json()).to.deep.equal({ protocol: 1, model: 'fixed-1', answers: { asked: { type: 'noul', probability: 0.9 } } });
        });

        it('extracts without connecting to the UAG, and returns only the fields asked', async () => {
            const mcp = fakeMcp();
            script = async () => ({ values: { name: 'Ada', city: 'London', gpa: 4 }, usage: { inputTokens: 5, outputTokens: 2 } });
            const url = await start({ connect: mcp.connect });
            const res = await post(url, '/v1/engines/scripted/extract', extract(), { 'x-uag-scoped-token': 'ignored' });
            expect(await res.json()).to.deep.equal({ protocol: 1, model: 'scripted-1', values: { name: 'Ada', city: 'London' }, usage: { inputTokens: 5, outputTokens: 2 } });
            expect(mcp.connects).to.have.length(0);
            expect(seen[0]).to.not.have.property('tools');
        });
    });

    describe('research', () => {
        it('connects to its configured UAG with the scoped token, offering only tools requested and listed', async () => {
            const mcp = fakeMcp(['find_submissions', 'get_forms', 'get_form_fields']);
            script = async (request) => {
                for (const name of ['find_submissions', 'get_forms', 'submission_update']) {
                    await request.callTool(name, { form_name: 'claim' });
                }
                return { values: { name: 'Ada' }, toolCalls: [] };
            };
            const url = await start({ connect: mcp.connect });
            const res = await post(url, '/v1/engines/scripted/extract',
                extract({ tools: tools('find_submissions', 'get_forms', 'submission_update'), maxIterations: 3, uagServer: 'http://evil.example' }),
                { 'x-uag-scoped-token': 'scoped.jwt', Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' });
            const body = await res.json();
            expect(mcp.connects).to.deep.equal([{ url: `${UAG}/mcp`, token: 'scoped.jwt' }]);
            expect(seen[0].tools.map((tool) => tool.name)).to.deep.equal(['find_submissions', 'get_forms']);
            expect(seen[0].tools[0].description).to.equal('The find_submissions tool');
            expect(seen[0].maxIterations).to.equal(3);
            expect(mcp.calls.map((call) => call.name)).to.deep.equal(['find_submissions', 'get_forms']);
            // The calls this server made, whatever the engine reports.
            expect(body.toolCalls).to.deep.equal([
                { name: 'find_submissions', isError: false },
                { name: 'get_forms', isError: true },
                { name: 'submission_update', isError: true },
            ]);
            expect(mcp.closed).to.equal(1);
        });

        it('connects with the UAG\'s request id only when it is a short token', async () => {
            const mcp = fakeMcp();
            const url = await start({ connect: mcp.connect });
            const request = extract({ tools: tools('get_forms'), maxIterations: 2 });
            for (const id of ['demo.ab12cd.x9Y-z_1:2', 'x'.repeat(129), 'a b', '<script>', undefined]) {
                const res = await post(url, '/v1/engines/scripted/extract', request, { 'x-uag-scoped-token': 't', ...(id !== undefined && { 'X-Request-Id': id }) });
                expect(res.status, String(id)).to.equal(200);
            }
            expect(mcp.connects.map((connect) => connect.requestId)).to.deep.equal(['demo.ab12cd.x9Y-z_1:2', undefined, undefined, undefined, undefined]);
        });

        it('refuses research without a scoped token, without UAG_SERVER, or for an engine that cannot research', async () => {
            const mcp = fakeMcp();
            const url = await start({ connect: mcp.connect });
            const request = extract({ tools: tools('get_forms'), maxIterations: 2 });
            const noToken = await post(url, '/v1/engines/scripted/extract', request);
            expect(noToken.status).to.equal(400);
            expect((await noToken.json()).error).to.include('x-uag-scoped-token');
            expect((await post(url, '/v1/engines/plain/extract', request, { 'x-uag-scoped-token': 't' })).status).to.equal(400);
            const unconfigured = await start({ env: { UAG_SERVER: '' }, connect: mcp.connect });
            expect((await post(unconfigured, '/v1/engines/scripted/extract', request, { 'x-uag-scoped-token': 't' })).status).to.equal(503);
            expect(mcp.connects).to.have.length(0);
        });

        it('stops the engine and makes no further calls when the UAG aborts the request', async () => {
            const mcp = fakeMcp();
            let signal;
            let refused;
            script = async (request) => {
                signal = request.signal;
                await request.callTool('find_submissions', {});
                await new Promise((resolve) => setTimeout(resolve, 150));
                refused = await request.callTool('find_submissions', {}).then(() => false, () => true);
                return { values: {} };
            };
            const url = await start({ connect: mcp.connect });
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 60);
            const err = await failure(fetch(`${url}/v1/engines/scripted/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'x-uag-scoped-token': 't' },
                body: JSON.stringify(extract({ tools: tools('find_submissions'), maxIterations: 5 })),
                signal: controller.signal,
            }));
            expect(err.name).to.equal('AbortError');
            await new Promise((resolve) => setTimeout(resolve, 250));
            expect(signal.aborted).to.equal(true);
            expect(refused).to.equal(true);
            expect(mcp.calls).to.have.length(1);
            expect(mcp.closed).to.equal(1);
        });

        it('researches through a real MCP server, which decides what the token allows, with the request id on every call', async () => {
            const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
            const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
            const uag = express();
            uag.use(express.json());
            const tokens = [];
            const requestIds = [];
            uag.post('/mcp', async (req, res) => {
                tokens.push(req.get('authorization'));
                requestIds.push(req.get('x-request-id'));
                const mcp = new McpServer({ name: 'fake-uag', version: '1.0.0' });
                mcp.registerTool('get_forms', { description: 'List forms' }, async () => ({ content: [{ type: 'text', text: '["claim"]' }] }));
                const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
                await mcp.connect(transport);
                await transport.handleRequest(req, res, req.body);
            });
            const uagServer = await new Promise((resolve) => { const s = uag.listen(0, '127.0.0.1', () => resolve(s)); });
            servers.push(uagServer);
            script = async (request) => {
                const result = await request.callTool('get_forms', {});
                return { values: { city: result.content[0].text } };
            };
            const url = await start({ env: { UAG_SERVER: `http://127.0.0.1:${uagServer.address().port}` } });
            const res = await post(url, '/v1/engines/scripted/extract', extract({ tools: tools('get_forms', 'find_submissions'), maxIterations: 2 }), { 'x-uag-scoped-token': 'scoped.jwt', 'X-Request-Id': 'demo.ab12cd.x9Y' });
            const body = await res.json();
            expect(body.values).to.deep.equal({ city: '["claim"]' });
            expect(body.toolCalls).to.deep.equal([{ name: 'get_forms', isError: false }]);
            expect(seen[0].tools.map((tool) => tool.name)).to.deep.equal(['get_forms']);
            expect(tokens.length).to.be.greaterThan(0);
            expect(tokens.every((token) => token === 'Bearer scoped.jwt')).to.equal(true);
            expect(requestIds).to.have.length(tokens.length);
            expect(requestIds.every((id) => id === 'demo.ab12cd.x9Y')).to.equal(true);
        });
    });

    describe('engine failures', () => {
        it('passes on a message the engine marks safe to show, and only a generic one otherwise', async () => {
            const url = await start();
            script = async () => { throw new EngineError('Quota exceeded for this API key.'); };
            const shown = await post(url, '/v1/engines/scripted/extract', extract());
            expect(shown.status).to.equal(502);
            expect(await shown.json()).to.deep.equal({ protocol: 1, error: 'Quota exceeded for this API key.', expose: true });
            script = async () => { throw new Error('401 from https://api.example.com with key sk-live-secret'); };
            const hidden = await post(url, '/v1/engines/scripted/extract', extract());
            expect(hidden.status).to.equal(502);
            const body = await hidden.json();
            expect(body).to.deep.equal({ protocol: 1, error: 'The engine failed (see the engine server logs).', expose: false });
        });

        it('logs every engine failure in one line with the request id, without the request', async () => {
            const url = await start();
            const logged = [];
            const saved = console.error;
            console.error = (line) => logged.push(line);
            try {
                script = async () => { throw Object.assign(new Error('Invalid API key\n    at provider internals'), { name: 'AuthenticationError', status: 401 }); };
                await post(url, '/v1/engines/scripted/extract', extract(), { 'X-Request-Id': 'req.ab12cd' });
                script = async () => { throw new EngineError('Quota exceeded for this API key.'); };
                await post(url, '/v1/engines/scripted/extract', extract());
            }
            finally {
                console.error = saved;
            }
            expect(logged).to.deep.equal([
                '[uag-engines] [req.ab12cd] POST /v1/engines/scripted/extract failed: AuthenticationError (401): Invalid API key',
                '[uag-engines] [-] POST /v1/engines/scripted/extract failed: EngineError: Quota exceeded for this API key.',
            ]);
            expect(logged.join('\n')).to.not.include('Ada lives in London');
        });

        it('answers request body problems with their own 4xx status, not as an engine failure', async () => {
            const url = await start();
            const charset = await fetch(`${url}/v1/engines/scripted/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=klingon', Authorization: `Bearer ${KEY}` },
                body: JSON.stringify(extract()),
            });
            expect(charset.status).to.equal(415);
            expect((await charset.json()).expose).to.equal(true);
            const invalid = await post(url, '/v1/engines/scripted/extract', '{ not json');
            expect(invalid.status).to.equal(400);
        });
    });

    describe('research connect', () => {
        it('stops without listing tools or extracting when the UAG gives up while it connects', async () => {
            const mcp = fakeMcp();
            const { openResearch } = require('../research');
            const controller = new AbortController();
            let listed = 0;
            const connect = async (...args) => {
                const client = await mcp.connect(...args);
                controller.abort(new Error('gave up'));
                return { ...client, listTools: async () => { listed++; return client.listTools(); } };
            };
            const err = await failure(openResearch({ uagServer: UAG, token: 't', requested: tools('get_forms'), signal: controller.signal, connect }));
            expect(err.message).to.equal('gave up');
            expect(listed).to.equal(0);
            expect(mcp.closed).to.equal(1);
        });
    });
});

describe('uag-engines binary', function () {
    this.timeout(15000);
    const { spawn } = require('child_process');
    const path = require('path');

    it('listens on 127.0.0.1 by default, and exits cleanly on SIGTERM', async () => {
        const port = await new Promise((resolve) => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
        const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'uag-engines.js')], {
            env: { PATH: process.env.PATH, UAG_ENGINES: 'jev', TYPESAFE_API_KEY: 'ts-test', UAG_ENGINE_SERVER_KEY: KEY, PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
        try {
            for (let i = 0; i < 100 && !output.includes('Serving'); i++) await new Promise((resolve) => setTimeout(resolve, 50));
            expect(output).to.include(`on 127.0.0.1:${port}.`);
            const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${KEY}` } });
            expect(health.status).to.equal(200);
            child.kill('SIGTERM');
            expect(await exited).to.deep.equal({ code: 0, signal: null });
        }
        finally {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
    });
});

describe('network', () => {
    it('tells private addresses from public ones', () => {
        for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
            expect(isPrivateAddress(ip), ip).to.equal(true);
        }
        for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1', '::ffff:8.8.8.8']) {
            expect(isPrivateAddress(ip), ip).to.equal(false);
        }
    });

    it('finds the public addresses a bind exposes', () => {
        const interfaces = {
            lo: [{ address: '127.0.0.1', internal: true }],
            eth0: [{ address: '172.18.0.4', internal: false }],
            eth1: [{ address: '203.0.113.7', internal: false }],
        };
        expect(publicAddresses('0.0.0.0', interfaces)).to.deep.equal(['203.0.113.7']);
        expect(publicAddresses('172.18.0.4', interfaces)).to.deep.equal([]);
        expect(publicAddresses('203.0.113.7', interfaces)).to.deep.equal(['203.0.113.7']);
        expect(publicAddresses('0.0.0.0', { lo: interfaces.lo, eth0: interfaces.eth0 })).to.deep.equal([]);
    });
});

