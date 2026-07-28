#!/usr/bin/env node
/**
 * Creates the Form.io project this example runs against.
 *
 * The UAG authenticates to the project with a project API key, so that key has
 * to exist before the UAG starts. This script logs into the Enterprise server,
 * imports module/project.json as a new project, creates an API key for it, and
 * writes that key into .env for Docker Compose to pick up.
 *
 * Run it after the server is up but before starting the UAG:
 *
 *   docker compose up -d mongo formio-server
 *   ./setup.mjs
 *   docker compose up -d
 *
 * No dependencies — plain Node.js.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env');

const SERVER = process.env.SERVER || 'http://localhost:3000';
const PROJECT_NAME = process.env.PROJECT_NAME || 'agentic-workflow';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASS = process.env.ADMIN_PASS || 'CHANGEME';

/** Prints a message and exits with a failing status. */
function fail(message) {
    console.error(message);
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the server answers, or gives up after ~3 minutes. */
async function waitForServer() {
    console.log(`Waiting for the Form.io server at ${SERVER} ...`);
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const response = await fetch(SERVER);
            if (response.ok) {
                return;
            }
        }
        catch {
            // Not listening yet.
        }
        await sleep(3000);
    }
    fail('Server did not come up. Check: docker compose logs formio-server');
}

/**
 * Logs in as the portal administrator. The portal's own user resource lives in
 * the primary "formio" project, so this is /formio/user/login rather than
 * /user/login.
 */
async function login() {
    console.log(`Logging in as ${ADMIN_EMAIL} ...`);
    const response = await fetch(`${SERVER}/formio/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { email: ADMIN_EMAIL, password: ADMIN_PASS } }),
    });
    const token = response.headers.get('x-jwt-token');
    if (!response.ok || !token) {
        fail(
            `Login failed (${response.status}). ` +
            'Confirm ADMIN_EMAIL and ADMIN_PASS match the server\'s environment.'
        );
    }
    return token;
}

/** Returns the id of an existing project with this name, or null. */
async function findProject(jwt) {
    const response = await fetch(`${SERVER}/project`, { headers: { 'x-jwt-token': jwt } });
    if (!response.ok) {
        fail(`Could not list projects (${response.status}).`);
    }
    const projects = await response.json();
    return projects.find((project) => project.name === PROJECT_NAME)?._id || null;
}

/** Imports module/project.json as a new project, with the API key filled in. */
async function createProject(jwt, projectKey) {
    console.log(`Creating project '${PROJECT_NAME}' from module/project.json ...`);
    const raw = readFileSync(join(here, 'module', 'project.json'), 'utf8');
    // The webhook actions ship with a placeholder so no key lives in the repo.
    const template = JSON.parse(raw.replaceAll('REPLACE_WITH_PROJECT_KEY', projectKey));

    const response = await fetch(`${SERVER}/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-jwt-token': jwt },
        body: JSON.stringify({
            title: 'UAG Agentic Workflow Example',
            name: PROJECT_NAME,
            template,
        }),
    });
    if (!response.ok) {
        fail(`Creating the project failed (${response.status}): ${await response.text()}`);
    }
    return (await response.json())._id;
}

/** Adds the API key to the project's settings. */
async function addApiKey(jwt, projectId, projectKey) {
    console.log(`Created project ${projectId}. Adding the API key ...`);
    const response = await fetch(`${SERVER}/project/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-jwt-token': jwt },
        body: JSON.stringify({ settings: { keys: [{ name: 'uag', key: projectKey }] } }),
    });
    if (!response.ok) {
        fail(`Adding the API key failed (${response.status}): ${await response.text()}`);
    }
}

/** Writes PROJECT_KEY into .env, replacing any previous value. */
function writeEnv(projectKey) {
    const contents = readFileSync(envPath, 'utf8');
    const line = `PROJECT_KEY=${projectKey}`;
    const updated = /^PROJECT_KEY=.*$/m.test(contents)
        ? contents.replace(/^PROJECT_KEY=.*$/m, line)
        : `${contents.replace(/\n*$/, '')}\n${line}\n`;
    writeFileSync(envPath, updated);
}

if (!existsSync(envPath)) {
    fail('No .env found. Copy .env.example to .env and fill in your keys first.');
}

await waitForServer();
const jwt = await login();

// Refuse to clobber an existing project of the same name.
const existing = await findProject(jwt);
if (existing) {
    console.error(`A project named '${PROJECT_NAME}' already exists (${existing}).`);
    fail('Delete it in the portal, or set PROJECT_NAME to something else and re-run.');
}

const projectKey = randomBytes(24).toString('hex');
const projectId = await createProject(jwt, projectKey);
await addApiKey(jwt, projectId, projectKey);
writeEnv(projectKey);

console.log(`
Done. PROJECT_KEY written to .env.
Forms created: application, sum — both tagged 'uag'.

Start the rest of the stack:
  docker compose up -d

Then try it:
  ./submit-application.mjs
`);
