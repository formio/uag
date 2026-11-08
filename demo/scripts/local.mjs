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
 *   1. imports the demo's roles, forms and actions (module/project.json) into
 *      the project, as the deployed stack's setup job does
 *      (DEMO_TEMPLATE_SYNC=off skips it),
 *   2. starts the UAG from this checkout's lib/, on the project, with the JEV
 *      and Claude engines in-process, allowing the site's origin (CORS),
 *   3. builds the static site for that UAG and project and serves it, rebuilding
 *      on every change to the site's sources.
 *
 * The site's pages register each visitor as a guest of the project and call the
 * UAG from the browser, as they do in production. A hosted project needs no
 * license. The Agentic Workflow demo's agents run in this UAG, on the
 * applications the pages save through it, so nothing has to reach this machine
 * from the internet. Ctrl+C stops everything.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROJECT_URL, formflowSupported } from '../lib/config.mjs';
import { serveSite, watchSite } from './serve.mjs';

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

const ports = { uag: env.UAG_PORT || '3200', site: env.DEMO_PORT || '8080' };
for (const [name, setting] of [['site', 'DEMO_PORT'], ['uag', 'UAG_PORT']]) {
    if (!await portFree(ports[name])) {
        fail(`Port ${ports[name]} is in use (another demo, or something else). Stop it, or set ${setting} in demo/.env.local to another port.`);
    }
}
const uagUrl = `http://localhost:${ports.uag}`;
const siteUrl = (env.DEMO_PUBLIC_URL || `http://localhost:${ports.site}`).replace(/\/+$/, '');
// The site's origin, by either name a browser may use for it.
const siteOrigins = [new URL(siteUrl).origin, new URL(siteUrl).origin.replace('localhost', '127.0.0.1')].join(',');

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
const cleanups = [];
function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    for (const cleanup of cleanups) cleanup();
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
    await run('setup', path.join(demo, 'scripts/setup.mjs'), { FORMIO_PROJECT_URL: projectUrl, FORMIO_SERVER: '' }, { wait: true })
        .catch((err) => fail(err.message));
}

run('uag', path.join(root, 'index.js'), {
    PORT: ports.uag,
    PROJECT: projectUrl,
    JWT_SECRET: env.UAG_JWT_SECRET || randomBytes(32).toString('hex'),
    UAG_ENGINES: env.UAG_ENGINES || 'jev,claude',
    // The project key is the only Form.io credential; never the repository's ADMIN_KEY.
    ADMIN_KEY: '',
    // Browsers may call it from the site only.
    CORS: siteOrigins,
});
const capabilities = await waitFor(async () => {
    const response = await fetch(`${uagUrl}/agent/capabilities`, { headers: { 'x-token': env.PROJECT_KEY }, signal: AbortSignal.timeout(5000) });
    return response.ok && response.json();
}, 'The UAG');

// The site, built for this UAG and project, and rebuilt on every change.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-local-'));
cleanups.push(() => fs.rmSync(out, { recursive: true, force: true }));
const siteEnv = {
    DEMO_PUBLIC_URL: siteUrl,
    DEMO_OUT: out,
    FORMIO_PROJECT_URL: projectUrl,
    DEMO_UAG_URL: uagUrl,
    ...(env.FORMIO_PROJECT_NAME && { DEMO_UAG_PROJECT_PATH: `/${env.FORMIO_PROJECT_NAME}` }),
};
try {
    await serveSite({ port: ports.site, env: siteEnv });
}
catch (error) {
    fail(`The site did not build: ${error.message}`);
}
cleanups.push(watchSite(siteEnv));

const reason = capabilities?.formflow?.reason;
const formflow = formflowSupported(capabilities);
console.log(`
[demo:local] The demo is running at ${siteUrl}
[demo:local] Project:  ${projectUrl}
[demo:local] UAG:      ${uagUrl} (${capabilities?.edition || 'unknown'} edition; Agentic Formflow ${formflow ? `enabled, ${reason}` : `not enabled (${reason || 'unknown'}): the examples will say a license is needed`})
[demo:local] The site is rebuilt when its pages, docs or scripts change; reload to see it.
[demo:local] Press Ctrl+C to stop.
`);
