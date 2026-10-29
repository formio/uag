import { expect } from 'chai';
import { launchBrowser } from './helpers/browser.mjs';
import { startDemoStack, visitor, SITE_URL } from './helpers/demoStack.mjs';

/**
 * Layer 1: the demo site against a Form.io Open Source server and an unlicensed
 * UAG, on this machine. Conversation forms need no license, so the chat (the
 * UAG's agent/chat, answered by the scripted agent engine) works;
 * Agentic Formflow (the workflow and formflow demos) needs a UAG license or a
 * project on Form.io's hosted service, so those demos say so instead of
 * failing part way, and the Agent API refuses them. No credentials needed.
 */
describe('Layer 1: the demo site, Open Source and unlicensed', function () {
    this.timeout(300000);

    let stack;
    let browser;

    before(async function () {
        browser = await launchBrowser(this);
        stack = await startDemoStack({
            uagEnv: { UAG_LICENSE: '', LICENSE_KEY: '' },
        });
    });

    after(async function () {
        if (stack) await stack.stop();
        if (browser) await browser.close();
    });

    it('reports Agentic Formflow as not supported', async function () {
        const { body } = await visitor().json('/api/status');
        expect(body.formflow).to.deep.equal({ supported: false, reason: 'unlicensed', edition: 'open-source' });
    });

    it('says on every example page that a license is needed to run the demos locally', async function () {
        for (const pathname of ['/examples', '/examples/conversation', '/examples/workflow', '/examples/formflow']) {
            const html = await (await fetch(`${SITE_URL}${pathname}`)).text();
            expect(html, pathname).to.include('data-license-notice="unlicensed"').and.include('You need a UAG license to run these demos on your own machine.');
        }
    });

    it('keeps conversation forms working: the form\'s chat needs no license', async function () {
        const chat = visitor();
        const form = await chat.json('/api/conversation/uag/service-request');
        expect(form.status).to.equal(200);
        const { status, body } = await chat.json(`/api/conversation/uag/form/${form.body._id}/agent/chat`, {
            method: 'POST',
            body: { messages: [{ role: 'user', content: 'Full Name: Marcus Webb' }], data: {} },
        });
        expect(status, JSON.stringify(body)).to.equal(200);
        expect(body.patch).to.deep.equal({ fullName: 'Marcus Webb' });
        expect(body.reply).to.match(/^RECORDED fullName/);
    });

    it('refuses the Agent API the demos would call', async function () {
        const { status, body } = await visitor().json('/api/formflow/agent/extract', { method: 'POST', body: { data: { lossDescription: 'My car was stolen.' } } });
        expect(status).to.equal(403);
        expect(body.code).to.equal('license_required');
    });

    for (const [path, title] of [['/examples/workflow', 'Agentic Workflow'], ['/examples/formflow', 'Agentic Formflow']]) {
        it(`says "${title}" is not supported without a license or SaaS project, and loads no demo`, async function () {
            const page = await browser.page();
            await page.goto(`${SITE_URL}${path}`);
            const panel = page.locator('[data-demo-unsupported]');
            await panel.waitFor();
            expect(await panel.locator('h3').textContent()).to.equal('Not supported without a license or SaaS project');
            expect(await page.locator('iframe[data-demo-frame]').getAttribute('src')).to.equal(null);
            expect(page.errors).to.deep.equal([]);
        });
    }

    it('says so on the demo apps opened on their own, too', async function () {
        for (const app of ['/apps/workflow/', '/apps/formflow/']) {
            const page = await browser.page();
            await page.goto(`${SITE_URL}${app}`);
            await page.getByRole('alert').filter({ hasText: 'Not supported without a license or SaaS project' }).waitFor();
        }
    });

    it('keeps the conversation demo page live', async function () {
        const page = await browser.page();
        await page.goto(`${SITE_URL}/examples/conversation`);
        await page.frameLocator('iframe[data-demo-frame]').locator('.uag-chat__message--assistant', { hasText: 'I can open a service request' }).waitFor();
        expect(await page.locator('[data-demo-unsupported]').count()).to.equal(0);
    });
});
