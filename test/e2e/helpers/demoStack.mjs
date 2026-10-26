import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnNode, waitForHttp } from './proc.mjs';
import { startStack, FORMIO_URL, UAG_URL, ADMIN_KEY } from './stack.mjs';
import { startWebhookRelay } from './webhookRelay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);

export const ENGINE_SERVER_URL = 'http://127.0.0.1:3311';
export const ENGINE_CALLS_PORT = 3312;
export const FLOW_URL = 'http://127.0.0.1:3251';
export const SITE_URL = 'http://127.0.0.1:3420';
export const FLOW_KEY = 'uag-e2e-flow-key';
export const ENGINE_SERVER_KEY = 'uag-e2e-engine-server-key-0123456789abcdef';
export const DEMO_FORMS = ['serviceRequest', 'application', 'sum', 'claim'];

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
 * The demo site as it runs in production, on the open-source e2e stack:
 *
 *   site (demo/server) ─▶ uag-flow (demo/flow) ─▶ UAG ─▶ uag-flow ─▶ engine server
 *                                   ▲                                    │
 *   Form.io OSS ─▶ webhook relay ───┘          research (/mcp) ◀─────────┘
 *
 * The UAG serves the demo's own template (E2E_TEMPLATE=demo); both engines run
 * on the real engine server package, hosting the scripted e2e engines; and
 * every call passes through the flow proxy, so the flow viewer can be checked.
 * Open-source webhooks send no headers and run no transform, so they go to the
 * relay, which sends each on to the flow proxy as Enterprise Form.io would.
 *
 * `siteEnv` adds environment variables for the site, such as ANTHROPIC_BASE_URL.
 */
export async function startDemoStack({ siteEnv = {}, uagEnv = {} } = {}) {
    const processes = [];
    let relay = null;
    let stack = null;
    const stop = async () => {
        for (const proc of processes.reverse()) await proc.kill();
        if (relay) await relay.close();
        if (stack) await stack.stop();
    };
    try {
        relay = await startWebhookRelay({ actions: demoTemplate().actions, target: FLOW_URL });

        const engines = spawnNode(path.join(here, 'engineServerEntry.cjs'), {
            env: {
                PORT: new URL(ENGINE_SERVER_URL).port,
                E2E_CALLS_PORT: String(ENGINE_CALLS_PORT),
                UAG_ENGINES: 'e2e-decision,e2e-agent',
                UAG_ENGINE_SERVER_KEY: ENGINE_SERVER_KEY,
                // Research goes through the flow proxy too.
                UAG_SERVER: FLOW_URL,
                ADMIN_KEY: '', PROJECT_KEY: '', JWT_SECRET: '',
            },
        });
        processes.push(engines);
        await waitFor(() => fetch(`${ENGINE_SERVER_URL}/health`, { headers: { Authorization: `Bearer ${ENGINE_SERVER_KEY}` } }).then((r) => r.ok), 'the engine server');

        const flow = spawnNode(path.join(repoRoot, 'demo/flow/proxy.mjs'), {
            env: { PORT: new URL(FLOW_URL).port, UAG_URL, ENGINES_URL: ENGINE_SERVER_URL, FLOW_KEY },
        });
        processes.push(flow);
        await waitForHttp(`${FLOW_URL}/flow/health`);

        stack = await startStack({
            forms: DEMO_FORMS,
            uagEnv: {
                E2E_TEMPLATE: 'demo',
                E2E_WEBHOOK_RELAY: relay.url,
                UAG_ENGINES: 'decide:remote,agent:remote',
                UAG_ENGINE_DECIDE_URL: FLOW_URL,
                UAG_ENGINE_DECIDE_KEY: ENGINE_SERVER_KEY,
                UAG_ENGINE_DECIDE_ENGINE: 'e2e-decision',
                UAG_ENGINE_AGENT_URL: FLOW_URL,
                UAG_ENGINE_AGENT_KEY: ENGINE_SERVER_KEY,
                UAG_ENGINE_AGENT_ENGINE: 'e2e-agent',
                ...uagEnv,
            },
        });

        const site = spawnNode(path.join(repoRoot, 'demo/server/index.mjs'), {
            cwd: path.join(repoRoot, 'demo'),
            env: {
                PORT: new URL(SITE_URL).port,
                DEMO_PUBLIC_URL: SITE_URL,
                DEMO_SECRET: 'uag-e2e-demo-secret',
                FORMIO_PROJECT_URL: FORMIO_URL,
                ADMIN_KEY,
                PROJECT_KEY: '',
                UAG_URL: FLOW_URL,
                FLOW_URL,
                FLOW_KEY,
                CLAUDE_API_KEY: 'scripted',
                // The spend guard is tested on its own; the suites run without a cap.
                DEMO_DAILY_BUDGET: '0',
                DEMO_DAILY_NETWORK_BUDGET: '0',
                // Every visitor in the suites comes from this machine.
                DEMO_SESSIONS_PER_NETWORK: '10000',
                DEMO_STREAMS_PER_NETWORK: '1000',
                DEMO_LIMITS: JSON.stringify({ chat: {}, extract: {}, submit: {} }),
                DEMO_RETENTION_HOURS: '0',
                TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '',
                ...siteEnv,
            },
        });
        processes.push(site);
        await waitFor(() => fetch(`${SITE_URL}/health`).then((r) => r.ok), `the demo site\n${site.getOutput()}`);

        return {
            stop,
            relay,
            uag: stack.uag,
            site,
            flow,
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
 * A visitor of the demo site: a cookie jar over fetch, so a suite can act as
 * one visitor (or two), as a browser would.
 */
export function visitor() {
    let cookie = '';
    async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
        const response = await fetch(`${SITE_URL}${pathname}`, {
            method,
            headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = response.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        return response;
    }
    return {
        request,
        async json(pathname, options) {
            const response = await request(pathname, options);
            return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
        },
        /** This visitor's flow events, read from the stream for `ms`. */
        async flowEvents(ms = 1500) {
            const abort = new AbortController();
            const events = [];
            const timer = setTimeout(() => abort.abort(), ms);
            try {
                const response = await request('/api/flow/stream', { headers: { Accept: 'text/event-stream' } }).catch(() => null);
                if (!response) return events;
                const decoder = new TextDecoder();
                let pending = '';
                const reader = response.body.getReader();
                abort.signal.addEventListener('abort', () => reader.cancel().catch(() => {}));
                for (;;) {
                    const { done, value } = await reader.read().catch(() => ({ done: true }));
                    if (done) break;
                    pending += decoder.decode(value, { stream: true });
                    let index;
                    while ((index = pending.indexOf('\n\n')) >= 0) {
                        const frame = pending.slice(0, index);
                        pending = pending.slice(index + 2);
                        if (/^event:/m.test(frame)) continue;
                        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
                        if (data) events.push(JSON.parse(data));
                    }
                }
            }
            finally {
                clearTimeout(timer);
            }
            return events;
        },
    };
}
