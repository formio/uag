import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnNode } from './proc.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const composeFile = path.join(here, '../docker-compose.yml');

export const FORMIO_URL = 'http://127.0.0.1:3101';
export const UAG_URL = 'http://127.0.0.1:3210';
export const ADMIN_KEY = 'uag-e2e-admin-key';
export const JWT_SECRET = 'uag-e2e-secret';
/**
 * The UAG license the stack runs under. Agentic Formflow needs one (or a hosted
 * project) wherever the project runs, so the suites that use it need
 * E2E_UAG_LICENSE and are skipped without it; MCP and conversation forms do not.
 * Any license serves the stack's `localhost` project.
 */
export const E2E_LICENSE = process.env.E2E_UAG_LICENSE || '';

/** Skip a suite that runs Agentic Formflow when E2E_UAG_LICENSE is not set. Call from `before`. */
export function requireLicense(context) {
    if (!E2E_LICENSE) {
        console.log('    Skipping: Agentic Formflow needs a license. Set E2E_UAG_LICENSE.');
        context.skip();
    }
}

/**
 * Boots the full stack for the e2e tests:
 *   - Form.io OSS + Mongo via docker compose
 *   - The UAG server as a local child process (from ./lib, with the e2e module)
 *
 * `uagEnv` adds environment variables for the UAG, such as UAG_ENGINES.
 * `forms` names the template's forms to wait for, when it is not the e2e one.
 */
export async function startStack({ uagEnv = {}, forms = ['customer', 'application', 'claim', 'incident', 'routing'] } = {}) {
    await exec('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait'], { timeout: 180000 })
        .catch(() => exec('docker', ['compose', '-f', composeFile, 'up', '-d'], { timeout: 180000 }));

    let uag = null;
    const stop = async () => {
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
                // `localhost`, which any license serves, rather than the published 127.0.0.1.
                PROJECT: FORMIO_URL.replace('127.0.0.1', 'localhost'),
                UAG_LICENSE: E2E_LICENSE,
                ADMIN_KEY,
                JWT_SECRET,
                JWT_EXPIRE_TIME: '525600',
                LOGIN_FORM: `${UAG_URL}/auth/authorize`,
                PROJECT_TTL: '0',
                DEBUG: '',
                ...uagEnv,
            },
        });
        // Wait until the UAG project has fully loaded: the token endpoint must issue
        // real tokens, and the e2e template import must have landed in Form.io.
        try {
            await waitFor(async () => { await getUagToken(); }, 'UAG token endpoint', 60000);
        }
        catch (error) {
            // Say why the UAG did not come up, rather than only that it did not.
            error.message += `\nUAG output:\n${uag.getOutput().slice(-3000)}`;
            throw error;
        }
        await waitFor(async () => {
            const resp = await fetch(`${FORMIO_URL}/form?limit=100&select=name`, { headers: { 'x-admin-key': ADMIN_KEY } });
            const names = (await resp.json()).map((f) => f.name);
            if (!forms.every((name) => names.includes(name))) {
                throw new Error(`template not imported yet (have: ${names.join(', ')})`);
            }
        }, 'UAG template import', 60000);

        return { uag, stop };
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
