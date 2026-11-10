import { expect } from 'chai';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { PROFILES } from '../../demo/module/applicants.mjs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { IMAGE, buildLocalImage, exampleStack, repoRoot, waitUntil } from './helpers/exampleStack.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { guest, startExample, flowLog } from './helpers/demoStack.mjs';
import { serveSite } from '../../demo/scripts/serve.mjs';
import { settled } from '../../demo/module/applicants.mjs';
import { createDemoProject, deployedMissing, deployedSettings, deploymentClient, uagReach } from '../../demo/recordings/deployed.mjs';

const execFileAsync = promisify(execFile);

const PROJECT = 'uag-e2e-demo';
const SITE = 'http://127.0.0.1:3430';
// Form.io: the stack's, or, with FORMIO_TEST_URL, an Enterprise deployment already running.
const DEPLOYED = process.env.FORMIO_TEST_URL ? deployedSettings() : null;
const FORMIO = DEPLOYED ? DEPLOYED.url : 'http://127.0.0.1:3431';
/** The project's path, on Form.io and on the UAG. */
const PROJECT_PATH = DEPLOYED ? '/uag-e2e-demo' : '/demo';
/** The UAG, published so the suite can call it as a connected portal stage does. */
const UAG = 'http://127.0.0.1:3432';
const ADMIN_EMAIL = 'admin@example.com';
const REQUIRED = ['E2E_FORMIO_LICENSE', 'CLAUDE_API_KEY', 'TYPESAFE_API_KEY'];
const UAG_LICENSE = process.env.E2E_DEMO_UAG_LICENSE || process.env.E2E_EXAMPLE_UAG_LICENSE;
// A release's published images, instead of images built from this tree, to check what
// was shipped: E2E_UAG_IMAGE and E2E_ENGINES_IMAGE (both), such as
// formio/uag:2.0.0-rc.1. E2E_PLATFORM (such as linux/amd64) runs the UAG's own services
// on that platform, to check another architecture; MongoDB and Form.io keep theirs.
const PUBLISHED = { uag: process.env.E2E_UAG_IMAGE, engines: process.env.E2E_ENGINES_IMAGE };
const published = Object.values(PUBLISHED).some(Boolean);
if (published && !Object.values(PUBLISHED).every(Boolean)) {
    throw new Error('Set both E2E_UAG_IMAGE and E2E_ENGINES_IMAGE, or neither.');
}
const IMAGES = published ? PUBLISHED : { uag: IMAGE, engines: 'formio/uag-engines:e2e-local' };
const PLATFORM = process.env.E2E_PLATFORM || '';
const onPlatform = PLATFORM ? [`    platform: ${PLATFORM}`] : [];

/**
 * Layer 3: the demo as it ships, self-hosted. The demo's own docker-compose.yml
 * (the UAG) with docker-compose.enterprise.yml (Enterprise Form.io, the setup
 * job) and docker-compose.split.yml (the engine server with JEV and Claude),
 * the UAG built from this tree, under its own Compose project name, with an
 * override that changes only the published ports, the UAG's image, and the name
 * the UAG reaches the project by: the Form.io service gets the alias
 * `formio.e2e.test`, the endpoint the test license allows, and the UAG loads the
 * project by its ID URL there (Enterprise Form.io reads a dotted host as a
 * project subdomain). The static site is built for that UAG and project and
 * served here, as CloudFront serves it. Everything is driven as a visitor's
 * browser would: a guest of the project, a real conversation (the UAG's
 * agent/chat), real Run task actions and engines settling two applicants, and
 * the claims wizard triaged in a browser, with each engine's summary in the
 * flow log. With E2E_UAG_IMAGE and E2E_ENGINES_IMAGE it runs a release's
 * published images instead of building this tree.
 * With FORMIO_TEST_URL it runs on that Enterprise deployment instead of starting
 * one (FORMIO_TEST_EMAIL, FORMIO_TEST_PASSWORD, FORMIO_TEST_UAG_LICENSE; see
 * demo/recordings/deployed.mjs): in a project of its own, uag-e2e-demo, which it
 * deletes after, with the accounts and teams it made.
 * This is the release check for the demo; it is skipped unless
 * E2E_FORMIO_LICENSE, E2E_DEMO_UAG_LICENSE (or E2E_EXAMPLE_UAG_LICENSE),
 * CLAUDE_API_KEY and TYPESAFE_API_KEY are set.
 */
