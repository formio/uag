#!/usr/bin/env node
/**
 * uag: start the Form.io UAG.
 *
 *   uag                       the UAG with no module
 *   UAG_MODULE=./my-module uag
 *
 * Configuration comes from the environment (PROJECT, PROJECT_KEY or ADMIN_KEY,
 * JWT_SECRET, UAG_ENGINES, MONGO, ...) and an optional module: a file or
 * folder exporting `{ config, actions, ... }`, named by UAG_MODULE.
 *
 * Engines are found among the installed packages, so a custom image holds only
 * the engines it installs:
 *
 *   npm install @formio/uag @formio/uag-claude
 *   UAG_ENGINES=claude CLAUDE_API_KEY=... npx uag
 */
// Before anything else, so a module that reads the environment sees .env too.
require('dotenv/config');
const path = require('path');

/** isolated-vm, which runs form logic, needs Node's startup snapshot off. */
function snapshotDisabled() {
    return process.execArgv.includes('--no-node-snapshot') || /(^|\s)--no-node-snapshot(\s|$)/.test(process.env.NODE_OPTIONS || '');
}

/** Run this file again with the flag, passing signals on, and exit as it does. */
function restartWithoutSnapshot() {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['--no-node-snapshot', ...process.execArgv, __filename, ...process.argv.slice(2)], { stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(signal, () => child.kill(signal));
    }
    child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

/** Start the UAG with a module, listening on PORT (default 3200). */
async function start(uagModule) {
    const Express = require('express');
    const { UAGServer, trustProxySetting } = require('../lib');
    const server = new UAGServer();
    if (uagModule) server.use(uagModule);
    const app = Express();
    // Behind a reverse proxy, its forwarded headers give the public URL (TRUST_PROXY).
    const trust = trustProxySetting(process.env.TRUST_PROXY);
    if (trust !== undefined) app.set('trust proxy', trust);
    // Loads the engines the module's `engines` setting, or else UAG_ENGINES,
    // names; a misconfigured engine stops startup with its name in the error.
    app.use(await server.router());
    const port = process.env.PORT || 3200;
    await new Promise((resolve) => app.listen(port, resolve));
    console.log(`Form.io UAG server running on port ${port}`);
    console.log(`Visit http://localhost:${port} to access the application`);
}

function fail(error) {
    console.error('Failed to start server:', error);
    process.exit(1);
}

if (require.main === module) {
    if (!snapshotDisabled()) {
        restartWithoutSnapshot();
    }
    else {
        Promise.resolve()
            .then(() => (process.env.UAG_MODULE ? require(path.resolve(process.env.UAG_MODULE)) : undefined))
            .then(start)
            .catch(fail);
    }
}

module.exports = { start, fail };
