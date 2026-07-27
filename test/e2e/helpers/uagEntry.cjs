/**
 * Entry point that boots the UAG server with the e2e test module
 * (test/e2e/module) instead of the default runtime module. Spawned as a
 * child process by the e2e test suite with the environment fully specified.
 */
const Express = require('express');
const { UAGServer } = require('../../../lib');
const UAGModule = require('../module');
(async function () {
    try {
        const server = new UAGServer();
        server.use(UAGModule);
        const app = Express();
        app.use(await server.router());
        const port = process.env.PORT || 3210;
        app.listen(port, () => {
            console.log(`UAG e2e server running on port ${port}`);
        });
    }
    catch (error) {
        console.error('Failed to start UAG e2e server:', error);
        process.exit(1);
    }
})();
