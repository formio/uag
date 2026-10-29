/**
 * Runs the real engine server package (packages/engine-server) for the e2e
 * suites, hosting the scripted e2e engine types, as `formio/uag-engines` would
 * host installed ones. Spawned as a child process with its environment fully
 * specified, and no Form.io credentials.
 *
 * Its routes all need the engine server key, so what the scripted engines were
 * sent is served on a separate port, E2E_CALLS_PORT: GET lists it, DELETE
 * clears it.
 */
const http = require('http');
const { createEngineServer } = require('../../../packages/engine-server');
const { engineTypes, calls } = require('../module/engines');

(async function () {
    try {
        const { app, engines } = await createEngineServer({ types: engineTypes });
        await new Promise((resolve) => app.listen(Number(process.env.PORT), '127.0.0.1', resolve));
        http.createServer((req, res) => {
            if (req.method === 'DELETE') calls.length = 0;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(calls));
        }).listen(Number(process.env.E2E_CALLS_PORT), '127.0.0.1');
        console.log(`engine server serving ${engines.map(({ engine }) => engine.name).join(', ')}`);
    }
    catch (error) {
        console.error('Failed to start the engine server:', error);
        process.exit(1);
    }
})();
