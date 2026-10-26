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
const REQUIRED = ['E2E_FORMIO_LICENSE', 'CLAUDE_API_KEY', 'TYPESAFE_API_KEY'];
const UAG_LICENSE = process.env.E2E_DEMO_UAG_LICENSE || process.env.E2E_EXAMPLE_UAG_LICENSE;

/**
 * Layer 3: the demo site as it ships, self-hosted. Its own docker-compose.yml
 * with docker-compose.enterprise.yml (Enterprise Form.io, the setup job, the
 * UAG built from this tree, the engine server with JEV and Claude, the flow
 * proxy and the site) runs under its own Compose project name, with an override that changes only the published ports, the
 * UAG's image, and the name the UAG reaches the project by: the Form.io
 * service gets the alias `formio.e2e.test`, the endpoint the test license
 * allows, and the UAG loads the project by its ID URL there (Enterprise
 * Form.io reads a dotted host as a project subdomain). Everything is driven
 * through the site, as a visitor would: a real conversation, real webhooks and
 * engines settling two applicants, and the claims wizard triaged in a browser.
 * This is the release check for the demo; it is skipped unless
 * E2E_FORMIO_LICENSE, E2E_DEMO_UAG_LICENSE (or E2E_EXAMPLE_UAG_LICENSE),
 * CLAUDE_API_KEY and TYPESAFE_API_KEY are set.
 */
describe('Layer 3: the demo site, as it ships', function () {
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
        stack = await exampleStack({
            project: PROJECT,
            dir: path.join(repoRoot, 'demo'),
            files: ['docker-compose.enterprise.yml'],
            env: {
                LICENSE_KEY: process.env.E2E_FORMIO_LICENSE,
                LICENSE_REMOTE: process.env.E2E_FORMIO_LICENSE_REMOTE || '',
                ADMIN_EMAIL: 'admin@example.com',
                ADMIN_PASS: secret(),
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
                '    environment:',
                '      PROJECT: ${E2E_PROJECT_URL:-http://api-server:3000/demo}',
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
        const { _id: projectId } = await (await fetch(`${FORMIO}/demo`, { headers: { 'x-token': projectKey } })).json();
        expect(projectId, 'the setup job created no project').to.be.a('string');
        await fs.appendFile(stack.envFile, `E2E_PROJECT_URL='http://formio.e2e.test:3000/project/${projectId}'\n`);
        await stack.compose('up', '-d');
        // Up once the site sees the demo's forms through the UAG.
        await waitUntil(async () => {
            const { status, body } = await site('/api/conversation/forms');
            if (status !== 200 || !body.forms.some((form) => form.name === 'serviceRequest')) throw new Error(`forms: ${JSON.stringify(body)}`);
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
            out.resourceMetadata = (await fetch(metadataUrl.replace(process.env.BASE_URL, base))).status;
            const server = await fetch(base + '/.well-known/oauth-authorization-server');
            out.authorizationServer = server.status;
            if (server.ok) {
                const meta = await server.json();
                for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
                    const url = meta[key].replace(process.env.BASE_URL, base);
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
            'Yes, that is all correct. Please submit it now.',
            'Yes, please submit it.',
            'Yes. Submit.',
        ];
        const transcript = [];
        const tools = new Set();
        let submission = null;
        for (const message of turns) {
            const { status, body } = await site('/api/conversation/chat', { method: 'POST', body: { message } });
            expect(status, JSON.stringify(body)).to.equal(200);
            transcript.push(`USER: ${message}`, `ASSISTANT: ${body.reply}`);
            body.tools.forEach((tool) => tools.add(tool.name));
            if (body.submission) {
                submission = body.submission;
                break;
            }
        }
        const debug = `${transcript.join('\n')}\nTools: ${[...tools].join(', ')}`;
        expect(submission, debug).to.not.equal(null);
        expect(submission.data, debug).to.include({ fullName: 'Marcus Webb', email: 'marcus.webb@example.com', category: 'internet', urgency: 'high' });
        expect(submission.data.serviceAddress, debug).to.include('12 Elm Street');
        expect([...tools], debug).to.include.members(['get_forms', 'get_form_fields', 'submit_completed_form']);
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
