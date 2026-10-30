/**
 * The demo, self-hosted on Form.io Enterprise with its portal, for the
 * recordings that show the Enterprise form builder and project settings.
 *
 * It is the stack the layer 3 demo suite runs (test/e2e/layer3.demo-stack):
 * the demo's own docker-compose.yml with docker-compose.enterprise.yml and
 * docker-compose.split.yml, the UAG built from this tree, and the engine server
 * with JEV and Claude, plus
 * PORTAL_ENABLED=1. Needs E2E_FORMIO_LICENSE (a Form.io Enterprise
 * license), E2E_DEMO_UAG_LICENSE or E2E_EXAMPLE_UAG_LICENSE (one that includes
 * the UAG for formio.e2e.test), CLAUDE_API_KEY and TYPESAFE_API_KEY.
 *
 * After it starts, a portal stage, "UAG Gateway", is connected to the UAG as an
 * on-premise environment (the UAG's PORTAL_SECRET), so the portal can open the
 * UAG's own actions, such as "Agent: Run task". E2E_LOCAL_CORE and
 * E2E_LOCAL_APPSERVER, as for the layer 3 suite, build the UAG against
 * unpublished local builds of @formio/appserver-core and @formio/appserver.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { IMAGE, buildLocalImage, exampleStack, repoRoot, waitUntil } from '../../test/e2e/helpers/exampleStack.mjs';

export const SITE = 'http://127.0.0.1:3430';
export const PORTAL = 'http://127.0.0.1:3431';
/** The UAG, published so the portal can connect a stage to it as a remote environment. */
export const UAG = 'http://127.0.0.1:3432';
/** The portal administrator, unless `ADMIN_EMAIL` says otherwise. */
export const ADMIN_EMAIL = 'admin@example.com';

/**
 * The licenses: Form.io Enterprise's (`LICENSE_KEY`), and the UAG's, which must
 * include the UAG and allow the endpoint formio.e2e.test, the name the UAG
 * reaches Form.io by in the stack (`UAG_LICENSE`, else `LICENSE_KEY`). The
 * e2e suites' names still work: E2E_FORMIO_LICENSE, E2E_DEMO_UAG_LICENSE and
 * E2E_EXAMPLE_UAG_LICENSE.
 */
export function enterpriseLicenses(settings = process.env) {
    return {
        formio: settings.LICENSE_KEY || settings.E2E_FORMIO_LICENSE || '',
        uag: settings.UAG_LICENSE || settings.E2E_DEMO_UAG_LICENSE || settings.E2E_EXAMPLE_UAG_LICENSE || settings.LICENSE_KEY || '',
    };
}

export function enterpriseMissing(settings = process.env) {
    const missing = ['CLAUDE_API_KEY', 'TYPESAFE_API_KEY'].filter((name) => !settings[name]);
    if (!enterpriseLicenses(settings).formio) missing.unshift('LICENSE_KEY');
    return missing;
}

/**
 * The deployment's own settings, by the names demo/.env.example gives them.
 * Each is taken from `settings` when set there, and is otherwise random for
 * this start.
 */
export const DEPLOYMENT_SETTINGS = ['ADMIN_PASS', 'FORMIO_ADMIN_KEY', 'PROJECT_KEY', 'DB_SECRET', 'FORMIO_JWT_SECRET', 'UAG_JWT_SECRET', 'PORTAL_SECRET', 'ENGINE_SERVER_KEY', 'FLOW_KEY', 'DEMO_SECRET'];

/**
 * Starts the stack. `site`, `portal` and `uag` are the URLs it is published at
 * (on 127.0.0.1), and `project` is the Compose project name, so stacks on
 * different ports do not collide. `connectStage: false` leaves connecting the
 * portal stage (connectUagStage) to the caller. `settings` holds the licenses,
 * the model keys and any of DEPLOYMENT_SETTINGS and ADMIN_EMAIL to use; the
 * result lists the deployment settings that were generated (`generated`).
 */
