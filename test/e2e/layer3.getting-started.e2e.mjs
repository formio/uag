import { expect } from 'chai';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { IMAGE, buildLocalImage, repoRoot, waitUntil } from './helpers/exampleStack.mjs';

const exec = promisify(execFile);

/**
 * Layer 3: the Getting Started page (demo/views/pages/getting-started.html), run
 * as a reader runs it. Each guide's commands are read from the page itself, so
 * the page and this suite cannot drift apart, and changed only as `edit` lists:
 * the placeholders a reader replaces, the image under test, and host ports that
 * leave a UAG already running on this machine alone. When the page stops
 * containing the text an edit expects, the suite fails and says so.
 *
 * - Open Source, self-hosted: the page's docker-compose.yml, its portal login,
 *   a form tagged `uag` after the UAG started, the page's MCP client, a
 *   conversation that submits, and the Agent API's license answer. Needs only
 *   Docker.
 * - Hosted project: the page's `docker run` against a project on Form.io's
 *   hosted service, the MCP client, and the Agent API `curl`. Needs
 *   E2E_HOSTED_PROJECT_URL and E2E_HOSTED_PROJECT_KEY, a project with the demo's
 *   `claim` form (module/project.json; https://uag.form.io has it), and
 *   CLAUDE_API_KEY.
 * - Enterprise, self-hosted: the page's `formio-uag` service beside Form.io
 *   Enterprise, with a project made from the demo's template, the MCP client
 *   and the Agent API `curl`. Needs E2E_FORMIO_LICENSE (a Form.io license that
 *   includes the UAG and allows formio.e2e.test), CLAUDE_API_KEY and
 *   TYPESAFE_API_KEY.
 *
 * A guide whose variables are missing is skipped, unless E2E_STRICT=true (the
 * release workflow), which fails it instead. E2E_UAG_IMAGE runs a published
 * image instead of one built from this tree.
 */
const PAGE = path.join(repoRoot, 'demo/views/pages/getting-started.html');
const STRICT = process.env.E2E_STRICT === 'true';
const UAG_IMAGE = process.env.E2E_UAG_IMAGE || IMAGE;

