import { expect } from 'chai';
import { formio, requireLicense } from './helpers/stack.mjs';
import { api } from './helpers/agent.mjs';
import { startDemoStack, visitor, SITE_URL } from './helpers/demoStack.mjs';
import { PROFILES, SCORE_FIELDS, settled } from '../../demo/module/applicants.mjs';

/**
 * Layer 1: the demo site's agentic workflow, on the e2e stack. The demo's own
 * project is installed as it ships (the application and sum forms, their
 * criteria and their three webhook actions); only the webhooks go through a
 * relay, which sends them on to the flow proxy as Enterprise Form.io would.
 * Applications are submitted through the site, as a visitor does, and both
 * engines run on the real engine server package. The scripted agent follows
 * the rubric, so the weak, average and strong applicants always land in the
 * same bands. This checks webhook-driven provide, the finance task chained on
 * the admissions task's save, that the chain stops, and that the flow viewer
 * shows a visitor every leg of their own runs and nothing of anyone else's.
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

    /** Apply through the site, wait for the workflow to settle, and return the submission and its relayed calls. */
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
        await stack.relay.settle();
        const calls = stack.relay.calls.filter((call) => call.payload?.submissionId === id);
        return { id, read: read.body, stored: await formio.getSubmission('application', id), calls };
    }

    function expectRelayed(calls, keys) {
        expect(calls.map((call) => call.key), JSON.stringify(calls)).to.deep.equal(keys);
        for (const call of calls) {
            expect(call.error, call.error).to.equal(undefined);
            expect(call.status, JSON.stringify(call.body)).to.equal(200);
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
        const { stored, read, calls } = await apply('weak');
        expectRelayed(calls, ['application:webhook']);
        expect(stored.data).to.include({ status: 'declined', decision: 'declined', overallScore: 3.3 });
        for (const field of SCORE_FIELDS) expect(stored.data[field], field).to.be.within(1, 10);
        expect(stored.data.agentRationale).to.be.a('string').and.not.equal('');
        expect(stored.data.awardLevel || '').to.equal('');
        // The page reads what the agents left, through the site.
        expect(read.result).to.include({ status: 'declined', decision: 'declined' });
    });

    it('accepts the average applicant, and never asks the finance task', async function () {
        const { stored, calls } = await apply('average');
        expectRelayed(calls, ['application:webhook']);
        expect(stored.data).to.include({ status: 'accepted', decision: 'accepted', overallScore: 6.7 });
        expect(stored.data.awardLevel || '').to.equal('');
    });

    describe('the strong applicant', function () {
        let result;

        before(async function () {
            result = await apply('strong');
        });

        it('is accepted with a scholarship, and the finance task chained on that save awards one', async function () {
            expectRelayed(result.calls, ['application:webhook', 'application:webhookFinance']);
            expect(result.calls.map((call) => call.payload.task)).to.deep.equal(['admissions', 'finance']);
            expect(Object.keys(result.calls[1].body.written)).to.include('awardLevel');
            expect(result.stored.data).to.include({
                status: 'scholarshipEvaluation',
                decision: 'acceptedWithScholarship',
                overallScore: 10,
                awardLevel: 'fullRide',
            });
            expect(result.stored.data.financeRationale).to.be.a('string').and.not.equal('');
            expect(result.stored.data).to.include({ firstName: 'Amara', gpa: PROFILES.strong.gpa, essay: PROFILES.strong.essay });
        });

        it('stops: the award\'s own save fires no webhook, and nothing changes after a quiet period', async function () {
            const before = stack.relay.calls.length;
            await new Promise((resolve) => setTimeout(resolve, 5000));
            expect(stack.relay.calls.length).to.equal(before);
            const stored = await formio.getSubmission('application', result.id);
            expect(stored.modified).to.equal(result.stored.modified);
        });

        it('saves nothing when either webhook is run again', async function () {
            for (const call of result.calls) {
                const { status, body } = await api('/agent/provide', { body: call.payload });
                expect(status, JSON.stringify(body)).to.equal(200);
                expect(body.written, call.key).to.deep.equal({});
            }
            const stored = await formio.getSubmission('application', result.id);
            expect(stored.modified).to.equal(result.stored.modified);
        });

        it('shows the applicant every leg of both runs in the flow viewer', async function () {
            const events = await applicant.flowEvents();
            const runs = {};
            for (const event of events) (runs[event.run] ||= []).push(event);
            const webhookRuns = Object.values(runs).filter((run) => run.some((event) =>
                event.phase === 'request' && event.kind === 'agent' && event.submissionId === result.id));
            expect(webhookRuns.map((run) => run.find((event) => event.kind === 'agent').task)).to.have.members(['admissions', 'finance']);
            for (const run of webhookRuns) {
                const legs = run.filter((event) => event.phase === 'response').map((event) => `${event.kind}:${event.status}`);
                // The webhook into the UAG, and the UAG's calls to the engine server, under one request id.
                expect(legs).to.include('agent:200');
                expect(legs).to.include('engine:200');
            }
        });
    });

    it('keeps each visitor to their own applications and runs', async function () {
        const mine = await apply('average');
        const read = await stranger.json(`/api/workflow/applications/${mine.id}`);
        expect(read.status).to.equal(404);
        expect(await stranger.flowEvents()).to.deep.equal([]);
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
        await stack.relay.settle();
    });

    it('computes the sum smoke test', async function () {
        const created = await formio.createSubmission('sum', { a: 2, b: 3 });
        const deadline = Date.now() + 60000;
        let stored = created;
        while (stored.data.sum === undefined && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            stored = await formio.getSubmission('sum', created._id);
        }
        expect(stored.data.sum).to.equal(5);
    });
});
