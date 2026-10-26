#!/usr/bin/env node
/**
 * Provisions the demo's project. Run once per deploy, before the UAG starts
 * (the `setup` service in docker-compose.yml does this). Two ways:
 *
 * A project on Form.io's hosted service (the default, `https://uag.form.io`),
 * or any project that already exists: FORMIO_PROJECT_URL and PROJECT_KEY, an
 * API key made in the project's settings.
 *   - Imports module/project.json into it (unless DEMO_TEMPLATE_SYNC=off),
 *     which creates the demo's forms, or updates them in place and replaces
 *     their actions, so a deploy always runs the forms in this repo.
 *
 * A self-hosted Form.io Enterprise server (docker-compose.enterprise.yml):
 * FORMIO_SERVER, and the portal administrator's ADMIN_EMAIL and ADMIN_PASS.
 *   - Creates the project from module/project.json when it does not exist, and
 *     otherwise imports it again, as above.
 *   - Makes sure PROJECT_KEY is one of its API keys, so the UAG, the demo site
 *     and the webhooks can all use it.
 *
 * The template's webhooks carry two placeholders, filled in here so no key
 * is committed: REPLACE_WITH_PROJECT_KEY and REPLACE_WITH_UAG_URL (the address
 * Form.io calls the UAG at, through the flow proxy so the viewer sees the
 * webhooks: on a self-hosted server, the flow proxy itself; from the hosted
 * service, the site's webhook relay, WEBHOOK_PATH under its public URL).
 *
 * No dependencies. Idempotent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROJECT_URL, WEBHOOK_PATH, publicUrlOf } from './config.mjs';

const env = process.env;
const SERVER = (env.FORMIO_SERVER || '').replace(/\/+$/, '');
const PROJECT_URL = (env.FORMIO_PROJECT_URL || DEFAULT_PROJECT_URL).replace(/\/+$/, '');
const PROJECT_NAME = env.FORMIO_PROJECT_NAME || 'demo';
const PROJECT_TITLE = env.FORMIO_PROJECT_TITLE || 'UAG Demo';
const ADMIN_EMAIL = env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASS = env.ADMIN_PASS || '';
const PROJECT_KEY = env.PROJECT_KEY || '';
const WEBHOOK_UAG_URL = webhookUagUrl(env);
const SYNC = env.DEMO_TEMPLATE_SYNC || 'import';

function fail(message) {
    console.error(`[demo-setup] ${message}`);
    process.exit(1);
}

function log(message) {
    console.log(`[demo-setup] ${message}`);
}

/**
 * Where the project's webhooks call the UAG: WEBHOOK_UAG_URL when set, or else
 * the site's webhook relay, at its public URL.
 */
export function webhookUagUrl(env) {
    if (env.WEBHOOK_UAG_URL) return env.WEBHOOK_UAG_URL.replace(/\/+$/, '');
    return `${publicUrlOf(env)}${WEBHOOK_PATH}`;
}

/** The demo template, with the placeholders filled in. */
export function demoTemplate({ projectKey, uagUrl }) {
    const raw = readFileSync(fileURLToPath(new URL('../module/project.json', import.meta.url)), 'utf8');
    return JSON.parse(raw.replaceAll('REPLACE_WITH_PROJECT_KEY', projectKey).replaceAll('REPLACE_WITH_UAG_URL', uagUrl));
}

async function request(path, { method = 'GET', jwt, key, body, base = SERVER } = {}) {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: {
            ...(body && { 'Content-Type': 'application/json' }),
            ...(jwt && { 'x-jwt-token': jwt }),
            ...(key && { 'x-token': key }),
        },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch {
        json = text;
    }
    return { response, json };
}

async function waitForServer() {
    log(`Waiting for Form.io at ${SERVER} ...`);
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            if ((await fetch(SERVER, { signal: AbortSignal.timeout(5000) })).ok) return;
        }
        catch {
            // Not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    fail('Form.io did not come up.');
}