export async function startEnterpriseDemo({ site = SITE, portal = PORTAL, uag = UAG, project = 'uag-recordings', connectStage = true, settings = process.env } = {}) {
    const secret = () => randomBytes(24).toString('hex');
    const generated = [];
    const deployment = Object.fromEntries(DEPLOYMENT_SETTINGS.map((name) => {
        if (settings[name]) return [name, String(settings[name])];
        generated.push(name);
        return [name, secret()];
    }));
    const adminEmail = settings.ADMIN_EMAIL || ADMIN_EMAIL;
    const projectKey = deployment.PROJECT_KEY;
    const adminPass = deployment.ADMIN_PASS;
    const portalSecret = deployment.PORTAL_SECRET;
    const licenses = enterpriseLicenses(settings);
    const stack = await exampleStack({
        project,
        dir: path.join(repoRoot, 'demo'),
        files: ['docker-compose.enterprise.yml', 'docker-compose.split.yml'],
        env: {
            LICENSE_KEY: licenses.formio,
            LICENSE_REMOTE: settings.LICENSE_REMOTE || settings.E2E_FORMIO_LICENSE_REMOTE || '',
            PORTAL_ENABLED: 'true',
            ADMIN_EMAIL: adminEmail,
            UAG_LICENSE: licenses.uag,
            TYPESAFE_API_KEY: settings.TYPESAFE_API_KEY,
            CLAUDE_API_KEY: settings.CLAUDE_API_KEY,
            ...(settings.CLAUDE_MODEL && { CLAUDE_MODEL: settings.CLAUDE_MODEL }),
            ...deployment,
            DEMO_PORT: new URL(site).port,
            DEMO_PUBLIC_URL: site,
            DEMO_DAILY_BUDGET: '0',
            DEMO_DAILY_NETWORK_BUDGET: '0',
            DEMO_REQUIRE_TURNSTILE: 'false',
            UAG_IMAGE: IMAGE,
            DEMO_IMAGE: 'formio/uag-demo:e2e-local',
            ENGINES_IMAGE: 'formio/uag-engines:e2e-local',
        },
        override: [
            'services:',
            '  api-server:',
            '    ports: !override',
            `      - "127.0.0.1:${new URL(portal).port}:3000"`,
            '    networks:',
            '      default:',
            '        aliases: [formio.e2e.test]',
            '  formio-uag:',
            '    build: !reset null',
            '    pull_policy: never',
            '    ports:',
            `      - "127.0.0.1:${new URL(uag).port}:3200"`,
            '    environment:',
            '      PROJECT: ${E2E_PROJECT_URL:-http://api-server:3000/demo}',
            `      PORTAL_SECRET: ${portalSecret}`,
            ...(process.env.E2E_CORE_BUNDLE ? [
                '    volumes:',
                `      - ${path.resolve(process.env.E2E_CORE_BUNDLE)}:/app/node_modules/@formio/appserver-core/server.js:ro`,
            ] : []),
            '  site:',
            '    ports: !override',
            `      - "127.0.0.1:${new URL(site).port}:8080"`,
            '',
        ].join('\n'),
    });
    try {
        await buildLocalImage();
        await stack.compose('build', 'setup', 'uag-engines');
        await stack.compose('up', '-d', '--wait', 'mongo', 'api-server');
        await stack.compose('run', '--rm', 'setup');
        const { _id: projectId } = await (await fetch(`${portal}/demo`, { headers: { 'x-token': projectKey } })).json();
        if (!projectId) throw new Error('The setup job created no project.');
        // The test license allows the UAG on formio.e2e.test; Enterprise reads a
        // dotted host as a project subdomain, so the UAG uses the project's ID URL.
        await fs.appendFile(stack.envFile, `E2E_PROJECT_URL='http://formio.e2e.test:3000/project/${projectId}'\n`);
        await stack.compose('up', '-d');
        await waitUntil(async () => {
            const response = await fetch(`${site}/api/conversation/uag/service-request`);
            const body = response.ok ? await response.json() : null;
            if (body?.name !== 'serviceRequest') throw new Error(`form: ${JSON.stringify(body)}`);
        }, { timeoutMs: 600000, describe: async () => `${await stack.logs('formio-uag')}\n${await stack.logs('site')}` });
    }
    catch (error) {
        await stack.down();
        throw error;
    }
    const env = { site, portal, uag, portalSecret, projectKey, email: adminEmail, password: adminPass, generated, stop: () => stack.down() };
    if (!connectStage) return env;
    try {
        env.uagStage = await connectUagStage(env);
    }
    catch (error) {
        await stack.down();
        throw error;
    }
    return env;
}

/**
 * Create a stage of the demo project and connect it to the UAG, as a person
 * would in the portal: Staging, Connect to an On-Premise Environment, the
 * UAG's root URL and PORTAL_SECRET, subdirectory paths, and the UAG's project.
 * Resolves to the stage's project id.
 */
export async function connectUagStage(env, { title = 'UAG Gateway', project = 'UAG Demo' } = {}) {
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
        await page.goto(env.portal, { waitUntil: 'networkidle' });
        await page.fill('input[name="data[email]"]', env.email);
        await page.fill('input[name="data[password]"]', env.password);
        await page.click('button:has-text("LOG IN")');
        await page.getByText(project, { exact: true }).first().click();
        await page.getByText('New Form').first().waitFor();
        await page.locator('text=Stage: Live').first().click();
        await page.locator('text=+ Create Stage').first().click();
        await page.selectOption('select[name=copyFrom]', { index: 1 });
        await page.fill('input[name=title]', title);
        await page.fill('input[name=name]', title.toLowerCase().replace(/[^a-z0-9]/g, ''));
        const live = /#\/project\/([0-9a-f]{24})/.exec(page.url())?.[1];
        await page.locator('button, .btn', { hasText: 'Add Stage' }).first().click();
        // The portal moves to the new stage's forms.
        await page.waitForURL((url) => {
            const id = /#\/project\/([0-9a-f]{24})/.exec(url.hash ? url.hash : String(url))?.[1];
            return Boolean(id && id !== live);
        });
        const stage = /#\/project\/([0-9a-f]{24})/.exec(page.url())[1];
        await page.waitForLoadState('networkidle');
        await page.locator('a', { hasText: /^\s*Staging\s*$/ }).first().click();
        await page.locator('#serverURL').waitFor();
        // The portal may open a dialog for the new stage; close it.
        for (const close of await page.locator('.ngdialog .ngdialog-close').all()) await close.click().catch(() => {});
        await page.locator('.ngdialog').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        await page.fill('#serverURL', env.uag);
        await page.fill('#portalSecret', env.portalSecret);
        await page.selectOption('#projectPaths', { label: 'Subdirectories' });
        await page.locator('.btn', { hasText: 'Continue' }).first().click();
        await page.locator('.ui-select-container').first().click();
        await page.locator('.ui-select-choices-row', { hasText: `${project} (` }).first().click();
        await page.locator('.btn', { hasText: 'Connect Stage' }).first().click();
        await page.getByText('Disconnect').first().waitFor();
        return stage;
    }
    catch (error) {
        const shot = path.join(os.tmpdir(), 'uag-recordings', 'stage-failure.png');
        await browser.contexts()[0]?.pages()[0]?.screenshot({ path: shot }).catch(() => {});
        error.message += `\nThe portal at the failure: ${shot}`;
        throw error;
    }
    finally {
        await browser.close();
    }
}
