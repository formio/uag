require('dotenv/config');
const Express = require('express');
const { UAGServer } = require('./lib');
const UAGModule = require('./module');

async function start() {
    const server = new UAGServer();
    server.use(UAGModule);
    const app = Express();
    app.use(await server.router());
    const port = process.env.PORT || 3200;
    app.listen(port, () => {
        console.log(`Form.io UAG server running on port ${port}`);
        console.log(`Visit http://localhost:${port} to access the application`);
    });
}

start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