/** The code blocks of one of the page's tab panels, as a reader copies them. */
async function documented(panel) {
    const html = await fs.readFile(PAGE, 'utf8');
    const body = html.split(`id="${panel}"`)[1]?.split('role="tabpanel"')[0];
    if (!body) throw new Error(`The Getting Started page has no panel "${panel}".`);
    return [...body.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map((match) => match[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&'));
}

/** `text` with each `[from, to]` replaced; every `from` must be in it. */
function edit(text, edits) {
    for (const [from, to] of edits) {
        if (!text.includes(from)) throw new Error(`The Getting Started page no longer contains ${JSON.stringify(from)}. Update this suite with the page.\n\n${text}`);
        text = text.split(from).join(to);
    }
    return text;
}

/** Skips the suite when `names` are not all set, or fails it under E2E_STRICT. */
function requireEnv(context, names) {
    const missing = names.filter((name) => !process.env[name]);
    if (!missing.length) return;
    if (STRICT) throw new Error(`E2E_STRICT is set, and this guide needs ${missing.join(', ')}.`);
    console.log(`    Skipping: set ${missing.join(', ')} to run this guide.`);
    context.skip();
}

/** Runs one of the page's bash commands, with `env` for the values a reader fills in. */
async function bash(script, env = {}) {
    const { stdout } = await exec('bash', ['-c', script], { env: { ...process.env, ...env }, timeout: 300000, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
}

/**
 * Runs the page's MCP client as its own program, as a reader saves and runs it:
 * it must print the UAG's tools and then exit by itself.
 */
async function runMcpClient(source, env) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uag-e2e-mcp-client-'));
    try {
        // The reader's `npm install @modelcontextprotocol/sdk`.
        await fs.symlink(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
        await fs.writeFile(path.join(dir, 'client.mjs'), source);
        const { stdout } = await exec(process.execPath, ['client.mjs'], { cwd: dir, env: { ...process.env, ...env }, timeout: 60000 })
            .catch((error) => {
                throw new Error(error.killed ? `The MCP client did not exit within 60 seconds. It printed:\n${error.stdout}` : `The MCP client failed: ${error.stderr || error.message}`);
            });
        return stdout;
    }
    finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

/** An MCP client of the suite's own, to look at what an agent is offered. */
async function connect(uag, clientId, secret) {
    const response = await fetch(`${uag}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret }),
    });
    const { access_token: token } = await response.json();
    if (!token) throw new Error(`No token from ${uag}/auth/token (${response.status}).`);
    const mcp = new Client({ name: 'uag-e2e-getting-started', version: '1.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${uag}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return mcp;
}

const text = (result) => result.content.map((part) => part.text).join('\n');

/** A Compose project in a temporary folder, from a docker-compose.yml and an env file. */
async function composeProject(project, yaml, env = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${project}-`));
    await fs.writeFile(path.join(dir, 'docker-compose.yml'), yaml);
    const envFile = path.join(dir, '.env');
    // Single quotes keep values literal: Compose does not interpolate them.
    await fs.writeFile(envFile, Object.entries(env).map(([name, value]) => `${name}='${value}'\n`).join(''), { mode: 0o600 });
    const compose = (...args) => exec('docker', ['compose', '-p', project, '--project-directory', dir, '--env-file', envFile, ...args],
        { cwd: dir, timeout: 900000, maxBuffer: 16 * 1024 * 1024 });
    return {
        compose,
        envFile,
        async logs(service) {
            return (await compose('logs', '--tail', '60', service).catch((error) => error)).stdout || '';
        },
        async down() {
            await compose('down', '-v').catch((error) => console.log(`    Teardown of ${project} failed: ${error.message}`));
            await fs.rm(dir, { recursive: true, force: true });
        },
    };
}

describe('Layer 3: the Getting Started guides, as documented', function () {
    this.timeout(1800000);

    before(async function () {
        if (!process.env.E2E_UAG_IMAGE) await buildLocalImage();
    });

    describe('2 · Open Source, self-hosted', function () {
        const PORTAL = 'http://127.0.0.1:3441';
        const UAG = 'http://127.0.0.1:3442';
        let stack;
        // The administrator's token, from logging in to the portal.
        let jwt = '';

        before(async function () {
            const [composeFile] = await documented('panel-oss');
            stack = await composeProject('uag-e2e-getting-started-oss', edit(composeFile, [
                ['image: formio/uag\n', `image: ${UAG_IMAGE}\n`],
                ['"3000:3001"', '"3441:3001"'],
                ['"3200:3200"', '"3442:3200"'],
            ]));
            await stack.compose('up', '-d');
        });

        after(async () => stack?.down());

        it('serves the portal, where the administrator the guide names can log in', async function () {
            await waitUntil(async () => {
                const response = await fetch(PORTAL);
                if (!response.ok) throw new Error(`The portal answered ${response.status}.`);
            }, { describe: () => stack.logs('formio') });
            const login = await fetch(`${PORTAL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: { email: 'admin@example.com', password: 'CHANGEME' } }),
            });
            expect(login.status, 'logging in as admin@example.com / CHANGEME').to.equal(200);
            jwt = login.headers.get('x-jwt-token');
            expect(jwt).to.be.a('string');
        });

        it('offers a form tagged `uag` in the portal to agents, without a restart', async function () {
            // What the portal's New Form page saves.
            const created = await fetch(`${PORTAL}/form`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-jwt-token': jwt },
                body: JSON.stringify({
                    title: 'Customer', name: 'customer', path: 'customer', type: 'form', display: 'form', tags: ['uag'],
                    components: [
                        { type: 'textfield', key: 'firstName', label: 'First Name', input: true, validate: { required: true } },
                        { type: 'email', key: 'email', label: 'Email', input: true },
                        { type: 'button', key: 'submit', label: 'Submit', action: 'submit', input: true },
                    ],
                }),
            });
            expect(created.status, 'creating the form').to.equal(201);
            await waitUntil(async () => {
                const mcp = await connect(UAG, 'formio-oss-x-admin-key', 'CHANGEME');
                try {
                    const forms = text(await mcp.callTool({ name: 'get_forms', arguments: {} }));
                    if (!forms.includes('customer')) throw new Error(`An agent is not offered the new form yet:\n${forms.slice(0, 300)}`);
                }
                finally {
                    await mcp.close();
                }
            }, { timeoutMs: 90000, describe: () => stack.logs('formio-uag') });
        });

        it('runs the page\'s MCP client, which lists the tools and exits', async function () {
            const [client] = await documented('panel-mcp');
            const stdout = await runMcpClient(edit(client, [
                ['\'yourproject-x-token\'', '\'formio-oss-x-admin-key\''],
                ['http://localhost:3200', UAG],
            ]), { PROJECT_KEY: 'CHANGEME' });
            expect(stdout).to.include('get_forms').and.to.include('submit_completed_form');
        });

        it('runs a conversation form with no license, which saves to Form.io', async function () {
            const mcp = await connect(UAG, 'formio-oss-x-admin-key', 'CHANGEME');
            try {
                const collected = await mcp.callTool({ name: 'collect_field_data', arguments: {
                    form_name: 'customer', form_data: {}, updates: [{ data_path: 'firstName', new_value: 'Ada' }, { data_path: 'email', new_value: 'ada@example.com' }],
                } });
                expect(collected.isError, text(collected)).to.not.equal(true);
                const submitted = await mcp.callTool({ name: 'submit_completed_form', arguments: { form_name: 'customer', form_data: { firstName: 'Ada', email: 'ada@example.com' } } });
                expect(submitted.isError, text(submitted)).to.not.equal(true);
            }
            finally {
                await mcp.close();
            }
            const saved = await (await fetch(`${PORTAL}/customer/submission`, { headers: { 'x-admin-key': 'CHANGEME' } })).json();
            expect(saved.map((submission) => submission.data.email)).to.include('ada@example.com');
        });

        it('answers the Agent API with what it needs, as the guide says', async function () {
            const response = await fetch(`${UAG}/customer/agent/extract`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-admin-key': 'CHANGEME' },
                body: JSON.stringify({ text: 'My name is Ada.' }),
            });
            const body = await response.json();
            expect(response.status).to.equal(403);
            expect(body.code).to.equal('license_required');
            expect(body.error).to.include('LICENSE_KEY').and.to.include('hosted service');
        });
    });

    describe('1 · Hosted project', function () {
        const UAG = 'http://127.0.0.1:3443';
        const CONTAINER = 'uag-e2e-getting-started-hosted';
        const env = () => ({ PROJECT_KEY: process.env.E2E_HOSTED_PROJECT_KEY, CLAUDE_API_KEY: process.env.CLAUDE_API_KEY });
        let projectUrl = '';
        let name = '';

        before(async function () {
            requireEnv(this, ['E2E_HOSTED_PROJECT_URL', 'E2E_HOSTED_PROJECT_KEY', 'CLAUDE_API_KEY']);
            projectUrl = process.env.E2E_HOSTED_PROJECT_URL.replace(/\/+$/, '');
            name = new URL(projectUrl).hostname.split('.')[0];
            const [run] = await documented('panel-saas');
            await exec('docker', ['rm', '-f', CONTAINER]).catch(() => {});
            // The keys stay in the environment: the command reads them as a reader's shell would.
            await bash(edit(run, [
                ['--name formio-uag -p 3200:3200', `--name ${CONTAINER} -p 3443:3200`],
                ['https://yourproject.form.io', projectUrl],
                ['PROJECT_KEY=your-project-api-key', 'PROJECT_KEY="$PROJECT_KEY"'],
                ['CLAUDE_API_KEY=your-anthropic-key', 'CLAUDE_API_KEY="$CLAUDE_API_KEY"'],
                ['\n  formio/uag', `\n  ${UAG_IMAGE}`],
            ]), env());
            await waitUntil(async () => {
                const response = await fetch(`${UAG}/auth/token`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grant_type: 'client_credentials', client_id: `${name}-x-token`, client_secret: process.env.E2E_HOSTED_PROJECT_KEY }),
                });
                if (!response.ok) throw new Error(`The UAG answered ${response.status}.`);
            }, { describe: async () => (await exec('docker', ['logs', '--tail', '60', CONTAINER]).catch((error) => error)).stdout || '' });
        });

        after(async () => {
            await exec('docker', ['rm', '-f', CONTAINER]).catch(() => {});
        });

        it('runs the page\'s MCP client, which lists the tools and exits', async function () {
            const [client] = await documented('panel-mcp');
            const stdout = await runMcpClient(edit(client, [
                ['\'yourproject-x-token\'', `'${name}-x-token'`],
                ['http://localhost:3200', UAG],
            ]), env());
            expect(stdout).to.include('get_forms');
        });

        it('triages the claim with the page\'s Agent API curl', async function () {
            const [curl] = await documented('panel-api');
            const out = await bash(`${edit(curl, [['http://localhost:3200/yourproject/', `${UAG}/${name}/`]])} -sS --fail-with-body`, env());
            const answer = JSON.parse(out);
            expect(answer.tasks).to.deep.equal(['triage']);
            expect(answer.fields['triage.claimType'].value).to.be.a('string').and.not.equal('');
            expect(answer.fields['triage.injuryInvolved'].value).to.equal(true);
        });
    });

    describe('3 · Enterprise, self-hosted', function () {
        const FORMIO = 'http://127.0.0.1:3444';
        const UAG = 'http://127.0.0.1:3445';
        let stack;
        const secrets = {
            PROJECT_KEY: randomBytes(16).toString('hex'),
            JWT_SECRET: randomBytes(16).toString('hex'),
            ADMIN_PASS: randomBytes(12).toString('hex'),
        };

        before(async function () {
            requireEnv(this, ['E2E_FORMIO_LICENSE', 'CLAUDE_API_KEY', 'TYPESAFE_API_KEY']);
            const [service] = await documented('panel-ent');
            // Form.io Enterprise, as a reader already runs it, and the page's service beside it.
            // The UAG reaches the project by its ID on formio.e2e.test, the endpoint the test
            // license allows (Enterprise reads a dotted host as a project subdomain).
            const yaml = [
                'services:',
                '  mongo:',
                '    image: mongo:7',
                '  formio-enterprise:',
                '    image: formio/formio-enterprise:9.9.0',
                '    platform: linux/amd64',
                '    depends_on: [mongo]',
                '    ports: ["3444:3000"]',
                '    networks:',
                '      default:',
                '        aliases: [formio.e2e.test]',
                '    environment:',
                '      PORT: 3000',
                // With its portal, which makes the administrator the project is created as.
                '      PORTAL_ENABLED: "1"',
                '      MONGO: mongodb://mongo:27017/formio',
                '      DB_SECRET: ${JWT_SECRET}',
                '      JWT_SECRET: ${JWT_SECRET}',
                '      ADMIN_EMAIL: admin@example.com',
                '      ADMIN_PASS: ${ADMIN_PASS}',
                '      LICENSE_KEY: ${LICENSE_KEY}',
                '      LICENSE_REMOTE: ${LICENSE_REMOTE}',
                edit(service, [
                    ['image: formio/uag\n', `image: ${UAG_IMAGE}\n    ports: ["3445:3200"]\n`],
                    ['PROJECT: http://formio-enterprise:3000/yourproject', 'PROJECT: http://formio.e2e.test:3000/project/${E2E_PROJECT_ID}'],
                ]),
                '',
            ].join('\n');
            stack = await composeProject('uag-e2e-getting-started-enterprise', yaml, {
                ...secrets,
                LICENSE_KEY: process.env.E2E_FORMIO_LICENSE,
                LICENSE_REMOTE: process.env.E2E_FORMIO_LICENSE_REMOTE || '',
                TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
                CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                E2E_PROJECT_ID: '',
            });
            await stack.compose('up', '-d', 'formio-enterprise');
            await waitUntil(async () => {
                if (!(await fetch(FORMIO)).ok) throw new Error('Form.io Enterprise is not up yet.');
            }, { timeoutMs: 300000, describe: () => stack.logs('formio-enterprise') });
            // A project named `yourproject` with the demo's forms (the claim form among them) and the
            // key. Form.io answers before it has made its administrator, so log in until it can.
            await waitUntil(() => exec(process.execPath, [path.join(repoRoot, 'demo/server/setup.mjs')], {
                env: { ...process.env, FORMIO_SERVER: FORMIO, FORMIO_PROJECT_NAME: 'yourproject', FORMIO_PROJECT_TITLE: 'Your Project', ADMIN_EMAIL: 'admin@example.com', ...secrets },
                timeout: 300000,
            }), { timeoutMs: 300000, intervalMs: 5000, describe: () => stack.logs('formio-enterprise') });
            const project = await (await fetch(`${FORMIO}/yourproject`, { headers: { 'x-token': secrets.PROJECT_KEY } })).json();
            expect(project._id, 'the project').to.be.a('string');
            await fs.appendFile(stack.envFile, `E2E_PROJECT_ID='${project._id}'\n`);
            await stack.compose('up', '-d', 'formio-uag');
            await waitUntil(async () => {
                const response = await fetch(`${UAG}/auth/token`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grant_type: 'client_credentials', client_id: 'yourproject-x-token', client_secret: secrets.PROJECT_KEY }),
                });
                if (!response.ok) throw new Error(`The UAG answered ${response.status}.`);
            }, { describe: () => stack.logs('formio-uag') });
        });

        after(async () => stack?.down());

        it('runs the page\'s MCP client, which lists the tools and exits', async function () {
            const [client] = await documented('panel-mcp');
            const stdout = await runMcpClient(edit(client, [['http://localhost:3200', UAG]]), { PROJECT_KEY: secrets.PROJECT_KEY });
            expect(stdout).to.include('get_forms');
        });

        it('triages the claim with the page\'s Agent API curl, on JEV and Claude', async function () {
            const [curl] = await documented('panel-api');
            const out = await bash(`${edit(curl, [['http://localhost:3200/', `${UAG}/`]])} -sS --fail-with-body`, { PROJECT_KEY: secrets.PROJECT_KEY });
            const answer = JSON.parse(out);
            expect(answer.tasks).to.deep.equal(['triage']);
            expect(answer.fields['triage.claimType'].engine, 'a decision engine decides the claim type').to.equal('jev');
            expect(answer.fields['triage.injuryInvolved'].value).to.equal(true);
        });
    });
});
