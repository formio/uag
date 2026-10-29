#!/usr/bin/env node
/**
 * Runs the demo on your machine against a project of your own on Form.io's
 * hosted service (or a stage of one), from one settings file:
 *
 *   cp demo/local.env.example demo/.env.local     # then fill it in
 *   yarn install && yarn build
 *   yarn demo:local                               # http://localhost:8080
 *
 * In order, it:
 *   1. imports the demo's forms and actions (module/project.json) into the
 *      project, as the deployed stack's setup job does (DEMO_TEMPLATE_SYNC=off
 *      skips it),
 *   2. starts the UAG from this checkout's lib/, on the project, with the JEV
 *      and Claude engines in-process,
 *   3. starts the flow proxy in front of it, for the flow viewer,
 *   4. starts the site, through the flow proxy.
 *
 * A hosted project needs no license. The Agentic Workflow demo's agents run in
 * this UAG, on the applications the site saves through it, so nothing has to
 * reach this machine from the internet. Ctrl+C stops everything.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROJECT_URL, formflowSupported } from '../server/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const demo = path.resolve(here, '..');
const root = path.resolve(demo, '..');
// DEMO_ENV_FILE names another file.
const ENV_FILE = process.env.DEMO_ENV_FILE ? path.resolve(process.env.DEMO_ENV_FILE) : path.join(demo, '.env.local');
// The deployed demo's own project. Importing into it would replace its forms with this checkout's.
const DEPLOYED_PROJECT = DEFAULT_PROJECT_URL;

function fail(message) {
    console.error(`\n[demo:local] ${message}\n`);
    process.exit(1);
}

if (!fs.existsSync(ENV_FILE)) fail('Copy demo/local.env.example to demo/.env.local and fill it in.');
process.loadEnvFile(ENV_FILE);
const env = process.env;

const projectUrl = (env.FORMIO_PROJECT_URL || '').replace(/\/+$/, '');
const missing = ['FORMIO_PROJECT_URL', 'PROJECT_KEY', 'CLAUDE_API_KEY'].filter((name) => !env[name]);
if (!env.UAG_ENGINES && !env.TYPESAFE_API_KEY) missing.push('TYPESAFE_API_KEY');
if (missing.length) fail(`Set ${missing.join(', ')} in demo/.env.local.`);
if (!fs.existsSync(path.join(root, 'lib/index.js'))) fail('Build the UAG first: yarn build');

const sync = env.DEMO_TEMPLATE_SYNC !== 'off';
if (sync && projectUrl === DEPLOYED_PROJECT) {
    fail(`${DEPLOYED_PROJECT} is the deployed demo's project: importing the demo into it from here would replace its forms with this checkout's. ` +
        'Use a project or stage of your own, or set DEMO_TEMPLATE_SYNC=off to run against it as it is.');
}

const ports = { uag: env.UAG_PORT || '3200', flow: env.FLOW_PORT || '3250', site: env.DEMO_PORT || '8080' };
for (const [name, setting] of [['site', 'DEMO_PORT'], ['uag', 'UAG_PORT'], ['flow', 'FLOW_PORT']]) {
    if (!await portFree(ports[name])) {
        fail(`Port ${ports[name]} is in use (another demo, or something else). Stop it, or set ${setting} in demo/.env.local to another port.`);
    }
}
const uagUrl = `http://localhost:${ports.uag}`;
const flowUrl = `http://localhost:${ports.flow}`;
const siteUrl = (env.DEMO_PUBLIC_URL || `http://localhost:${ports.site}`).replace(/\/+$/, '');
const flowKey = randomBytes(24).toString('hex');

const children = [];
function run(name, script, childEnv, { wait = false } = {}) {
    const child = spawn(process.execPath, ['--no-node-snapshot', script], {
        cwd: root,
        // The UAG reads a .env too; give it this one, never the repository's.
        env: { ...env, DOTENV_CONFIG_PATH: ENV_FILE, ...childEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prefix = (chunk) => chunk.toString().split('\n').filter(Boolean).map((line) => `[${name}] ${line}`).join('\n') + '\n';
    child.stdout.on('data', (chunk) => process.stdout.write(prefix(chunk)));
    child.stderr.on('data', (chunk) => process.stderr.write(prefix(chunk)));
    if (wait) {
        return new Promise((resolve, reject) => child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}`)))));
    }
    children.push(child);
    child.on('exit', (code, signal) => {
        if (!stopping) {
            console.error(`[demo:local] ${name} stopped (${signal || code}); stopping the rest.`);
            stop(1);
        }
    });
    return child;
}

let stopping = false;
function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

/** Whether nothing is listening on `port`, on any address. */
function portFree(port) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.listen(Number(port), () => probe.close(() => resolve(true)));
    });
}

async function waitFor(check, what, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const value = await check();
            if (value) return value;
        }
        catch {
            // Not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    fail(`${what} did not come up. See its log above.`);
}

if (sync) {
    console.log(`[demo:local] Importing the demo's forms into ${projectUrl} ...`);
    await run('setup', path.join(demo, 'server/setup.mjs'), { FORMIO_PROJECT_URL: projectUrl, FORMIO_SERVER: '' }, { wait: true })
        .catch((err) => fail(err.message));
}

run('uag', path.join(root, 'index.js'), {
    PORT: ports.uag,
    PROJECT: projectUrl,
    JWT_SECRET: env.UAG_JWT_SECRET || randomBytes(32).toString('hex'),
    UAG_ENGINES: env.UAG_ENGINES || 'jev,claude',
    // The project key is the only Form.io credential; never the repository's ADMIN_KEY.
    ADMIN_KEY: '',
});
const capabilities = await waitFor(async () => {
    const response = await fetch(`${uagUrl}/agent/capabilities`, { headers: { 'x-token': env.PROJECT_KEY }, signal: AbortSignal.timeout(5000) });
    return response.ok && response.json();
}, 'The UAG');

run('flow', path.join(demo, 'flow/proxy.mjs'), {
    PORT: ports.flow,
    UAG_URL: uagUrl,
    // The engines run inside the UAG here, so there is no engine server to show.
    ENGINES_URL: 'http://127.0.0.1:9',
    FLOW_KEY: flowKey,
});
await waitFor(async () => (await fetch(`${flowUrl}/flow/health`, { signal: AbortSignal.timeout(5000) })).ok, 'The flow proxy');

run('site', path.join(demo, 'server/index.mjs'), {
    PORT: ports.site,
    DEMO_PUBLIC_URL: siteUrl,
    FORMIO_PROJECT_URL: projectUrl,
    UAG_URL: flowUrl,
    FLOW_URL: flowUrl,
    FLOW_KEY: flowKey,
    NODE_ENV: '',
});
await waitFor(async () => (await fetch(`http://localhost:${ports.site}/health`, { signal: AbortSignal.timeout(5000) })).ok, 'The site');

const reason = capabilities?.formflow?.reason;
const formflow = formflowSupported(capabilities);
console.log(`
[demo:local] The demo is running at ${siteUrl}
[demo:local] Project:  ${projectUrl}
[demo:local] UAG:      ${uagUrl} (${capabilities?.edition || 'unknown'} edition; Agentic Formflow ${formflow ? `enabled, ${reason}` : `not enabled (${reason || 'unknown'}): the examples will say a license is needed`})
[demo:local] Press Ctrl+C to stop.
`);
