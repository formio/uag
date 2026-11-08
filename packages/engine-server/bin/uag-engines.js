#!/usr/bin/env node
/**
 * uag-engines: host engine packages for the Form.io UAG behind the remote
 * engine protocol.
 *
 *   UAG_ENGINES=claude CLAUDE_API_KEY=... UAG_ENGINE_SERVER_KEY=... \
 *   UAG_SERVER=http://formio-uag:3200 uag-engines
 *
 * PORT (default 3300) and HOST (default 127.0.0.1; the Docker image sets
 * 0.0.0.0) choose where it listens. SIGTERM and SIGINT stop it once the
 * requests in flight finish, or after SHUTDOWN_TIMEOUT milliseconds (10000).
 */
const { createEngineServer } = require('..');
const { publicAddresses } = require('../network');

async function main() {
    const { app, engines, uagServer } = await createEngineServer();
    const port = Number(process.env.PORT || 3300);
    const host = process.env.HOST || '127.0.0.1';
    const server = await new Promise((resolve, reject) => {
        const listening = app.listen(port, host, () => resolve(listening));
        listening.on('error', reject);
    });
    stopOnSignals(server);
    console.log(`[uag-engines] Serving ${engines.map(({ engine }) => `${engine.name} (${engine.kind}, ${engine.model})`).join(', ')} on ${host}:${port}.`);
    if (!uagServer) {
        console.log('[uag-engines] UAG_SERVER is not set: research extracts are refused.');
    }
    const exposed = publicAddresses(host);
    if (exposed.length) {
        console.warn(`[uag-engines] Warning: listening on public address(es) ${exposed.join(', ')}. Keep the engine server on a private network that only the UAG can reach.`);
    }
}

/** Stop accepting requests on SIGTERM or SIGINT, and exit when those in flight finish. */
function stopOnSignals(server) {
    let stopping = false;
    const stop = (signal) => {
        if (stopping) process.exit(1);
        stopping = true;
        console.log(`[uag-engines] ${signal}: finishing the requests in flight.`);
        server.close(() => process.exit(0));
        server.closeIdleConnections();
        setTimeout(() => {
            console.error('[uag-engines] Requests still in flight at the shutdown timeout; exiting.');
            process.exit(1);
        }, Number(process.env.SHUTDOWN_TIMEOUT || 10000)).unref();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
}

main().catch((err) => {
    console.error(`[uag-engines] Failed to start: ${err && err.message ? err.message : err}`);
    process.exit(1);
});
