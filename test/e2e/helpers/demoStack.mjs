import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnNode } from './proc.mjs';
import { startStack, FORMIO_URL, UAG_URL } from './stack.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);

export const ENGINE_SERVER_URL = 'http://127.0.0.1:3311';
export const ENGINE_CALLS_PORT = 3312;
export const SITE_URL = 'http://127.0.0.1:3420';
export const ENGINE_SERVER_KEY = 'uag-e2e-engine-server-key-0123456789abcdef';
export const DEMO_FORMS = ['serviceRequest', 'application', 'sum', 'claim', 'leaseReview', 'guest', 'guestRegister'];

/** The demo's project template, as the e2e module installs it. */
export const demoTemplate = () => JSON.parse(JSON.stringify(require('../../../demo/module/project.json')));

async function waitFor(check, what, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let last = 'no answer';
    while (Date.now() < deadline) {
        try {
            if (await check()) return;
        }
        catch (error) {
            last = error.message;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${what}: ${last}`);
}

/**
 * The demo site as it ships, on the open-source e2e stack: the static build
 * (demo/scripts/build.mjs), served as a static host serves it, whose pages call
 * the UAG and the project from the browser, as each visitor's guest user.
 *
 *   browser ─▶ site (static files)
 *      │
 *      ├─▶ Form.io OSS (the forms)
 *      └─▶ UAG ─▶ engine server  (guest registration, agent calls, saves)
 *           │         │
 *           └─▶ Form.io OSS ◀─ research (/mcp)
 *
 * The UAG serves the demo's own template (E2E_TEMPLATE=demo), allows the site's
 * origin (CORS), and runs both engines on the real engine server package,
 * hosting the scripted e2e engines. Applications and claims are saved through
 * the UAG, whose "Agent: Run task" actions run the agents, so the workflow runs
 * on Open Source as it does on Enterprise.
 *
 * `siteEnv` adds build settings (lib/config.mjs). `realEngines`
 * (`{ decision: 'jev', agent: 'claude' }`) hosts those installed engine types on
 * the engine server instead of the scripted ones, configured from the
 * environment (TYPESAFE_API_KEY, CLAUDE_API_KEY), as the demo recordings use it.
 */
export async function startDemoStack({ siteEnv = {}, uagEnv = {}, realEngines = null } = {}) {
    const processes = [];
    let stack = null;
    let site = null;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-site-'));
    const stop = async () => {
        if (site) await site.close();
        for (const proc of processes.reverse()) await proc.kill();
        if (stack) await stack.stop();
        fs.rmSync(out, { recursive: true, force: true });
    };
    try {
        const decisionEngine = realEngines ? realEngines.decision : 'e2e-decision';
        const agentEngine = realEngines ? realEngines.agent : 'e2e-agent';
        const engines = spawnNode(realEngines ? path.join(repoRoot, 'packages/engine-server/bin/uag-engines.js') : path.join(here, 'engineServerEntry.cjs'), {
            env: {
                PORT: new URL(ENGINE_SERVER_URL).port,
                HOST: '127.0.0.1',
                E2E_CALLS_PORT: String(ENGINE_CALLS_PORT),
                UAG_ENGINES: `${decisionEngine},${agentEngine}`,
                UAG_ENGINE_SERVER_KEY: ENGINE_SERVER_KEY,
                UAG_SERVER: UAG_URL,
                ADMIN_KEY: '', PROJECT_KEY: '', JWT_SECRET: '',
            },
        });
        processes.push(engines);
        await waitFor(() => fetch(`${ENGINE_SERVER_URL}/health`, { headers: { Authorization: `Bearer ${ENGINE_SERVER_KEY}` } }).then((r) => r.ok), `the engine server\n${engines.getOutput()}`);

        stack = await startStack({
            forms: DEMO_FORMS,
            uagEnv: {
                E2E_TEMPLATE: 'demo',
                // The site's origin, by either name a browser may use for it.
                CORS: `${SITE_URL},${SITE_URL.replace('127.0.0.1', 'localhost')}`,
                UAG_ENGINES: 'decide:remote,agent:remote',
                UAG_ENGINE_DECIDE_URL: ENGINE_SERVER_URL,
                UAG_ENGINE_DECIDE_KEY: ENGINE_SERVER_KEY,
                UAG_ENGINE_DECIDE_ENGINE: decisionEngine,
                UAG_ENGINE_AGENT_URL: ENGINE_SERVER_URL,
                UAG_ENGINE_AGENT_KEY: ENGINE_SERVER_KEY,
                UAG_ENGINE_AGENT_ENGINE: agentEngine,
                ...uagEnv,
            },
        });

        const { serveSite } = await import('../../../demo/scripts/serve.mjs');
        site = await serveSite({
            port: new URL(SITE_URL).port,
            env: {
                DEMO_PUBLIC_URL: SITE_URL,
                DEMO_OUT: out,
                FORMIO_PROJECT_URL: FORMIO_URL,
                DEMO_UAG_URL: UAG_URL,
                // Form.io Open Source has one project, at its root, which the UAG serves at its own.
                DEMO_UAG_PROJECT_PATH: '',
                ...siteEnv,
            },
        });

        return {
            stop,
            uag: stack.uag,
            site,
            engines,
            engineCalls: async () => (await fetch(`http://127.0.0.1:${ENGINE_CALLS_PORT}`)).json(),
        };
    }
    catch (error) {
        await stop().catch(() => {});
        throw error;
    }
}

