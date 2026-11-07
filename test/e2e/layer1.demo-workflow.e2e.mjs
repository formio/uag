import { expect } from 'chai';
import { formio, requireLicense, UAG_URL } from './helpers/stack.mjs';
import { adminHeaders } from './helpers/agent.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { startDemoStack, guest, startExample, flowLog, SITE_URL } from './helpers/demoStack.mjs';
import { PROFILES, SCORE_FIELDS, settled } from '../../demo/module/applicants.mjs';

/**
 * Layer 1: the demo site's agentic workflow, on the e2e stack, on Form.io Open
 * Source. The demo's own project is installed as it ships (the application and
 * sum forms, their criteria and their "Agent: Run task" actions, and the guest
 * sign-in). Applications are saved through the UAG as a guest, as the page saves
 * them; both engines run on the real engine server package. The scripted agent
 * follows the criteria, so the weak, average and strong applicants always land
 * in the same bands. This checks the admissions task run after the save, the
 * finance task chained on its update, that the chain stops, that the agents'
 * fields are theirs alone, that a guest reads only their own applications, and
 * the page itself in a browser.
 */
describe('Layer 1: the demo site\'s agentic workflow', function () {
    this.timeout(300000);

    let stack;
    let applicant;

    before(async function () {
        requireLicense(this);
        // The runner's log, shown when a test fails.
        stack = await startDemoStack({ uagEnv: { DEBUG: 'formio:uag:runner' } });
        applicant = await guest();
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    /** Apply through the UAG as the guest, read it back until the workflow settles, and return the submission. */
    async function apply(profile) {
        const created = await applicant.json('/application/submission', { method: 'POST', body: { data: PROFILES[profile] } });
        expect(created.status, JSON.stringify(created.body)).to.equal(201);
        const id = created.body._id;
        const deadline = Date.now() + 60000;
        let read;
        do {
            await new Promise((resolve) => setTimeout(resolve, 500));
            read = await applicant.json(`/application/submission/${id}`);
            expect(read.status, JSON.stringify(read.body)).to.equal(200);
        } while (!settled(read.body.data) && Date.now() < deadline);
        return { id, read: read.body, stored: await formio.getSubmission('application', id) };
    }

    /** Wait until a submission has gone a while without changing. */
    async function quiet(id, ms = 5000) {
        let last = (await formio.getSubmission('application', id)).modified;
        for (;;) {
            await new Promise((resolve) => setTimeout(resolve, ms));
            const now = (await formio.getSubmission('application', id)).modified;
            if (now === last) return now;
            last = now;
        }
    }

    it('serves the application form to a guest, and the sample applicants with the site', async function () {
        const form = await applicant.json('/application');
        expect(form.status).to.equal(200);
        expect(form.body.name).to.equal('application');
        const profiles = await (await fetch(`${SITE_URL}/apps/workflow/applicants.json`)).json();
        expect(Object.keys(profiles)).to.have.members(['weak', 'average', 'strong']);
    });

    it('declines the weak applicant, and never asks the finance task', async function () {
        const { stored, read } = await apply('weak');
        expect(stored.data).to.include({ status: 'declined', decision: 'declined', overallScore: 3.3 });
        for (const field of SCORE_FIELDS) expect(stored.data[field], field).to.be.within(1, 10);
        expect(stored.data.agentRationale).to.be.a('string').and.not.equal('');
        expect(stored.data.awardLevel || '').to.equal('');
        expect(stored.data.financeRationale || '').to.equal('');
        // The guest reads what the agents left, through the UAG.
        expect(read.data).to.include({ status: 'declined', decision: 'declined' });
        expect(stored.owner).to.equal(applicant.user._id);
    });

    it('accepts the average applicant, and never asks the finance task', async function () {
        const { stored } = await apply('average');
        expect(stored.data).to.include({ status: 'accepted', decision: 'accepted', overallScore: 6.7 });
        expect(stored.data.awardLevel || '').to.equal('');
        expect(stored.data.financeRationale || '').to.equal('');
    });

    describe('the strong applicant', function () {
        let result;

        before(async function () {
            result = await apply('strong');
        });

        it('is accepted with a scholarship, and the finance task chained on that update awards one', async function () {
            expect(result.stored.data).to.include({
                status: 'scholarshipEvaluation',
                decision: 'acceptedWithScholarship',
                overallScore: 10,
                awardLevel: 'fullRide',
            });
            expect(result.stored.data.financeRationale).to.be.a('string').and.not.equal('');
            expect(result.stored.data).to.include({ firstName: 'Amara', gpa: PROFILES.strong.gpa, essay: PROFILES.strong.essay });
        });

        it('stops: nothing changes after a quiet period', async function () {
            const modified = await quiet(result.id);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            expect((await formio.getSubmission('application', result.id)).modified).to.equal(modified);
        });

        it('keeps the agents\' values when the submission is saved again through the UAG, and runs no task', async function () {
            const before = await formio.getSubmission('application', result.id);
            const response = await fetch(`${UAG_URL}/application/submission/${result.id}`, {
                method: 'PUT',
                headers: adminHeaders,
                body: JSON.stringify({ data: { ...before.data, decision: 'declined', awardLevel: 'none', overallScore: 1 } }),
            });
            expect(response.status, await response.clone().text()).to.equal(200);
            const modified = await quiet(result.id);
            const stored = await formio.getSubmission('application', result.id);
            expect(stored.data).to.include({ decision: 'acceptedWithScholarship', awardLevel: 'fullRide', overallScore: 10 });
            // The save itself, and no task after it: finance's condition no longer holds once an award is set.
            expect(stored.modified).to.equal(modified);
        });
    });

    it('keeps each guest to their own applications', async function () {
        const mine = await apply('average');
        const stranger = await guest();
        const read = await stranger.json(`/application/submission/${mine.id}`);
        expect(read.status, JSON.stringify(read.body)).to.be.oneOf([401, 403, 404]);
        expect(JSON.stringify(read.body)).to.not.include(PROFILES.average.essay.slice(0, 40));
        await quiet(mine.id);
    });

    it('takes only the applicant\'s own fields from the browser', async function () {
        const created = await applicant.json('/application/submission', {
            method: 'POST',
            body: { data: { ...PROFILES.weak, decision: 'acceptedWithScholarship', awardLevel: 'fullRide', status: 'scholarshipEvaluation' } },
        });
        expect(created.status).to.equal(201);
        const stored = await formio.getSubmission('application', created.body._id);
        expect(stored.data.decision || '').to.not.equal('acceptedWithScholarship');
        expect(stored.data.awardLevel || '').to.equal('');
        await quiet(created.body._id);
    });

    it('computes the sum smoke test, on a submission saved through the UAG', async function () {
        const response = await fetch(`${UAG_URL}/sum/submission`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ data: { a: 2, b: 3 } }) });
        expect(response.status).to.equal(201);
        const created = await response.json();
        const deadline = Date.now() + 60000;
        let stored = created;
        while (stored.data.sum === undefined && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            stored = await formio.getSubmission('sum', created._id);
        }
        expect(stored.data.sum).to.equal(5);
    });

    describe('the workflow page, in a browser', function () {
        let browser;

        before(async function () {
            browser = await launchBrowser(this);
        });

        after(async function () {
            if (browser) await browser.close();
        });

        it('submits a sample applicant as a guest, and shows each task as the page reads it back', async function () {
            const page = await browser.page();
            page.setDefaultTimeout(60000);
            const frame = await startExample(page, 'workflow');
            await frame.locator('.profile', { hasText: 'Amara' }).click();
            // The application is a wizard: Next to its last page, then Submit. Each Next is
            // followed by waiting for the page to change, so Submit is looked for on the new page.
            const app = page.frames().find((candidate) => candidate.url().includes('/apps/workflow/'));
            let submitted = false;
            for (let step = 0; step < 8 && !submitted; step++) {
                const submit = frame.locator('#application button', { hasText: /^\s*Submit/ });
                if (await submit.count()) {
                    await submit.last().click();
                    submitted = true;
                    break;
                }
                const before = await app.evaluate(() => document.querySelector('#application').innerText);
                await frame.locator('#application button', { hasText: /^\s*Next/ }).last().click();
                await app.waitForFunction((previous) => document.querySelector('#application').innerText !== previous, before);
            }
            expect(submitted, 'the wizard never showed Submit').to.equal(true);
            // At the frame's width the status view may lay the award out of view: attached is enough.
            await frame.locator('[data-finance]:not([hidden])').waitFor({ state: 'attached' }).catch(async (error) => {
                const runs = (await flowLog(page)).map((run) => `${run.title}: ${run.labels.join(', ')}`).join('\n');
                const log = stack.uag.getOutput().split('\n').filter((line) => /Run task|license/i.test(line)).slice(-10).join('\n');
                throw new Error(`${error.message.split('\n')[0]}\nThe flow log:\n${runs}\nThe UAG:\n${log}`);
            });
            const runs = await flowLog(page);
            const text = runs.map((run) => `${run.title}: ${run.text}`).join('\n');
            expect(text, text).to.include('Run task: admissions').and.include('Run task: finance');
            expect(runs.some((run) => run.title === 'Save through the UAG' && run.labels.some((label) => /^POST \/form\/\w+\/submission$/.test(label))), text).to.equal(true);
            expect(runs.some((run) => run.title === 'Read through the UAG'), text).to.equal(true);
            expect(await page.locator('[data-license-notice]').isVisible()).to.equal(false);
            expect(page.errors).to.deep.equal([]);
        });
    });
});