describe('Layer 3: the demo site, as it ships', function () {
    // The project's API key, for the requests the suite makes as an administrator.
    let key = '';
    // The portal administrator's password, and the secret the UAG shares with connected stages.
    let adminPass = '';
    let portalSecret = '';
    let projectId = '';
    this.timeout(2400000);

    let stack;
    let site;
    let visitor;
    let out = '';
    // A guest of the project, as the site signs each visitor in, calling the UAG under the project's name.
    const asGuest = () => guest({ uagUrl: `${UAG}${PROJECT_PATH}` });
    // On a deployment: its client, and what the suite made there, which after() deletes.
    let deployment = null;
    const made = { users: [], teams: [] };
    let adminEmail = ADMIN_EMAIL;

    /**
     * The demo on the deployment FORMIO_TEST_URL names: a project of its own,
     * owned by FORMIO_TEST_EMAIL, and the UAG (with the engine server and a
     * MongoDB for its database) in Docker, reaching it as uagReach says.
     */
    async function startOnDeployment(projectKey, secret) {
        deployment = await deploymentClient(DEPLOYED);
        adminEmail = DEPLOYED.email;
        adminPass = DEPLOYED.password;
        ({ _id: projectId } = await createDemoProject(deployment, { name: PROJECT_PATH.slice(1), title: 'UAG E2E Demo', projectKey }));
        const reach = await uagReach(FORMIO, { name: PROJECT_PATH.slice(1), id: projectId });
        stack = await exampleStack({
            project: PROJECT,
            dir: path.join(repoRoot, 'demo'),
            files: ['docker-compose.split.yml'],
            env: {
                FORMIO_PROJECT_URL: reach.projectUrl,
                PROJECT_KEY: projectKey,
                UAG_LICENSE: DEPLOYED.uagLicense,
                UAG_LICENSE_REMOTE: DEPLOYED.uagLicenseRemote,
                PORTAL_SECRET: portalSecret,
                UAG_JWT_SECRET: secret(),
                ENGINE_SERVER_KEY: secret(),
                TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
                CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                DEMO_SITE_ORIGIN: `${SITE},${SITE.replace('127.0.0.1', 'localhost')}`,
                UAG_IMAGE: IMAGES.uag,
                ENGINES_IMAGE: IMAGES.engines,
            },
            override: [
                'services:',
                '  mongo:',
                '    image: mongo:7',
                '  formio-uag:',
                ...onPlatform,
                '    build: !reset null',
                '    pull_policy: never',
                '    ports: !override',
                `      - "127.0.0.1:${new URL(UAG).port}:3200"`,
                '    extra_hosts:',
                `      - "${reach.extraHost}"`,
                '    environment:',
                '      LICENSE_KEY: ${UAG_LICENSE}',
                '      LICENSE_REMOTE: ${UAG_LICENSE_REMOTE}',
                '      PORTAL_SECRET: ${PORTAL_SECRET}',
                '      MCP_OAUTH: "true"',
                '      MONGO: mongodb://mongo:27017',
                '      UAG_DATABASE: uag',
                ...(PLATFORM ? ['uag-engines'].flatMap((service) => [`  ${service}:`, ...onPlatform]) : []),
                '',
            ].join('\n'),
        });
        if (published) {
            for (const image of Object.values(IMAGES)) {
                await execFileAsync('docker', ['pull', ...(PLATFORM ? ['--platform', PLATFORM] : []), image], { timeout: 1200000 });
            }
        }
        else {
            await buildLocalImage();
            await stack.compose('build', 'uag-engines');
        }
        await stack.compose('up', '-d');
    }

    before(async function () {
        const missing = DEPLOYED ? deployedMissing() : [...REQUIRED.filter((name) => !process.env[name]), ...(UAG_LICENSE ? [] : ['E2E_DEMO_UAG_LICENSE'])];
        if (missing.length) {
            console.log(`    Skipping: ${missing.join(', ')} not set.`);
            this.skip();
        }
        const secret = () => randomBytes(24).toString('hex');
        const projectKey = secret();
        key = projectKey;
        portalSecret = secret();
        if (DEPLOYED) await startOnDeployment(projectKey, secret);
        else {
            adminPass = secret();
            stack = await exampleStack({
                project: PROJECT,
                dir: path.join(repoRoot, 'demo'),
                files: ['docker-compose.enterprise.yml', 'docker-compose.split.yml'],
                env: {
                    LICENSE_KEY: process.env.E2E_FORMIO_LICENSE,
                    LICENSE_REMOTE: process.env.E2E_FORMIO_LICENSE_REMOTE || '',
                    // Its portal, which its teams and the stage connected to the UAG need, and its administrator.
                    PORTAL_ENABLED: 'true',
                    ADMIN_EMAIL,
                    ADMIN_PASS: adminPass,
                    FORMIO_ADMIN_KEY: secret(),
                    DB_SECRET: secret(),
                    FORMIO_JWT_SECRET: secret(),
                    PROJECT_KEY: projectKey,
                    UAG_LICENSE,
                    UAG_JWT_SECRET: secret(),
                    ENGINE_SERVER_KEY: secret(),
                    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
                    CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                    // The site's origin, by either name a browser may use for it.
                    DEMO_SITE_ORIGIN: `${SITE},${SITE.replace('127.0.0.1', 'localhost')}`,
                    UAG_IMAGE: IMAGES.uag,
                    ENGINES_IMAGE: IMAGES.engines,
                },
                override: [
                    'services:',
                    '  api-server:',
                    '    ports: !override',
                    `      - "127.0.0.1:${new URL(FORMIO).port}:3000"`,
                    '    networks:',
                    '      default:',
                    '        aliases: [formio.e2e.test]',
                    '  formio-uag:',
                    ...onPlatform,
                    '    build: !reset null',
                    '    pull_policy: never',
                    // The UAG's own database, on Form.io's MongoDB: remote MCP sign-in and run records.
                    '    networks: [default, db]',
                    '    ports: !override',
                    `      - "127.0.0.1:${new URL(UAG).port}:3200"`,
                    '    environment:',
                    `      PORTAL_SECRET: ${portalSecret}`,
                    '      PROJECT: ${E2E_PROJECT_URL:-http://api-server:3000/demo}',
                    '      MCP_OAUTH: "true"',
                    '      MONGO: mongodb://mongo:27017',
                    '      UAG_DATABASE: uag',
                    // A locally built appserver-core, to check a core change before it is published.
                    ...(process.env.E2E_CORE_BUNDLE ? [
                        '    volumes:',
                        `      - ${path.resolve(process.env.E2E_CORE_BUNDLE)}:/app/node_modules/@formio/appserver-core/server.js:ro`,
                    ] : []),
                    ...(PLATFORM ? ['uag-engines'].flatMap((service) => [`  ${service}:`, ...onPlatform]) : []),
                    '',
                ].join('\n'),
            });

            if (published) {
                // Pulled whole, so a stale local copy of a tag is never what is checked.
                for (const image of Object.values(IMAGES)) {
                    await execFileAsync('docker', ['pull', ...(PLATFORM ? ['--platform', PLATFORM] : []), image], { timeout: 1200000 });
                }
            }
            else {
                await buildLocalImage();
                await stack.compose('build', 'uag-engines');
            }
            await stack.compose('up', '-d', '--wait', 'mongo', 'api-server');
            await stack.compose('run', '--rm', 'setup').catch(async (error) => {
                error.message += `\n${error.stdout || ''}${error.stderr || ''}\nForm.io:\n${await stack.logs('api-server', 40)}`;
                throw error;
            });
            ({ _id: projectId } = await (await fetch(`${FORMIO}/demo`, { headers: { 'x-token': projectKey } })).json());
            expect(projectId, 'the setup job created no project').to.be.a('string');
            await fs.appendFile(stack.envFile, `E2E_PROJECT_URL='http://formio.e2e.test:3000/project/${projectId}'\n`);
            await stack.compose('up', '-d');
        }
        // Up once the UAG serves the chat's form.
        await waitUntil(async () => {
            const response = await fetch(`${UAG}${PROJECT_PATH}/service-request`, { headers: { 'x-token': projectKey } });
            const body = response.ok ? await response.json() : null;
            if (body?.name !== 'serviceRequest') throw new Error(`form: ${JSON.stringify(body)}`);
        }, { timeoutMs: 600000, describe: async () => stack.logs('formio-uag') });
        // The static site, built for this UAG and project.
        out = await fs.mkdtemp(path.join(os.tmpdir(), 'uag-e2e-demo-site-'));
        site = await serveSite({
            port: new URL(SITE).port,
            env: { DEMO_PUBLIC_URL: SITE, DEMO_OUT: out, FORMIO_PROJECT_URL: `${FORMIO}${PROJECT_PATH}`, DEMO_UAG_URL: UAG, DEMO_UAG_PROJECT_PATH: PROJECT_PATH },
        });
        visitor = await asGuest();
    });

    after(async function () {
        if (site) await site.close();
        if (stack) await stack.down();
        if (out) await fs.rm(out, { recursive: true, force: true });
        if (deployment) {
            for (const id of made.teams) await deployment.api('DELETE', `/team/${id}`).catch(() => {});
            for (const id of made.users) await deployment.api('DELETE', `/formio/user/submission/${id}`).catch(() => {});
            if (projectId) await deployment.deleteProject(projectId).catch((error) => console.log(`    ${error.message}`));
        }
    });

    it('serves every page, and a 404 for a page it does not have', async function () {
        for (const pathname of ['/', '/getting-started', '/examples', '/examples/conversation', '/examples/workflow', '/examples/formflow', '/examples/documents', '/faq', '/contact', '/developers', '/developers/agent-api']) {
            const response = await fetch(`${SITE}${pathname}`);
            expect(response.status, pathname).to.equal(200);
            expect(await response.text(), pathname).to.include(`data-uag-url="${UAG}"`);
        }
        expect((await fetch(`${SITE}/no-such-page`)).status).to.equal(404);
    });

    it('lets the site call the UAG from the browser, and no other origin', async function () {
        const allowed = await fetch(`${UAG}${PROJECT_PATH}/service-request`, { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-jwt-token' } });
        expect(allowed.headers.get('access-control-allow-origin')).to.equal(SITE);
        const other = await fetch(`${UAG}${PROJECT_PATH}/service-request`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' } });
        expect(other.headers.get('access-control-allow-origin')).to.not.equal('https://evil.example.com');
    });

    it('lets an OAuth client find every authorization endpoint from the root, as Claude connectors do', async function () {
        // Walk the discovery chain from inside the network, as a remote MCP client would from outside.
        const script = `(async () => {
            const base = 'http://localhost:3200', out = {};
            const mcp = await fetch(base + '/mcp', { method: 'POST' });
            out.mcp = mcp.status;
            const metadataUrl = /resource_metadata="([^"]+)"/.exec(mcp.headers.get('www-authenticate') || '')?.[1] || '';
            // The UAG names itself from the request: here, the address this script used.
            out.resourceMetadata = metadataUrl.startsWith(base) ? (await fetch(metadataUrl)).status : metadataUrl;
            const server = await fetch(base + '/.well-known/oauth-authorization-server');
            out.authorizationServer = server.status;
            if (server.ok) {
                const meta = await server.json();
                for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
                    const url = meta[key];
                    out[key] = (await fetch(url, { method: key === 'authorization_endpoint' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: key === 'authorization_endpoint' ? undefined : '{}' })).status;
                }
            }
            console.log(JSON.stringify(out));
        })()`;
        const { stdout } = await stack.compose('exec', '-T', 'formio-uag', 'node', '-e', script);
        const chain = JSON.parse(stdout.trim().split('\n').pop());
        expect(chain.mcp, JSON.stringify(chain)).to.equal(401);
        expect(chain.resourceMetadata, JSON.stringify(chain)).to.equal(200);
        expect(chain.authorizationServer, JSON.stringify(chain)).to.equal(200);
        for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
            expect(chain[key], `${key}: ${JSON.stringify(chain)}`).to.not.equal(404);
        }
    });

    it('turns a customer\'s messages into a valid service request', async function () {
        const turns = [
            'Hi, my internet has been completely down since last night and nothing works. I\'m Marcus Webb, my email is marcus.webb@example.com.',
            'The service address is 12 Elm Street, Springfield. The router lights are all off and no device has been able to connect since last night.',
            'It is an internet problem, and it is urgent because nothing works at all. I don\'t need a particular callback time.',
            'No, that is everything. Yes, that is all correct. Please submit it now.',
            'Yes, please submit it.',
            'Yes. Submit.',
        ];
        const form = await visitor.json('/service-request');
        expect(form.status).to.equal(200);
        const chatPath = `/form/${form.body._id}/agent/chat`;
        const messages = [];
        const transcript = [];
        let data = {};
        let last = null;
        for (const message of turns) {
            messages.push({ role: 'user', content: message });
            const { status, body } = await visitor.json(chatPath, { method: 'POST', body: { messages, data } });
            expect(status, JSON.stringify(body)).to.equal(200);
            messages.push({ role: 'assistant', content: body.reply });
            transcript.push(`USER: ${message}`, `ASSISTANT: ${body.reply}`, `PATCH: ${JSON.stringify(body.patch)}`);
            data = body.data;
            last = body;
            if (body.confirmed) break;
        }
        const debug = transcript.join('\n');
        expect(last.complete, debug).to.equal(true);
        expect(last.confirmed, debug).to.equal(true);
        expect(data, debug).to.include({ fullName: 'Marcus Webb', email: 'marcus.webb@example.com', category: 'internet', urgency: 'high' });
        expect(data.serviceAddress, debug).to.include('12 Elm Street');
        // The page then submits the form, through the UAG, as the guest.
        const saved = await visitor.json(`/form/${form.body._id}/submission`, { method: 'POST', body: { data } });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(201);
        expect(saved.body.data).to.include({ fullName: 'Marcus Webb' });
    });

    it('declines the weak applicant, awards the strong one, and then stops', async function () {
        // Each applicant is a guest of their own, as two visitors of the site would be.
        async function apply(profile) {
            const applicant = await asGuest();
            const { status, body } = await applicant.json('/application/submission', { method: 'POST', body: { data: PROFILES[profile] } });
            expect(status, JSON.stringify(body)).to.equal(201);
            const deadline = Date.now() + 300000;
            let read;
            do {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                read = await applicant.json(`/application/submission/${body._id}`);
            } while (!settled(read.body.data || {}) && Date.now() < deadline);
            if (!settled(read.body.data || {})) throw new Error(`The ${profile} applicant did not settle: ${JSON.stringify(read.body)}\n${await stack.logs('formio-uag')}`);
            return { applicant, id: body._id, modified: read.body.modified, result: read.body.data };
        }
        const [weak, strong] = await Promise.all([apply('weak'), apply('strong')]);
        expect(weak.result).to.include({ status: 'declined', decision: 'declined' });
        expect(weak.result.awardLevel || '').to.equal('');
        expect(strong.result).to.include({ status: 'scholarshipEvaluation', decision: 'acceptedWithScholarship' });
        expect(strong.result.awardLevel).to.be.oneOf(['fullRide', 'roomBoard25', 'supplemental25', 'reward1000']);
        expect(strong.result.financeRationale).to.be.a('string').and.not.equal('');
        // Neither applicant may read the other's application.
        expect((await weak.applicant.json(`/application/submission/${strong.id}`)).status).to.be.oneOf([401, 403, 404]);

        // The finance task's own save must not start another round.
        await new Promise((resolve) => setTimeout(resolve, 30000));
        expect((await weak.applicant.json(`/application/submission/${weak.id}`)).body.modified).to.equal(weak.modified);
        expect((await strong.applicant.json(`/application/submission/${strong.id}`)).body.modified).to.equal(strong.modified);
    });

    it('lists each agent run in Action Logs, beside Form.io\'s own entries', async function () {
        const form = await (await fetch(`${FORMIO}${PROJECT_PATH}/application`, { headers: { 'x-token': key } })).json();
        expect(form._id, JSON.stringify(form)).to.be.a('string');
        const script = `(async () => {
            const logs = await fetch('http://localhost:3200/action?form=${form._id}&limit=100', { headers: { 'x-token': ${JSON.stringify(key)} } });
            const text = await logs.text();
            console.log(JSON.stringify({ status: logs.status, range: logs.headers.get('content-range'), text }));
        })()`;
        const { stdout } = await stack.compose('exec', '-T', 'formio-uag', 'node', '-e', script);
        const logs = JSON.parse(stdout.trim().split('\n').pop());
        expect(logs.status, JSON.stringify(logs)).to.equal(200);
        logs.items = JSON.parse(logs.text);
        const runs = logs.items.filter((item) => item.action === 'agentRunTask');
        expect(runs.map((run) => run.data.task), JSON.stringify(runs)).to.include.members(['admissions', 'finance']);
        expect(runs.every((run) => run.state === 'complete'), JSON.stringify(runs)).to.equal(true);
    });

    describe('portal team members, through a stage connected to the UAG', function () {
        // Remote tokens, as the portal gets them from Form.io for each member.
        const remote = {};

        /** A request to the Form.io server, as JSON. */
        async function formio(method, pathname, { token, body } = {}) {
            const response = await fetch(`${FORMIO}${pathname}`, {
                method,
                headers: { 'Content-Type': 'application/json', ...(token && { 'x-jwt-token': token }) },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await response.text();
            let json = text;
            try { json = JSON.parse(text); } catch { /* text */ }
            return { status: response.status, token: response.headers.get('x-jwt-token'), body: json };
        }

        /** A request to the UAG as the portal sends it for a connected stage: from a browser, with the member's remote token. */
        async function asMember(name, method, pathname, body) {
            const response = await fetch(`${UAG}/project/${projectId}${pathname}`, {
                method,
                headers: { 'Content-Type': 'application/json', 'x-remote-token': remote[name], Origin: FORMIO },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await response.text();
            let json = text;
            try { json = JSON.parse(text); } catch { /* text */ }
            return { status: response.status, body: json };
        }

        const login = async (email, password) => (await formio('POST', '/formio/user/login', { body: { data: { email, password } } })).token;

        before(async function () {
            const admin = await login(adminEmail, adminPass);
            expect(admin, 'the portal administrator could not sign in').to.be.a('string');
            // Connect the project to the UAG as a remote environment: Form.io signs its
            // members' remote tokens with the secret the UAG verifies them with.
            const project = (await formio('GET', `/project/${projectId}`, { token: admin })).body;
            const teams = {};
            for (const [name, permission] of [['writer', 'team_write'], ['reader', 'team_read']]) {
                // Unique, since a deployment keeps its accounts between runs.
                const email = `${name}-${randomBytes(4).toString('hex')}@example.com`;
                const password = randomBytes(12).toString('hex');
                const created = await formio('POST', '/formio/user/submission', { token: admin, body: { data: { name, email, password } } });
                expect(created.status, JSON.stringify(created.body)).to.equal(201);
                made.users.push(created.body._id);
                const team = await formio('POST', '/team', { token: admin, body: { data: { name: `${name}s` } } });
                expect(team.status, JSON.stringify(team.body)).to.equal(201);
                made.teams.push(team.body._id);
                const added = await formio('POST', `/team/${team.body._id}/member`, { token: admin, body: { data: { userId: created.body._id, email, admin: false } } });
                expect(added.status, JSON.stringify(added.body)).to.equal(201);
                const joined = await formio('POST', `/team/${team.body._id}/join`, { token: await login(email, password) });
                expect(joined.status, JSON.stringify(joined.body)).to.equal(200);
                teams[permission] = { email, password, team: team.body._id };
            }
            const access = [
                ...project.access.filter((entry) => !['team_write', 'team_read'].includes(entry.type)),
                { type: 'team_write', roles: [teams.team_write.team] },
                { type: 'team_read', roles: [teams.team_read.team] },
            ];
            const saved = await formio('PUT', `/project/${projectId}`, { token: admin, body: { ...project, access, settings: { ...project.settings, remoteSecret: portalSecret } } });
            expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
            for (const [name, permission] of [['writer', 'team_write'], ['reader', 'team_read']]) {
                const token = await formio('GET', `/project/${projectId}/access/remote`, { token: await login(teams[permission].email, teams[permission].password) });
                expect(token.status, JSON.stringify(token.body)).to.equal(200);
                remote[name] = token.body;
                expect(JSON.parse(Buffer.from(remote[name].split('.')[1], 'base64url')).permission).to.equal(permission);
            }
        });

        it('lets a team writer open and save a form, and view its submissions', async function () {
            const forms = await asMember('writer', 'GET', '/form?limit=100');
            expect(forms.status, JSON.stringify(forms.body)).to.equal(200);
            const claim = forms.body.find((form) => form.name === 'claim');
            expect(claim, 'the claim form').to.be.an('object');
            const opened = await asMember('writer', 'GET', `/form/${claim._id}`);
            expect(opened.status, JSON.stringify(opened.body)).to.equal(200);
            expect(opened.body.components).to.be.an('array').that.is.not.empty;
            const saved = await asMember('writer', 'PUT', `/form/${claim._id}`, opened.body);
            expect(saved.status, JSON.stringify(saved.body)).to.equal(200);
            expect((await asMember('writer', 'GET', `/form/${claim._id}/submission?limit=10`)).status).to.equal(200);
            expect((await asMember('writer', 'GET', '/role')).status).to.equal(200);
        });

        it('lets a team reader view forms and submissions, but not save', async function () {
            const forms = await asMember('reader', 'GET', '/form?limit=100');
            expect(forms.status, JSON.stringify(forms.body)).to.equal(200);
            const claim = forms.body.find((form) => form.name === 'claim');
            const opened = await asMember('reader', 'GET', `/form/${claim._id}`);
            expect(opened.status, JSON.stringify(opened.body)).to.equal(200);
            expect((await asMember('reader', 'GET', `/form/${claim._id}/submission?limit=10`)).status).to.equal(200);
            expect((await asMember('reader', 'PUT', `/form/${claim._id}`, opened.body)).status).to.equal(401);
        });

        it('keeps the project\'s settings from team writers and readers', async function () {
            for (const name of ['writer', 'reader']) {
                const project = await asMember(name, 'GET', '');
                expect(project.status, name).to.equal(200);
                expect(project.body, name).to.not.have.any.keys('settings', 'settings_encrypted', 'billing');
            }
        });
    });

    describe('the claims wizard, in a browser', function () {
        let browser;

        before(async function () {
            browser = await launchBrowser(this);
        });

        after(async function () {
            if (browser) await browser.close();
        });

        const CASES = [
            { example: 'Rear-ended, neck pain', claimType: 'autoCollision', steps: ['Your vehicle', 'Injuries', 'Other people involved', 'Police report'], absent: ['What was stolen', 'Your home'] },
            { example: 'Car stolen', claimType: 'theft', steps: ['What was stolen', 'Police report'], absent: ['Injuries', 'Your home'] },
            { example: 'Burst pipe', claimType: 'propertyDamage', steps: ['Your home'], absent: ['Your vehicle', 'What was stolen', 'Injuries'] },
        ];

        for (const claim of CASES) {
            it(`triages "${claim.example}" and adds its steps, with both engines in the flow log`, async function () {
                const page = await browser.page();
                page.setDefaultTimeout(120000);
                const frame = await startExample(page, 'formflow', { site: SITE });
                await frame.locator('#examples button', { hasText: claim.example }).click();
                await frame.locator('#claim .btn-wizard-nav-next').click();
                // The fill line settles once both engines have answered, or the read failed. At the
                // frame's width the page folds its rail away, so the line is attached but not shown.
                await frame.locator('[data-activity] li:not(.is-running)', { hasText: /Filled|Found no other details|Could not read/ }).first().waitFor({ state: 'attached' });
                // Steps follow the decisions as the page applies them; give the rail a moment to catch up.
                let titles = [];
                for (let tries = 0; tries < 30; tries++) {
                    titles = await frame.locator('[data-steps] .step-title').allTextContents();
                    if (claim.steps.every((step) => titles.includes(step)) && !(await frame.locator('[data-activity] li.is-running').count())) break;
                    await page.waitForTimeout(1000);
                }
                const activity = await frame.locator('[data-activity] li').allTextContents();
                const debug = JSON.stringify({ titles, activity });
                expect(titles, debug).to.include.members(claim.steps);
                expect(titles.filter((title) => claim.absent.includes(title)), debug).to.deep.equal([]);
                // JEV and Claude both answered, through the engine server, and the flow log says so.
                const runs = await flowLog(page);
                const text = runs.filter((run) => run.title.startsWith('/agent/extract')).map((run) => run.text).join('\n');
                expect(text, JSON.stringify(runs)).to.match(/engines: .*jev/).and.match(/claude/);
                expect(page.errors).to.deep.equal([]);
            });
        }
    });

    describe('the AI Document lease review, in a browser', function () {
        let browser;

        before(async function () {
            browser = await launchBrowser(this);
        });

        after(async function () {
            if (browser) await browser.close();
        });

        it('copies, summarizes and translates an uploaded lease, and saves the review through the UAG', async function () {
            const page = await browser.page();
            page.setDefaultTimeout(240000);
            const frame = await startExample(page, 'documents', { site: SITE });
            const lease = path.join(repoRoot, 'demo/public/apps/documents/samples/lease.pdf');
            // Each AI Document has its own upload, as a person drops the lease on each.
            for (const key of ['leaseClauses', 'leaseSummary', 'leaseTranslation']) {
                const browse = frame.locator(`.formio-component-${key}`).first().getByText('Browse Files');
                await browse.scrollIntoViewIfNeeded();
                const [chooser] = await Promise.all([page.waitForEvent('filechooser'), browse.click()]);
                await chooser.setFiles(lease);
            }
            // Each settles as written, or flagged for a person to check, once the UAG has processed it.
            const settled = frame.locator('[data-activity] li.is-ok, [data-activity] li.is-warn');
            for (let tries = 0; tries < 240 && await settled.count() < 3; tries++) {
                if (await frame.locator('[data-activity] li.is-error').count()) break;
                await page.waitForTimeout(1000);
            }
            const activity = await frame.locator('[data-activity] li').allTextContents();
            expect(await settled.count(), JSON.stringify(activity)).to.equal(3);
            expect(activity.join(' '), JSON.stringify(activity)).to.include('Key clauses').and.include('Summary').and.include('Translation');
            // Each upload is one document/process call on the UAG, and the flow log names the engine.
            const runs = await flowLog(page);
            const processed = runs.filter((run) => run.text.includes('/document/process'));
            expect(processed.length, JSON.stringify(runs.map((run) => run.title))).to.be.at.least(3);
            expect(processed.map((run) => run.text).join('\n'), processed.map((run) => run.text).join('\n---\n')).to.match(/claude/);
            // The reviewer's own fields, checked, and saved through the UAG as the guest.
            await frame.locator('input[name="data[property]"]').fill('Unit 4B, 210 Harbor Street');
            await frame.locator('input[name="data[reviewer]"]').fill('Dana Reyes');
            await frame.locator('input[name="data[checked]"]').check();
            await frame.locator('button', { hasText: 'Save the review' }).first().click();
            await frame.locator('[data-confirmation]:not([hidden])').waitFor({ timeout: 60000 });
            const saved = JSON.parse(await frame.locator('[data-saved]').innerText());
            // The clauses, copied into the review's own field.
            const clauses = String(saved.keyClauses || '').replace(/<[^>]+>/g, ' ');
            expect(clauses.split(/\s+/).filter(Boolean).length, JSON.stringify(saved).slice(0, 2000)).to.be.greaterThan(20);
            expect(saved.leaseSummary?.result || saved.leaseSummary, JSON.stringify(saved).slice(0, 2000)).to.be.ok;
            expect(page.errors).to.deep.equal([]);
        });
    });
});
