import { expect } from 'chai';
import { formio, requireLicense } from './helpers/stack.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { startDemoStack, SITE_URL } from './helpers/demoStack.mjs';

const APP_URL = `${SITE_URL}/apps/formflow/`;

/**
 * Layer 1: the demo site's Agentic Formflow (the Lantern Mutual claims wizard)
 * in a browser. The site serves the page and the renderer plugin from
 * ./renderer, and relays to the e2e stack, whose template is the demo's own;
 * both engines run on the engine server, through the flow proxy. The scripted
 * engines read claim descriptions by keyword, so the page's own "Try an
 * example" buttons lead to known triage. This checks what a policyholder sees:
 * what the rail says triage decided, the steps it added and why, the fields
 * filled from the description and marked as such, values the user typed kept
 * when the description is read again, and the claim saved at the end, through
 * the UAG, so its agentDecide action re-decides triage on the server. And it
 * checks the example page around the wizard, with the flow viewer beside it.
 */
describe('Layer 1: the demo site\'s Agentic Formflow, in a browser', function () {
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

    /** Opens the page and fills the description with one of its examples. */
    async function start(example) {
        const page = await browser.page();
        page.setDefaultTimeout(30000);
        // Extraction requests the page makes through the app's relay.
        page.extracts = 0;
        page.on('request', (request) => {
            if (request.url().endsWith('/api/formflow/agent/extract')) page.extracts++;
        });
        await page.goto(APP_URL);
        await page.locator('#examples button', { hasText: example }).click();
        return page;
    }

    const field = (page, key) => page.locator(`[name="data[${key}]"]`);
    const activity = (page, text) => page.locator('[data-activity] li', { hasText: text });
    const title = (page) => page.locator('[data-page-title]').textContent();

    /** Continue to the next step, which must be `expected`. */
    async function next(page, expected) {
        await page.locator('#claim .btn-wizard-nav-next').click();
        try {
            await page.locator('[data-page-title]', { hasText: expected }).waitFor();
        }
        catch (error) {
            const errors = await page.locator('#claim .formio-errors').allTextContents();
            throw new Error(`Expected the "${expected}" step, still on "${await title(page)}": ${errors.join(' ').trim()}\n${stack.site.getOutput().slice(-2000)}`);
        }
    }

    async function steps(page) {
        return page.locator('[data-steps] .step-button').evaluateAll((buttons) => buttons.map((button) => ({
            title: button.querySelector('.step-title').textContent,
            reason: button.querySelector('.step-reason')?.textContent || '',
        })));
    }

    const isFilledByAgent = (page, key) => page.locator(`#claim .formio-component-${key}`).first()
        .evaluate((element) => element.classList.contains('is-agent-filled'));

    it('reads a collision with an injury, adds its steps, fills what it can, and saves the claim', async function () {
        const page = await start('Rear-ended, neck pain');
        expect(await field(page, 'policyNumber').inputValue()).to.equal('AUTO-2048-1173');

        await next(page, 'When and where');
        await activity(page, 'Sorted as an auto collision').waitFor();
        await activity(page, /Filled \d+ details? for you to check/).waitFor();
        expect(await steps(page)).to.deep.include.members([
            { title: 'Your vehicle', reason: 'You described a collision' },
            { title: 'Injuries', reason: 'You mentioned someone was hurt' },
            { title: 'Other people involved', reason: 'Someone else was involved' },
            { title: 'Police report', reason: 'Injury claims need a police report' },
        ]);
        expect((await steps(page)).map((step) => step.title).filter((title) => ['Check our understanding', 'What was stolen', 'Your home'].includes(title))).to.deep.equal([]);
        expect(await isFilledByAgent(page, 'lossDate')).to.equal(true);
        await field(page, 'lossLocation').fill('Main St and 4th Ave, Springfield');

        // The vehicle step was hidden at first, so it is filled by the follow-up request.
        await next(page, 'Your vehicle');
        await activity(page, /on the steps we added/).waitFor();
        expect(await field(page, 'vehicle').inputValue()).to.equal('2019 Honda Civic');
        expect(await isFilledByAgent(page, 'vehicle')).to.equal(true);

        // The policyholder corrects the vehicle, then changes the description:
        // everything is read again, but what they typed is kept.
        await field(page, 'vehicle').fill('2019 Honda Civic EX');
        await page.locator('[data-steps] .step-button', { hasText: 'What happened' }).click();
        await page.locator('[data-page-title]', { hasText: 'What happened' }).waitFor();
        const extracts = page.extracts;
        await field(page, 'lossDescription').fill(`${await field(page, 'lossDescription').inputValue()} I have photos of the damage.`);
        await next(page, 'When and where');
        await activity(page, 'Sorted as an auto collision').waitFor();
        expect(page.extracts, 'the changed description was not read again').to.be.greaterThan(extracts);
        expect(await field(page, 'lossLocation').inputValue()).to.equal('Main St and 4th Ave, Springfield');

        await next(page, 'Your vehicle');
        expect(await field(page, 'vehicle').inputValue()).to.equal('2019 Honda Civic EX');
        expect(await isFilledByAgent(page, 'vehicle')).to.equal(false);
        await next(page, 'Injuries');
        await next(page, 'Other people involved');
        expect(await field(page, 'otherPartyName').inputValue()).to.equal('Mark Jensen');
        expect(await isFilledByAgent(page, 'otherPartyName')).to.equal(true);
        await next(page, 'Police report');
        await field(page, 'policeReportNumber').fill('24-118803');
        await next(page, 'Photos');
        await next(page, 'How we\'ll reach you');
        await field(page, 'contactName').fill('Dana Whitfield');
        await field(page, 'contactPhone').pressSequentially('5125550142');
        await next(page, 'Review and submit');
        await page.locator('[data-claim-summary] .from-description').first().waitFor();
        await field(page, 'attestation').check();
        await page.locator('#claim .btn-wizard-nav-submit').click();

        await page.locator('[data-confirmation]').waitFor({ state: 'visible' });
        expect(await page.locator('[data-claim-number]').textContent()).to.match(/^LM-\d{4}-[A-Z0-9]{6}$/);
        expect(page.errors).to.deep.equal([]);

        const [claim] = await formio.getSubmissions('claim', '&data.policyNumber=AUTO-2048-1173');
        expect(claim, 'the claim was not saved').to.exist;
        expect(claim.data.triage).to.include({ claimType: 'autoCollision', injuryInvolved: true, thirdPartyInvolved: true });
        expect(claim.data).to.include({ vehicle: '2019 Honda Civic EX', otherPartyName: 'Mark Jensen', lossLocation: 'Main St and 4th Ave, Springfield', contactName: 'Dana Whitfield' });
        expect(claim._id.slice(-6).toUpperCase()).to.equal((await page.locator('[data-claim-number]').textContent()).slice(-6));
    });

    it('reads a stolen car as a theft, with the theft and police steps and no injury step', async function () {
        const page = await start('Car stolen');
        await next(page, 'When and where');
        await activity(page, 'Sorted as a theft').waitFor();
        const added = await steps(page);
        expect(added).to.deep.include.members([
            { title: 'What was stolen', reason: 'You said something was stolen' },
            { title: 'Police report', reason: 'Theft claims need a police report' },
        ]);
        expect(added.map((step) => step.title).filter((title) => ['Injuries', 'Your home'].includes(title))).to.deep.equal([]);
        expect(page.errors).to.deep.equal([]);
    });

    it('shows the extraction\'s legs in the flow viewer beside the wizard', async function () {
        const page = await browser.page();
        await page.goto(`${SITE_URL}/examples/formflow`);
        const frame = page.frameLocator('iframe[data-demo-frame]');
        await frame.locator('#examples button', { hasText: 'Cracked windshield' }).click();
        await frame.locator('#claim .btn-wizard-nav-next').click();
        const flow = page.locator('[data-flow]');
        await flow.locator('.flow-run-head', { hasText: '/agent/extract · triage' }).first().waitFor();
        await flow.locator('.flow-kind', { hasText: 'engine' }).first().waitFor();
        const labels = await flow.locator('.flow-label').allTextContents();
        expect(labels).to.include('/agent/extract');
        expect(labels.some((label) => /decide$/.test(label)), labels.join(', ')).to.equal(true);
        expect(page.errors).to.deep.equal([]);
    });
});
