import { expect } from 'chai';
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { PROFILES } from '../../demo/module/applicants.mjs';
import { IMAGE, buildLocalImage, exampleStack, repoRoot, waitUntil } from './helpers/exampleStack.mjs';
import { launchBrowser } from './helpers/browser.mjs';

const PROJECT = 'uag-e2e-demo';
const SITE = 'http://127.0.0.1:3430';
const FORMIO = 'http://127.0.0.1:3431';
/** The UAG, published so the suite can call it as a connected portal stage does. */
const UAG = 'http://127.0.0.1:3432';
const ADMIN_EMAIL = 'admin@example.com';
const REQUIRED = ['E2E_FORMIO_LICENSE', 'CLAUDE_API_KEY', 'TYPESAFE_API_KEY'];
const UAG_LICENSE = process.env.E2E_DEMO_UAG_LICENSE || process.env.E2E_EXAMPLE_UAG_LICENSE;

/**
 * Layer 3: the demo site as it ships, self-hosted. Its own docker-compose.yml
 * with docker-compose.enterprise.yml (Enterprise Form.io, the setup job) and
 * docker-compose.split.yml (the engine server with JEV and Claude, and the flow
 * proxy as its own service, so the viewer shows each engine call), the UAG
 * built from this tree and the site runs under its own Compose project name, with an override that changes only the published ports, the
 * UAG's image, and the name the UAG reaches the project by: the Form.io
 * service gets the alias `formio.e2e.test`, the endpoint the test license
 * allows, and the UAG loads the project by its ID URL there (Enterprise
 * Form.io reads a dotted host as a project subdomain). Everything is driven
 * through the site, as a visitor would: a real conversation (the UAG's agent/chat), real Run task actions and
 * engines settling two applicants, and the claims wizard triaged in a browser.
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
    let cookie = '';

    async function site(pathname, { method = 'GET', body } = {}) {
        const response = await fetch(`${SITE}${pathname}`, {
            method,
            headers: { ...(cookie && { cookie }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = response.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        const text = await response.text();
        let json = null;
        try {
            json = JSON.parse(text);
        }
        catch {
            json = text;
        }
        return { status: response.status, body: json };
    }

    before(async function () {
        const missing = [...REQUIRED.filter((name) => !process.env[name]), ...(UAG_LICENSE ? [] : ['E2E_DEMO_UAG_LICENSE'])];
        if (missing.length) {
            console.log(`    Skipping: ${missing.join(', ')} not set.`);
            this.skip();
        }
        const secret = () => randomBytes(24).toString('hex');
        const projectKey = secret();
        key = projectKey;
        adminPass = secret();
        portalSecret = secret();
        stack = await exampleStack({
            project: PROJECT,
            dir: path.join(repoRoot, 'demo'),
            files: ['docker-compose.enterprise.yml', 'docker-compose.split.yml'],
            env: {
                LICENSE_KEY: process.env.E2E_FORMIO_LICENSE,
                LICENSE_REMOTE: process.env.E2E_FORMIO_LICENSE_REMOTE || '',
                ADMIN_EMAIL,
                ADMIN_PASS: adminPass,
                DB_SECRET: secret(),
                FORMIO_JWT_SECRET: secret(),
                PROJECT_KEY: projectKey,
                UAG_LICENSE,
                UAG_JWT_SECRET: secret(),
                ENGINE_SERVER_KEY: secret(),
                TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
                CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
                FLOW_KEY: secret(),
                DEMO_SECRET: secret(),
                DEMO_PORT: '3430',
                DEMO_PUBLIC_URL: SITE,
                DEMO_DAILY_BUDGET: '0',
                DEMO_DAILY_NETWORK_BUDGET: '0',
                // The suite is a scripted visitor; Turnstile is tested on its own.
                DEMO_REQUIRE_TURNSTILE: 'false',
                UAG_IMAGE: IMAGE,
                DEMO_IMAGE: 'formio/uag-demo:e2e-local',
                ENGINES_IMAGE: 'formio/uag-engines:e2e-local',
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
                '    build: !reset null',
                '    pull_policy: never',
                // The UAG's own database, on Form.io's MongoDB: remote MCP sign-in and run records.
                '    networks: [default, db]',
                '    ports:',
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
                '  site:',
                '    ports: !override',
                `      - "127.0.0.1:${new URL(SITE).port}:8080"`,
                '',
            ].join('\n'),
        });

        await buildLocalImage();
        await stack.compose('build', 'setup', 'uag-engines');
        await stack.compose('up', '-d', '--wait', 'mongo', 'api-server');
        await stack.compose('run', '--rm', 'setup').catch(async (error) => {
            error.message += `\n${error.stdout || ''}${error.stderr || ''}\nForm.io:\n${await stack.logs('api-server', 40)}`;
            throw error;
        });
        ({ _id: projectId } = await (await fetch(`${FORMIO}/demo`, { headers: { 'x-token': projectKey } })).json());
        expect(projectId, 'the setup job created no project').to.be.a('string');
        await fs.appendFile(stack.envFile, `E2E_PROJECT_URL='http://formio.e2e.test:3000/project/${projectId}'\n`);
        await stack.compose('up', '-d');
        // Up once the site serves the chat's form.
        await waitUntil(async () => {
            const { status, body } = await site('/api/conversation/uag/service-request');
            if (status !== 200 || body?.name !== 'serviceRequest') throw new Error(`form: ${JSON.stringify(body)}`);
        }, { timeoutMs: 600000, describe: async () => `${await stack.logs('formio-uag')}\n${await stack.logs('site')}` });
    });

    after(async function () {
        if (stack) await stack.down();
    });

    it('serves every page', async function () {
        for (const pathname of ['/', '/getting-started', '/examples', '/examples/conversation', '/examples/workflow', '/examples/formflow', '/faq', '/contact', '/developers', '/developers/agent-api']) {
            const { status, body } = await site(pathname);
            expect(status, pathname).to.equal(200);
            expect(body, pathname).to.not.include('data-license-notice');
        }
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
        const form = await site('/api/conversation/uag/service-request');
        expect(form.status).to.equal(200);
        const chatPath = `/api/conversation/uag/form/${form.body._id}/agent/chat`;
        const messages = [];
        const transcript = [];
        let data = {};
        let last = null;
        for (const message of turns) {
            messages.push({ role: 'user', content: message });
            const { status, body } = await site(chatPath, { method: 'POST', body: { messages, data } });
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
        // The page then submits the form, through the UAG.
        const saved = await site(`/api/conversation/uag/form/${form.body._id}/submission`, { method: 'POST', body: { data } });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(201);
        expect(saved.body.data).to.include({ fullName: 'Marcus Webb' });
    });

    it('declines the weak applicant, awards the strong one, and then stops', async function () {
        async function apply(profile) {
            const { status, body } = await site('/api/workflow/applications', { method: 'POST', body: { data: PROFILES[profile] } });
            expect(status, JSON.stringify(body)).to.equal(201);
            const deadline = Date.now() + 300000;
            let read;
            do {
                await new Promise((resolve) => setTimeout(resolve, 5000));
                read = await site(`/api/workflow/applications/${body.id}`);
            } while (!read.body.settled && Date.now() < deadline);
            if (!read.body.settled) throw new Error(`The ${profile} applicant did not settle: ${JSON.stringify(read.body)}\n${await stack.logs('formio-uag')}`);
            return read.body;
        }
        const [weak, strong] = await Promise.all([apply('weak'), apply('strong')]);
        expect(weak.result).to.include({ status: 'declined', decision: 'declined' });
        expect(weak.result.awardLevel || '').to.equal('');
        expect(strong.result).to.include({ status: 'scholarshipEvaluation', decision: 'acceptedWithScholarship' });
        expect(strong.result.awardLevel).to.be.oneOf(['fullRide', 'roomBoard25', 'supplemental25', 'reward1000']);
        expect(strong.result.financeRationale).to.be.a('string').and.not.equal('');

        // The finance task's own save must not start another round.
        await new Promise((resolve) => setTimeout(resolve, 30000));
        expect((await site(`/api/workflow/applications/${weak.id}`)).body.modified).to.equal(weak.modified);
        expect((await site(`/api/workflow/applications/${strong.id}`)).body.modified).to.equal(strong.modified);
    });

    it('lists each agent run in Action Logs, beside Form.io\'s own entries', async function () {
        const form = await (await fetch(`${FORMIO}/demo/application`, { headers: { 'x-token': key } })).json();
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
            const admin = await login(ADMIN_EMAIL, adminPass);
            expect(admin, 'the portal administrator could not sign in').to.be.a('string');
            // Connect the project to the UAG as a remote environment: Form.io signs its
            // members' remote tokens with the secret the UAG verifies them with.
            const project = (await formio('GET', `/project/${projectId}`, { token: admin })).body;
            const teams = {};
            for (const [name, permission] of [['writer', 'team_write'], ['reader', 'team_read']]) {
                const email = `${name}@example.com`;
                const password = randomBytes(12).toString('hex');
                const created = await formio('POST', '/formio/user/submission', { token: admin, body: { data: { name, email, password } } });
                expect(created.status, JSON.stringify(created.body)).to.equal(201);
                const team = await formio('POST', '/team', { token: admin, body: { data: { name: `${name}s` } } });
                expect(team.status, JSON.stringify(team.body)).to.equal(201);
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
            it(`triages "${claim.example}" and adds its steps, with every leg in the flow viewer`, async function () {
                const page = await browser.page();
                page.setDefaultTimeout(120000);
                await page.goto(`${SITE}/examples/formflow`);
                const frame = page.frameLocator('iframe[data-demo-frame]');
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
                // JEV and Claude both answered through the engine server, and the viewer shows it.
                const labels = await page.locator('[data-flow] .flow-label').allTextContents();
                expect(labels.some((label) => /^jev decide$/.test(label)), labels.join(', ')).to.equal(true);
                expect(labels.some((label) => /^claude extract$/.test(label)), labels.join(', ')).to.equal(true);
                expect(page.errors).to.deep.equal([]);
            });
        }
    });
});
