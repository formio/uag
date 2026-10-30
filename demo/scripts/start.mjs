#!/usr/bin/env node
/**
 * `yarn demo:start`: the demo site on its own, reading demo/.env.local (as before).
 *
 * `yarn demo:start <port>`: the whole demo on this machine, self-hosted on
 * Form.io Enterprise, from the root .env. Starting at <port> on 127.0.0.1:
 *
 *   <port>      the demo site, with all three examples
 *   <port> + 1  Form.io Enterprise and its portal
 *   <port> + 2  the UAG, built from this checkout
 *
 * It builds the images, starts Form.io (MongoDB, the API server and portal),
 * imports the demo's roles, forms and actions into a new project (the setup
 * job), starts the UAG on that project with its own database, the engine server
 * (JEV and Claude), the flow proxy and the site, and connects a portal stage,
 * "UAG Gateway", to the UAG, so "Agent: Run task" opens in the portal. Each
 * start is fresh: keys and passwords are random, and Ctrl+C removes the stack
 * and its data.
 *
 * Needs Docker, and in the root .env: LICENSE_KEY (a Form.io Enterprise
 * license; the UAG uses it too, unless UAG_LICENSE gives one of its own, and
 * the UAG's must include the UAG and allow the endpoint formio.e2e.test),
 * CLAUDE_API_KEY and TYPESAFE_API_KEY. The deployment's own settings
 * (ADMIN_EMAIL, ADMIN_PASS, PROJECT_KEY, the secrets) are taken from the root
 * .env when set there, by their names in demo/.env.example, and are otherwise
 * random for the start; the portal sign-in is printed either way. Connecting the
 * stage drives the portal in Chromium (`npx playwright install chromium`); if
 * that fails, the demo still runs, without the connected stage.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const arg = process.argv[2];

if (arg === undefined) {
    // The site alone, exactly as `node demo/server/index.mjs`.
    const site = spawn(process.execPath, [path.join(root, 'demo/server/index.mjs')], { stdio: 'inherit' });
    site.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => site.kill(signal));
}
else {
    await startStack(arg);
}

function fail(message) {
    console.error(`\n[demo:start] ${message}\n`);
    process.exit(1);
}

async function startStack(value) {
    const seed = Number(value);
    if (!Number.isInteger(seed) || seed < 1024 || seed > 65533) fail(`Give a port from 1024 to 65533 to start at, e.g. yarn demo:start 3430 (got "${value}").`);
    // Read, not loaded into this process: Docker Compose prefers the process's
    // variables over the settings the stack is given, so a value from .env
    // would otherwise reach Form.io while a different one is printed.
    const dotenv = path.join(root, '.env');
    const settings = { ...(fs.existsSync(dotenv) ? parseEnv(fs.readFileSync(dotenv, 'utf8')) : {}), ...process.env };
    const { connectUagStage, enterpriseMissing, startEnterpriseDemo } = await import('../recordings/enterprise.mjs');
    const missing = enterpriseMissing(settings);
    if (missing.length) fail(`Set ${missing.join(', ')} in the root .env (see .env.example).`);

    const url = (port) => `http://127.0.0.1:${port}`;
    const ports = { site: url(seed), portal: url(seed + 1), uag: url(seed + 2) };
    console.log(`[demo:start] Starting the demo on ${ports.site} (Form.io on ${ports.portal}, the UAG on ${ports.uag}). The first start builds the images and takes several minutes.`);

    let env;
    try {
        env = await startEnterpriseDemo({ ...ports, project: `uag-demo-${seed}`, connectStage: false, settings });
    }
    catch (error) {
        fail(`The demo did not start: ${error.message}`);
    }
    // A UAG license that does not allow formio.e2e.test leaves the workflow and formflow demos off.
    let formflow = null;
    try {
        const response = await fetch(`${env.uag}/agent/capabilities`, { headers: { 'x-token': env.projectKey } });
        formflow = response.ok ? (await response.json()).formflow : null;
    }
    catch {
        formflow = null;
    }
    let stage = '';
    try {
        stage = await connectUagStage(env);
    }
    catch (error) {
        console.warn(`[demo:start] The portal stage was not connected to the UAG (${error.message.split('\n')[0]}). The demo runs; "Agent: Run task" will not open in the portal.`);
    }

    console.log([
        '',
        'The UAG demo is running:',
        '',
        `  Demo site            ${env.site}`,
        `    Conversation forms ${env.site}/examples/conversation`,
        `    Agentic Workflow   ${env.site}/examples/workflow`,
        `    Agentic Formflow   ${env.site}/examples/formflow`,
        `  Form.io portal       ${env.portal}`,
        `    Sign in as         ${env.email}`,
        `    Password           ${env.password}${env.generated.includes('ADMIN_PASS') ? '   (generated; set ADMIN_PASS in .env to choose it)' : '   (ADMIN_PASS, from .env)'}`,
        stage ? '    Stage "UAG Gateway" of the "UAG Demo" project is connected to the UAG.' : '',
        `  UAG                  ${env.uag}`,
        '',
        env.generated.filter((name) => name !== 'ADMIN_PASS').length
            ? `Generated for this start: ${env.generated.filter((name) => name !== 'ADMIN_PASS').join(', ')}. Set any of them in .env to keep it.`
            : '',
        formflow && !formflow.allowed
            ? `Agentic Formflow is off in the UAG (${formflow.reason}), so the workflow and formflow demos will not run. Its license (UAG_LICENSE, else LICENSE_KEY) must include the UAG and allow the endpoint formio.e2e.test.`
            : '',
        '',
        'Ctrl+C stops it and removes its data.',
        '',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n'));

    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        console.log('\n[demo:start] Stopping the demo and removing its data...');
        await env.stop();
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    // Keep running until stopped.
    setInterval(() => {}, 1 << 30);
}
