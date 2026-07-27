import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnNode, waitForHttp } from './proc.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const composeFile = path.join(here, '../docker-compose.yml');

export const FORMIO_URL = 'http://127.0.0.1:3101';
export const UAG_URL = 'http://127.0.0.1:3210';
export const UAG_CLAUDE_URL = 'http://127.0.0.1:3310';
export const ADMIN_KEY = 'uag-e2e-admin-key';
const JWT_SECRET = 'uag-e2e-secret';

/**
 * Boots the full stack for the e2e tests:
 *   - Form.io OSS + Mongo via docker compose
 *   - The UAG server as a local child process (from ./lib, with the e2e module)
 *   - Optionally the uag-claude integration server as a local child process
 */
export async function startStack({ withClaudeIntegration = false } = {}) {
    await exec('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait'], { timeout: 180000 })
        .catch(() => exec('docker', ['compose', '-f', composeFile, 'up', '-d'], { timeout: 180000 }));

    let uag = null;
    let claude = null;
    const stop = async () => {
        if (claude) await claude.kill();
        if (uag) await uag.kill();
        await exec('docker', ['compose', '-f', composeFile, 'down', '-v'], { timeout: 120000 });
    };
    try {
        return await boot();
    }
    catch (error) {
        // A partially booted stack must not leak into the next spec file.
        await stop().catch(() => {});
        throw error;
    }

    async function boot() {
        // The formio container needs time to install its default template on first boot.
        await waitForFormio();

        uag = spawnNode(path.join(here, 'uagEntry.cjs'), {
            cwd: repoRoot,
            env: {
                PORT: '3210',
                PROJECT: FORMIO_URL,
                ADMIN_KEY,
                JWT_SECRET,
                JWT_EXPIRE_TIME: '525600',
                LOGIN_FORM: `${UAG_URL}/auth/authorize`,
                BASE_URL: UAG_URL,
                PROJECT_TTL: '0',
                DEBUG: '',
            },
        });
        // Wait until the UAG project has fully loaded: the token endpoint must issue
        // real tokens, and the e2e template import must have landed in Form.io.
        await waitFor(async () => { await getUagToken(); }, 'UAG token endpoint', 60000);
        await waitFor(async () => {
            const resp = await fetch(`${FORMIO_URL}/form?limit=100&select=name`, { headers: { 'x-admin-key': ADMIN_KEY } });
            const names = (await resp.json()).map((f) => f.name);
            if (!names.includes('customer') || !names.includes('application')) {
                throw new Error(`template not imported yet (have: ${names.join(', ')})`);
            }
        }, 'UAG template import', 60000);

        if (withClaudeIntegration) {
            claude = spawnNode(path.join(repoRoot, 'integrations/claude/index.js'), {
                cwd: path.join(repoRoot, 'integrations/claude'),
                env: {
                    UAG_SERVER: UAG_URL,
                    ADMIN_KEY,
                    PROJECT: '',
                    PROJECT_KEY: '',
                    PORT: '3310',
                    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || '',
                    CLAUDE_MODEL: process.env.E2E_CLAUDE_MODEL || 'claude-opus-5',
                    CLAUDE_MAX_TOKENS: '8192',
                    CLAUDE_MAX_ITERATIONS: '25',
                },
            });
            await waitForHttp(`${UAG_CLAUDE_URL}/agent/claude`, { method: 'POST', timeoutMs: 30000 });
        }

        return { uag, claude, stop };
    }
}

async function waitFor(check, what, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'no response';
    while (Date.now() < deadline) {
        try {
            await check();
            return;
        }
        catch (error) {
            lastError = error.message;
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Timed out waiting for ${what}: ${lastError}`);
}

async function waitForFormio() {
    // A freshly booted formio container installs its default template
    // asynchronously — an early /form response does not mean it is done. Wait
    // for the form count to be complete (the default template has at least 5
    // forms) and stable across two consecutive polls.
    let previousCount = -1;
    await waitFor(async () => {
        const resp = await fetch(`${FORMIO_URL}/form?limit=100&select=name`, {
            headers: { 'x-admin-key': ADMIN_KEY },
            signal: AbortSignal.timeout(3000),
        });
        if (!resp.ok && resp.status !== 206) {
            throw new Error(`status ${resp.status}`);
        }
        const count = (await resp.json()).length;
        const stable = count >= 5 && count === previousCount;
        previousCount = count;
        if (!stable) {
            throw new Error(`default template still installing (${count} forms)`);
        }
    }, 'Form.io OSS server', 120000);
}

/**
 * Fetches an admin access token from the UAG token endpoint using the OSS
 * admin key (client_credentials grant).
 */
export async function getUagToken() {
    const resp = await fetch(`${UAG_URL}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: 'formio-oss-x-admin-key',
            client_secret: ADMIN_KEY,
        }),
    });
    if (!resp.ok) {
        throw new Error(`Failed to get UAG token: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!data.access_token) {
        throw new Error(`Token endpoint returned no access_token: ${JSON.stringify(data)}`);
    }
    return data.access_token;
}

/**
 * Connects an MCP client to the UAG /mcp endpoint using a Bearer token.
 */
export async function connectMcp(token) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const mcp = new Client({ name: 'uag-e2e', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${UAG_URL}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return mcp;
}

/** Direct Form.io OSS REST helpers (bypassing the UAG) for assertions and fixtures. */
export const formio = {
    async getSubmissions(formPath, query = '') {
        const resp = await fetch(`${FORMIO_URL}/${formPath}/submission?limit=100${query}`, {
            headers: { 'x-admin-key': ADMIN_KEY },
        });
        if (!resp.ok && resp.status !== 206) {
            throw new Error(`Failed to list ${formPath} submissions: HTTP ${resp.status}`);
        }
        return resp.json();
    },
    async getSubmission(formPath, id) {
        const resp = await fetch(`${FORMIO_URL}/${formPath}/submission/${id}`, {
            headers: { 'x-admin-key': ADMIN_KEY },
        });
        if (!resp.ok) {
            throw new Error(`Failed to read ${formPath}/${id}: HTTP ${resp.status}`);
        }
        return resp.json();
    },
    async createSubmission(formPath, data) {
        const resp = await fetch(`${FORMIO_URL}/${formPath}/submission`, {
            method: 'POST',
            headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
        });
        if (!resp.ok) {
            throw new Error(`Failed to create ${formPath} submission: HTTP ${resp.status} ${await resp.text()}`);
        }
        return resp.json();
    },
};

/** Extracts the concatenated text out of an MCP tool result. */
export function mcpText(result) {
    return (result.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}
