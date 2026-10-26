import http from 'http';
import vm from 'vm';
import { UAG_URL, ADMIN_KEY } from './stack.mjs';

/**
 * Receives the e2e stack's open-source Form.io webhooks and sends each one on
 * as Enterprise Form.io would. Open-source webhooks send no custom headers and
 * run no `transform`, so for each call the relay:
 *   1. looks up the action by the key in its path (`/<action key>`);
 *   2. runs the action's own `transform` on the payload, in a `vm` context;
 *   3. posts the result to `/agent/provide` on `target`, with the admin key in
 *      place of the project key (the e2e stack is open source);
 *   4. records the call and the UAG's response.
 *
 * `actions` is the project template's `actions` map. `target` is where the
 * calls go: the UAG, or a proxy in front of it such as the demo's flow proxy.
 */
export async function startWebhookRelay({ actions, port = 3399, target = UAG_URL }) {
    const calls = [];
    const pending = new Set();
    let lastActivity = Date.now();

    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            // Answer at once, as Form.io does not wait on a non-blocking webhook.
            res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
            const work = relay(decodeURIComponent(req.url.slice(1)), Buffer.concat(chunks).toString());
            pending.add(work);
            work.finally(() => {
                pending.delete(work);
                lastActivity = Date.now();
            });
        });
    });

    async function relay(key, raw) {
        lastActivity = Date.now();
        const call = { key, received: safeParse(raw) };
        calls.push(call);
        try {
            const action = actions[key];
            if (!action) throw new Error(`No action ${key} in the template`);
            const context = vm.createContext({ payload: call.received });
            if (action.settings?.transform) {
                vm.runInContext(action.settings.transform, context, { timeout: 1000 });
            }
            call.payload = context.payload;
            const response = await fetch(`${target}/agent/provide`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
                body: JSON.stringify(call.payload),
            });
            call.status = response.status;
            call.body = safeParse(await response.text());
        }
        catch (error) {
            call.error = error.message;
        }
    }

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        // All interfaces, so the Form.io container reaches it as host.docker.internal.
        server.listen(port, '0.0.0.0', resolve);
    });

    return {
        url: `http://host.docker.internal:${port}`,
        calls,
        /** Waits until no webhook has arrived or been relayed for `quietMs`. */
        async settle({ quietMs = 3000, timeoutMs = 60000 } = {}) {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (!pending.size && Date.now() - lastActivity >= quietMs) return;
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            throw new Error(`Webhooks still arriving after ${timeoutMs} ms: ${JSON.stringify(calls.map((c) => c.key))}`);
        },
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

function safeParse(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
