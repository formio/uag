import { expect } from 'chai';
import { requireLicense } from './helpers/stack.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { startDemoStack, startExample, flowLog } from './helpers/demoStack.mjs';

/**
 * Layer 1: the demo site's AI Document example (the Harbor Lane lease review)
 * in a browser, on the e2e stack, whose UAG has no AI Document module (the
 * formio/uag-documents add-on is not installed). The page loads the lease
 * review form from the project as a guest, and says that the AI Document
 * process is not installed, instead of an upload that does nothing. The upload
 * itself, with the add-on and real engines, is in layer3.demo-stack.
 */
describe('Layer 1: the demo site\'s AI Document example, without the add-on', function () {
    this.timeout(300000);

    let stack;
    let browser;

    before(async function () {
        requireLicense(this);
        browser = await launchBrowser(this);
        stack = await startDemoStack();
    });

    after(async function () {
        if (stack) await stack.stop();
        if (browser) await browser.close();
    });

    it('loads the lease review as a guest, and says the AI Document process is not installed', async function () {
        const page = await browser.page();
        page.setDefaultTimeout(30000);
        const app = await startExample(page, 'documents');
        await app.locator('.formio-component-file').first().waitFor();
        const notice = app.locator('[data-activity] li.is-error');
        await notice.waitFor();
        expect(await notice.innerText()).to.include('does not have the AI Document process installed');
        const runs = await flowLog(page);
        expect(runs.map((run) => run.title)).to.include.members(['Guest sign-in']);
        expect(runs.some((run) => run.text.includes('lease-review'))).to.equal(true);
    });
});
