/**
 * The webhook relay. The demo's workflow runs on its project's webhook actions,
 * which call the UAG's /agent/provide. A project on Form.io's hosted service
 * calls them from the internet, and the UAG is private, so the site, the one
 * public service, passes them on:
 *
 *   POST /webhooks/uag/agent/provide  ->  the flow proxy's /agent/provide
 *
 * through the flow proxy, so the viewer still shows every run. Only a request
 * carrying the project key is passed on, with nothing of the caller's but its
 * body (no request id, so it cannot name a visitor's session); the UAG checks
 * the key again. Self-hosted Form.io calls the flow proxy directly, on the
 * private network, and never comes here.
 */
import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_PATH } from './config.mjs';

function sameKey(given, expected) {
    const digest = (value) => createHash('sha256').update(String(value)).digest();
    return timingSafeEqual(digest(given), digest(expected));
}

export function webhookRoutes(app, { config }, fetch = globalThis.fetch) {
    const key = config.formio.keyHeader['x-token'];
    // Open Source projects have no project key, and their webhooks stay on the private network.
    if (!key) return;
    app.post(`${WEBHOOK_PATH}/agent/provide`,
        (req, res, next) => {
            // Checked before the body is read.
            const given = req.get('x-token') || '';
            if (!given || !sameKey(given, key)) return res.status(401).json({ error: 'Unauthorized.' });
            next();
        },
        express.json({ limit: '16kb' }),
        async (req, res) => {
            try {
                const response = await fetch(`${config.uag.url}/agent/provide`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-token': key },
                    body: JSON.stringify(req.body ?? {}),
                    // A provide runs the engines; Form.io does not wait for it (block: false).
                    signal: AbortSignal.timeout(300_000),
                });
                res.status(response.status).type(response.headers.get('content-type') || 'application/json');
                res.send(Buffer.from(await response.arrayBuffer()));
            }
            catch {
                res.status(502).json({ error: 'The UAG could not be reached.' });
            }
        });
}
