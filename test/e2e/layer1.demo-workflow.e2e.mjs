import { expect } from 'chai';
import { formio, requireLicense, UAG_URL } from './helpers/stack.mjs';
import { adminHeaders } from './helpers/agent.mjs';
import { startDemoStack, visitor, SITE_URL } from './helpers/demoStack.mjs';
import { PROFILES, SCORE_FIELDS, settled } from '../../demo/module/applicants.mjs';

/**
 * Layer 1: the demo site's agentic workflow, on the e2e stack, on Form.io Open
 * Source. The demo's own project is installed as it ships (the application and
 * sum forms, their criteria and their "Agent: Run task" actions). Applications
 * are submitted through the site, as a visitor does, which saves them through
 * the UAG; both engines run on the real engine server package. The scripted
 * agent follows the criteria, so the weak, average and strong applicants always
 * land in the same bands. This checks the admissions task run after the save,
 * the finance task chained on its update, that the chain stops, that the
 * agents' fields are theirs alone, and that the flow viewer shows a visitor
 * every leg of their own runs and nothing of anyone else's.
 */
describe('Layer 1: the demo site\'s agentic workflow', function () {
    this.timeout(300000);

    let stack;
    const applicant = visitor();
    const stranger = visitor();

    before(async function () {
        requireLicense(this);
        stack = await startDemoStack();
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    /** Apply through the site, wait for the workflow to settle, and return the submission. */
    async function apply(profile) {
        const created = await applicant.json('/api/workflow/applications', { method: 'POST', body: { data: PROFILES[profile] } });
        expect(created.status, JSON.stringify(created.body)).to.equal(201);
        const id = created.body.id;
        const deadline = Date.now() + 60000;
        let read;
        do {
            await new Promise((resolve) => setTimeout(resolve, 500));
            read = await applicant.json(`/api/workflow/applications/${id}`);
            expect(read.status).to.equal(200);
        } while (!read.body.settled && Date.now() < deadline);
        return { id, read: read.body, stored: await formio.getSubmission('application', id) };
    }

    /** The engine calls a visitor's flow viewer shows, by the fields they asked about. */
    async function engineFields(who) {
        return (await who.flowEvents())
            .filter((event) => event.phase === 'request' && event.kind === 'engine' && event.summary)
            .map((event) => event.summary);
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

    it('shows no license notice: this UAG has a license', async function () {
        for (const pathname of ['/examples', '/examples/workflow']) {
            expect(await (await fetch(`${SITE_URL}${pathname}`)).text(), pathname).to.not.include('data-license-notice');
        }
    });

    it('serves the application form and the sample applicants', async function () {
        const form = await applicant.json('/api/workflow/form');
        expect(form.status).to.equal(200);
        expect(form.body.name).to.equal('application');
        const profiles = await applicant.json('/api/workflow/applicants');
        expect(Object.keys(profiles.body)).to.have.members(['weak', 'average', 'strong']);
    });

    it('declines the weak applicant, and never asks the finance task', async function () {
        const { stored, read } = await apply('weak');
        expect(stored.data).to.include({ status: 'declined', decision: 'declined', overallScore: 3.3 });
        for (const field of SCORE_FIELDS) expect(stored.data[field], field).to.be.within(1, 10);
        expect(stored.data.agentRationale).to.be.a('string').and.not.equal('');
        expect(stored.data.awardLevel || '').to.equal('');
        expect(stored.data.financeRationale || '').to.equal('');
        // The page reads what the agents left, through the site.
        expect(read.result).to.include({ status: 'declined', decision: 'declined' });
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

        it('shows the applicant every engine call of both tasks in the flow viewer', async function () {
            const fields = await engineFields(applicant);
            expect(fields.some((summary) => summary.includes('overallScore')), JSON.stringify(fields)).to.equal(true);
            expect(fields.some((summary) => summary.includes('awardLevel')), JSON.stringify(fields)).to.equal(true);
        });
    });

    it('keeps each visitor to their own applications and runs', async function () {
        const mine = await apply('average');
        const read = await stranger.json(`/api/workflow/applications/${mine.id}`);
        expect(read.status).to.equal(404);
        expect(await stranger.flowEvents()).to.deep.equal([]);
        await quiet(mine.id);
    });

    it('takes only the applicant\'s own fields from the browser', async function () {
        const created = await applicant.json('/api/workflow/applications', {
            method: 'POST',
            body: { data: { ...PROFILES.weak, decision: 'acceptedWithScholarship', awardLevel: 'fullRide', status: 'scholarshipEvaluation' } },
        });
        expect(created.status).to.equal(201);
        const stored = await formio.getSubmission('application', created.body.id);
        expect(stored.data.decision || '').to.not.equal('acceptedWithScholarship');
        expect(stored.data.awardLevel || '').to.equal('');
        await quiet(created.body.id);
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
});
