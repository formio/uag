import { expect } from 'chai';
import path from 'path';
import { fileURLToPath } from 'url';
import { startStubUag } from './helpers/stubUag.mjs';
import { spawnNode, waitForHttp } from './helpers/proc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const INTEGRATION_PORT = 3311;
const ADMIN_KEY = 'e2e-admin-key';
const MODEL = process.env.E2E_CLAUDE_MODEL || 'claude-haiku-4-5';

/**
 * Layer 2: end-to-end tests for the uag-claude integration server.
 *
 * Runs the real integration server (integrations/claude/index.js) against a
 * stub UAG MCP server, with real Claude API calls. Verifies authentication,
 * the local MCP client tool loop, and error handling.
 */
describe('Layer 2: uag-claude integration', function () {
    this.timeout(120000);

    let stub;
    let integration;
    const url = (p) => `http://127.0.0.1:${INTEGRATION_PORT}${p}`;

    before(async function () {
        if (!process.env.CLAUDE_API_KEY) {
            console.warn('    Skipping: CLAUDE_API_KEY is not set.');
            this.skip();
        }
        stub = await startStubUag();
        integration = spawnNode(path.join(repoRoot, 'integrations/claude/index.js'), {
            cwd: path.join(repoRoot, 'integrations/claude'),
            env: {
                UAG_SERVER: stub.url,
                ADMIN_KEY,
                PROJECT: '',
                PROJECT_KEY: '',
                PORT: String(INTEGRATION_PORT),
                CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                CLAUDE_MODEL: MODEL,
                CLAUDE_MAX_TOKENS: '1024',
            },
        });
        await waitForHttp(url('/agent/claude'), { method: 'POST' });
    });

    after(async function () {
        if (integration) await integration.kill();
        if (stub) await stub.close();
    });

    it('rejects requests without an auth header', async function () {
        const resp = await fetch(url('/agent/claude'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'hello' }),
        });
        expect(resp.status).to.equal(401);
    });

    it('rejects requests with an invalid admin key', async function () {
        const resp = await fetch(url('/agent/claude'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': 'wrong-key' },
            body: JSON.stringify({ command: 'hello' }),
        });
        expect(resp.status).to.equal(401);
    });

    it('rejects requests without a command', async function () {
        const resp = await fetch(url('/agent/claude'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
            body: JSON.stringify({}),
        });
        expect(resp.status).to.equal(400);
    });

    it('runs the full tool loop against the UAG MCP server', async function () {
        const resp = await fetch(url('/agent/claude'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
            body: JSON.stringify({
                command: 'Use the echo tool to echo the word "verified", then tell me exactly what the tool returned.',
            }),
        });
        expect(resp.status, integration.getOutput()).to.equal(200);
        const message = await resp.json();
        expect(message.stop_reason).to.equal('end_turn');
        const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        expect(text).to.include('ECHO:verified');
        // The MCP requests must carry the Bearer token obtained from /auth/token.
        expect(stub.state.authTokenRequests).to.be.greaterThan(0);
        expect(stub.state.lastAuthHeader).to.match(/^Bearer /);
    });

    it('surfaces tool errors to the agent without crashing the request', async function () {
        const resp = await fetch(url('/agent/claude'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
            body: JSON.stringify({
                command: 'Call the broken tool once, then report in one sentence whether it succeeded or failed.',
            }),
        });
        expect(resp.status, integration.getOutput()).to.equal(200);
        const message = await resp.json();
        expect(message.stop_reason).to.equal('end_turn');
        const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').toLowerCase();
        expect(text).to.match(/fail|error|broken|did not succeed/);
    });

    it('returns a 500 when the UAG is unreachable', async function () {
        // A stub that is started and immediately closed leaves a known-dead URL.
        const deadStub = await startStubUag();
        await deadStub.close();
        const isolated = spawnNode(path.join(repoRoot, 'integrations/claude/index.js'), {
            cwd: path.join(repoRoot, 'integrations/claude'),
            env: {
                UAG_SERVER: deadStub.url,
                ADMIN_KEY,
                PROJECT: '',
                PROJECT_KEY: '',
                PORT: '3312',
                CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                CLAUDE_MODEL: MODEL,
                CLAUDE_MAX_TOKENS: '1024',
            },
        });
        try {
            await waitForHttp('http://127.0.0.1:3312/agent/claude', { method: 'POST' });
            const resp = await fetch('http://127.0.0.1:3312/agent/claude', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                body: JSON.stringify({ command: 'hello' }),
            });
            expect(resp.status).to.equal(500);
        }
        finally {
            await isolated.kill();
        }
    });
});