/**
 * A guest of the demo's project, signed in as the site signs in each visitor
 * (js/guest.js): a registration on the project's guest/register form, through
 * the UAG, with generated credentials, which answers with the guest's token.
 * `json()` then calls the UAG with that token, as the site's pages do.
 * `uagUrl` is the project's URL on the UAG; it defaults to the open-source e2e
 * stack's.
 */
export async function guest({ uagUrl = UAG_URL } = {}) {
    const email = `guest-${Math.random().toString(16).slice(2)}@guest.invalid`;
    const password = `${Math.random().toString(36).slice(2)}A1!${Math.random().toString(36).slice(2)}`;
    const registered = await fetch(`${uagUrl}/guest/register/submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { email, password } }),
    });
    const token = registered.headers.get('x-jwt-token');
    const user = await registered.json().catch(() => null);
    if (!registered.ok || !token) throw new Error(`Guest registration answered ${registered.status}: ${JSON.stringify(user)}`);
    async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
        return fetch(`${uagUrl}${pathname}`, {
            method,
            headers: { 'x-jwt-token': token, ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }
    return {
        token,
        user,
        request,
        async json(pathname, options) {
            const response = await request(pathname, options);
            const text = await response.text();
            let parsed = text;
            try {
                parsed = JSON.parse(text);
            }
            catch {
                // Not JSON.
            }
            return { status: response.status, body: parsed, headers: response.headers };
        },
    };
}

/**
 * Opens an example page in `page` and starts its live demo, as a visitor does:
 * "Start the live demo" signs them in as a guest and loads the demo's frame.
 * Resolves to the frame's locator.
 */
export async function startExample(page, name, { site = SITE_URL } = {}) {
    await page.goto(`${site}/examples/${name}`);
    const start = page.locator('[data-demo-start]');
    await start.or(page.locator('[data-demo-frame]:not([hidden])')).first().waitFor();
    if (await start.isVisible()) await start.click();
    await page.locator('[data-demo-frame]:not([hidden])').waitFor();
    return page.frameLocator('iframe[data-demo-frame]');
}

/** The runs the example page's flow log shows, oldest first: `{ title, labels, text }` each. */
export async function flowLog(page) {
    return page.locator('[data-flow] .flow-run').evaluateAll((runs) => runs.map((run) => ({
        title: run.querySelector('.flow-run-head span')?.textContent || '',
        labels: [...run.querySelectorAll('.flow-label')].map((el) => el.textContent),
        text: run.innerText,
    })).reverse());
}
