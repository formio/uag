import { expect } from 'chai';
import { launchBrowser } from './helpers/browser.mjs';
import { startDemoStack, guest, startExample } from './helpers/demoStack.mjs';

/**
 * Layer 1: the demo site against a Form.io Open Source server and an unlicensed
 * UAG, on this machine. Conversation forms need no license, so the chat (the
 * UAG's agent/chat, answered by the scripted agent engine) works; Agentic
 * Formflow (the workflow, formflow and AI Document demos) needs a license that
 * includes the UAG or a project on Form.io's hosted service, so the UAG refuses
 * it, and the pages say so, with what a local run needs, instead of failing
 * part way. No credentials needed.
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

    it('keeps conversation forms working: the form\'s chat needs no license', async function () {
        const visitor = await guest();
        const form = await visitor.json('/service-request');
        expect(form.status).to.equal(200);
        const { status, body } = await visitor.json(`/form/${form.body._id}/agent/chat`, {
            method: 'POST',
            body: { messages: [{ role: 'user', content: 'Full Name: Marcus Webb' }], data: {} },
        });
        expect(status, JSON.stringify(body)).to.equal(200);
        expect(body.patch).to.deep.equal({ fullName: 'Marcus Webb' });
        expect(body.reply).to.match(/^RECORDED fullName/);
    });

    it('refuses the Agent API the formflow demo calls', async function () {
        const visitor = await guest();
        const form = await visitor.json('/claim');
        expect(form.status).to.equal(200);
        const { status, body } = await visitor.json(`/form/${form.body._id}/agent/extract`, { method: 'POST', body: { data: { lossDescription: 'My car was stolen.' } } });
        expect(status).to.equal(403);
        expect(body.code).to.equal('license_required');
    });

    it('says the formflow demo is not supported without a license or SaaS project, with what a local run needs', async function () {
        const page = await browser.page();
        const frame = await startExample(page, 'formflow');
        await frame.locator('#examples button', { hasText: 'Car stolen' }).click();
        await frame.locator('#claim .btn-wizard-nav-next').click();
        const panel = page.locator('[data-demo-unsupported]');
        await panel.waitFor();
        expect(await panel.locator('h3').textContent()).to.equal('Not supported without a license or SaaS project');
        expect(await page.locator('iframe[data-demo-frame]').isVisible()).to.equal(false);
        await page.locator('[data-license-notice]').waitFor();
        expect(await page.locator('[data-license-notice]').textContent()).to.include('the UAG needs a license that includes the UAG');
        expect(page.errors).to.deep.equal([]);
    });

    it('keeps the conversation demo page live, with no notice', async function () {
        const page = await browser.page();
        const frame = await startExample(page, 'conversation');
        await frame.locator('.uag-chat__message--assistant', { hasText: 'I can open a service request' }).waitFor();
        expect(await page.locator('[data-demo-unsupported]').count()).to.equal(0);
        expect(await page.locator('[data-license-notice]').isVisible()).to.equal(false);
    });
});