async function login() {
    // The portal's user resource lives in the primary "formio" project.
    const { response } = await request('/formio/user/login', { method: 'POST', body: { data: { email: ADMIN_EMAIL, password: ADMIN_PASS } } });
    const token = response.headers.get('x-jwt-token');
    if (!response.ok || !token) fail(`Logging in as ${ADMIN_EMAIL} failed (${response.status}). Check ADMIN_EMAIL and ADMIN_PASS.`);
    return token;
}

/** A project that already exists, such as one on Form.io's hosted service: update its forms. */
async function existingProject() {
    if (!PROJECT_KEY) fail(`Set PROJECT_KEY to an API key of ${PROJECT_URL} (the project's Settings, API Keys).`);
    const { response, json: project } = await request('', { base: PROJECT_URL, key: PROJECT_KEY });
    if (!response.ok || !project?._id) {
        fail(`Reading ${PROJECT_URL} with PROJECT_KEY failed (${response.status}). Check FORMIO_PROJECT_URL, and that PROJECT_KEY is one of its API keys.`);
    }
    if (SYNC !== 'off') {
        log(`Updating the forms of ${PROJECT_URL} from module/project.json; its webhooks call ${WEBHOOK_UAG_URL} ...`);
        const template = demoTemplate({ projectKey: PROJECT_KEY, uagUrl: WEBHOOK_UAG_URL });
        const imported = await request('/import', { base: PROJECT_URL, method: 'POST', key: PROJECT_KEY, body: { template } });
        if (!imported.response.ok) fail(`Importing the template failed (${imported.response.status}): ${JSON.stringify(imported.json)}`);
    }
    log(`Project '${project.name}' (${project._id}) is ready.`);
}

async function main() {
    if (!SERVER) return existingProject();
    if (!PROJECT_KEY || PROJECT_KEY.length < 24) fail('Set PROJECT_KEY to a random string of at least 24 characters (openssl rand -hex 24).');
    if (!ADMIN_PASS) fail('Set ADMIN_PASS, the Form.io portal administrator password.');
    await waitForServer();
    const jwt = await login();
    const template = demoTemplate({ projectKey: PROJECT_KEY, uagUrl: WEBHOOK_UAG_URL });

    const { json: projects } = await request('/project', { jwt });
    let project = Array.isArray(projects) ? projects.find((candidate) => candidate.name === PROJECT_NAME) : null;
    if (!project) {
        log(`Creating project '${PROJECT_NAME}' from module/project.json ...`);
        const created = await request('/project', { method: 'POST', jwt, body: { title: PROJECT_TITLE, name: PROJECT_NAME, template } });
        if (!created.response.ok) fail(`Creating the project failed (${created.response.status}): ${JSON.stringify(created.json)}`);
        project = created.json;
    }
    else if (SYNC !== 'off') {
        log(`Updating the forms of '${PROJECT_NAME}' from module/project.json ...`);
        const imported = await request(`/project/${project._id}/import`, { method: 'POST', jwt, body: { template } });
        if (!imported.response.ok) fail(`Importing the template failed (${imported.response.status}): ${JSON.stringify(imported.json)}`);
    }

    const { json: current } = await request(`/project/${project._id}`, { jwt });
    const keys = current?.settings?.keys || [];
    if (!keys.some((entry) => entry.key === PROJECT_KEY)) {
        log('Adding PROJECT_KEY to the project\'s API keys ...');
        const updated = await request(`/project/${project._id}`, {
            method: 'PUT', jwt,
            body: { settings: { ...(current?.settings || {}), keys: [...keys, { name: 'uag-demo', key: PROJECT_KEY }] } },
        });
        if (!updated.response.ok) fail(`Adding the API key failed (${updated.response.status}): ${JSON.stringify(updated.json)}`);
    }
    log(`Project '${PROJECT_NAME}' (${project._id}) is ready.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => fail(err.stack || err.message));
}
