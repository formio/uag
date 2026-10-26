#!/usr/bin/env node
/**
 * uag-engines: host engine packages for the Form.io UAG behind the remote
 * engine protocol.
 *
 *   UAG_ENGINES=claude CLAUDE_API_KEY=... UAG_ENGINE_SERVER_KEY=... \
 *   UAG_SERVER=http://formio-uag:3200 uag-engines
 *
 * PORT (default 3300) and HOST (default 0.0.0.0) choose where it listens.
 */
const { createEngineServer } = require('..');
const { publicAddresses } = require('../network');

async function main() {
    const { app, engines, uagServer } = await createEngineServer();
    const port = Number(process.env.PORT || 3300);
    const host = process.env.HOST || '0.0.0.0';
    await new Promise((resolve, reject) => {
        const server = app.listen(port, host, resolve);
        server.on('error', reject);
    });
    console.log(`[uag-engines] Serving ${engines.map(({ engine }) => `${engine.name} (${engine.kind}, ${engine.model})`).join(', ')} on ${host}:${port}.`);
    if (!uagServer) {
        console.log('[uag-engines] UAG_SERVER is not set: research extracts are refused.');
    }
    const exposed = publicAddresses(host);
    if (exposed.length) {
        console.warn(`[uag-engines] Warning: listening on public address(es) ${exposed.join(', ')}. Keep the engine server on a private network that only the UAG can reach.`);
    }
}

main().catch((err) => {
    console.error(`[uag-engines] Failed to start: ${err && err.message ? err.message : err}`);
    process.exit(1);
});
