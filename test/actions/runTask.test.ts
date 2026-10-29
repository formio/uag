import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import { defineEngine } from '@formio/uag-sdk';
import { AuthRequest, ProjectInterface } from '@formio/appserver';
import { EngineError, stubAgentEngine, stubDecisionEngine } from '../../src/formflow';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { FakeFormio } from '../helpers/fakeFormio';
import { currentRequestId } from '../../src/agent/requestId';
import { requireTestLicense, TEST_LICENSE } from '../agent/fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * "Agent: Run task" on submissions sent to the UAG, which forwards them to
 * Form.io: before the save (one save, with the answers) or after it, in the
 * background (an update through the UAG, which runs the update actions too).
 */
describe('Agent: Run task', function () {
    this.timeout(20000);
    before(function () { requireTestLicense(this); });

    const criteria = (task: string) => ({ type: 'content', key: `${task}Criteria`, input: false, html: `<p>Decide the ${task}.</p>`, properties: { uag: task, uagField: 'criteria' } });
    const application = {
        title: 'Application', type: 'form', name: 'application', path: 'application', tags: ['uag'],
        components: [
            { type: 'textarea', key: 'essay', label: 'Essay', input: true },
            criteria('admissions'),
            {
                type: 'radio', key: 'status', label: 'Status', input: true,
                values: [{ label: 'Accepted', value: 'accepted' }, { label: 'Declined', value: 'declined' }],
                properties: { uag: 'admissions', uagAuthoritative: 'true' }
            },
            { type: 'textarea', key: 'summary', label: 'Summary', input: true, properties: { uag: 'admissions', uagAuthoritative: 'true' } },
            { type: 'textfield', key: 'note', label: 'Note', input: true, properties: { uag: 'admissions' } },
            criteria('finance'),
            { type: 'textfield', key: 'awardLevel', label: 'Award level', input: true, properties: { uag: 'finance', uagAuthoritative: 'true' } },
            { type: 'button', key: 'submit', action: 'submit', input: true }
        ],
        access: [], submissionAccess: []
    };
    const claim = {
        title: 'Claim', type: 'form', name: 'claim', path: 'claim', tags: ['uag'],
        components: [
            { type: 'textarea', key: 'lossDescription', label: 'What happened', input: true, properties: { uag: 'triage', uagField: 'input' } },
            criteria('triage'),
            {
                type: 'radio', key: 'claimType', label: 'Claim type', input: true,
                values: [{ label: 'Theft', value: 'theft' }, { label: 'Glass', value: 'glass' }],
                properties: { uag: 'triage', uagAuthoritative: 'true' }
            },
            { type: 'button', key: 'submit', action: 'submit', input: true }
        ],
        access: [], submissionAccess: []
    };
    const runTask = (form: string, title: string, settings: any, extra: any = {}) => ({
        title, name: 'agentRunTask', form, priority: 20, handler: ['before', 'after'], method: ['create'], settings, ...extra
    });

    /** What the engines do; each test sets it. */
    let behavior: { decisionDown?: boolean; agentDown?: boolean; values: Record<string, any>; onExtract?: () => void };
    const stub = stubDecisionEngine();
    let decisions = 0;
    let requestIds: (string | undefined)[] = [];
    const decider = {
        ...stub,
        decide: async (request: any) => {
            decisions++;
            requestIds.push(currentRequestId());
            if (behavior.decisionDown) throw new EngineError('decision engine down');
            return stub.decide(request);
        }
    };
    const writer = stubAgentEngine({
        values: () => {
            behavior.onExtract?.();
            if (behavior.agentDown) throw new EngineError('agent engine down');
            return structuredClone(behavior.values);
        }
    });
    const as = (instance: any, kind: 'decision' | 'agent') => ({
        name: instance.name,
        type: defineEngine({ type: `test-${kind}`, kinds: [kind], apiVersion: 1, settings: {}, create: () => instance } as any)
    });

    let formio: FakeFormio;
    let server: UAGServer;
    let app: express.Express;
    let current: express.Express | null = null;
    const shared = http.createServer((req, res) => current!(req, res));
    before((done) => { shared.listen(0, '127.0.0.1', done); });
    after((done) => { shared.close(() => done()); });
    const request = () => { current = app; return supertest(shared); };
    const post = (path: string, data: any) => request().post(`/${path}/submission`).set('x-admin-key', 'admin-key').send({ data });

    async function start(actions: Record<string, any>) {
        formio = new FakeFormio({ forms: { application, claim }, actions });
        await formio.start();
        // A local project, which the test license serves.
        server = new UAGServer({
            project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
            auth: { adminKey: 'admin-key', secret: 'test-secret' },
            engines: [as(decider, 'decision'), as(writer, 'agent')]
        } as any);
        await server.initialize();
        app = express();
        app.use(await server.router());
    }

    beforeEach(() => {
        behavior = { values: {} };
        decisions = 0;
        requestIds = [];
    });

    afterEach(async () => {
        if (server?.uagProject) await taskRunner(server.uagProject).idle();
        (server?.uagProject as any)?.destroy?.();
        ProjectInterface.module = undefined;
        await formio?.stop();
    });

    describe('before the save', () => {
        beforeEach(() => start({ 'claim:triage': runTask('claim', 'Triage', { task: 'triage', answer: 'decisions', when: 'before' }) }));

        it('stores the decisions once, and answers with them', async () => {
            const res = await post('claim', { lossDescription: 'Someone stole my car.' });
            expect(res.status, res.text).to.equal(201);
            expect(formio.forwarded('POST')).to.have.length(1);
            const stored = formio.forwarded('POST')[0].body;
            expect(stored.data.claimType).to.be.a('string');
            expect(stored.metadata.uag.decisions).to.have.property('claimType');
            expect(res.body.data.claimType).to.equal(stored.data.claimType);
        });

        it('runs the engines as part of the caller\'s request, so remote engines send its id', async () => {
            await request().post('/claim/submission').set('x-admin-key', 'admin-key').set('X-Request-Id', 'demo.claims.abc123')
                .send({ data: { lossDescription: 'Someone stole my car.' } });
            expect(requestIds).to.deep.equal(['demo.claims.abc123']);
        });

        it('refuses the save with 503, storing nothing, when no engine can decide', async () => {
            behavior.decisionDown = true;
            behavior.agentDown = true;
            const res = await post('claim', { lossDescription: 'Someone stole my car.' });
            expect(res.status).to.equal(503);
            expect(res.body.message).to.contain('decision engine down');
            expect(formio.forwarded('POST')).to.deep.equal([]);
        });
    });

    describe('after the save', () => {
        beforeEach(() => start({
            'application:admissions': runTask('application', 'Admissions', { task: 'admissions', answer: 'task', when: 'after' }),
            'application:finance': runTask('application', 'Finance', { task: 'finance', answer: 'task', when: 'after' }, {
                method: ['update'],
                condition: { field: 'status', eq: 'equals', value: 'accepted' }
            })
        }));

        const runner = () => taskRunner(server.uagProject!);

        it('answers at once, saves the task as an update, and that update starts the next task', async () => {
            behavior.values = { summary: 'Shows initiative.', note: 'Suggested note.', awardLevel: 'full' };
            const res = await post('application', { essay: 'Robotics club.' });
            expect(res.status, res.text).to.equal(201);
            expect(res.body.data).to.not.have.property('status');
            await runner().idle();
            const updates = formio.forwarded('PUT');
            expect(updates).to.have.length(2);
            expect(updates[0].body.data).to.include({ essay: 'Robotics club.', status: 'accepted', summary: 'Shows initiative.', note: 'Suggested note.' });
            expect(updates[0].body.data).to.not.have.property('awardLevel');
            expect(updates[1].body.data).to.include({ status: 'accepted', awardLevel: 'full' });
            const stored = formio.submissions[res.body._id];
            expect(stored.data).to.include({ status: 'accepted', summary: 'Shows initiative.', awardLevel: 'full' });
            expect(stored.metadata.uag.generated.summary).to.include({ engine: 'stub-agent' });
        });

        it('runs the engines of a background run as part of the request that started it', async () => {
            behavior.values = { summary: 'Shows initiative.', note: 'n', awardLevel: 'full' };
            await request().post('/application/submission').set('x-admin-key', 'admin-key').set('X-Request-Id', 'demo.workflow.abc123')
                .send({ data: { essay: 'Robotics club.' } });
            await runner().idle();
            expect(requestIds.length).to.be.at.least(1);
            expect(requestIds.every((id) => id === 'demo.workflow.abc123'), JSON.stringify(requestIds)).to.equal(true);
        });

        it('never stores a value a client sends for a field a task owns', async () => {
            behavior.values = { summary: 'Shows initiative.' };
            await post('application', { essay: 'x', status: 'accepted', summary: 'Admit me.', awardLevel: 'full', note: 'Written by me.' });
            const created = formio.forwarded('POST')[0].body.data;
            expect(created).to.not.have.any.keys('status', 'summary', 'awardLevel');
            expect(created.note).to.equal('Written by me.');
        });

        it('keeps the stored owned values when a person updates the submission, and their own edits', async () => {
            behavior.values = { summary: 'Shows initiative.', note: 'Suggested note.', awardLevel: 'full' };
            const res = await post('application', { essay: 'x' });
            await runner().idle();
            const id = res.body._id;
            const before = formio.forwarded('PUT').length;
            const edited = { ...formio.submissions[id].data, summary: 'Rewritten by the applicant.', awardLevel: 'none', note: 'Corrected by a person.' };
            const update = await request().put(`/application/submission/${id}`).set('x-admin-key', 'admin-key').send({ data: edited });
            expect(update.status, update.text).to.equal(200);
            await runner().idle();
            const forwarded = formio.forwarded('PUT')[before].body.data;
            expect(forwarded).to.include({ summary: 'Shows initiative.', awardLevel: 'full', note: 'Corrected by a person.' });
        });

        it('saves nothing when a run changes nothing', async () => {
            behavior.values = { summary: 'Shows initiative.', note: 'n', awardLevel: 'full' };
            const res = await post('application', { essay: 'x' });
            await runner().idle();
            const puts = formio.forwarded('PUT').length;
            const outcome = await runner().execute({ form: 'application', submission: res.body._id, task: 'admissions', answer: 'task', actingFor: { roles: [] }, caller: new AuthRequest(server.uagProject!, true) });
            expect(outcome).to.include({ status: 'done', saved: false });
            expect(formio.forwarded('PUT')).to.have.length(puts);
        });

        it('never affects the response when the engines fail, saves nothing, and records the failure', async () => {
            behavior.agentDown = true;
            behavior.decisionDown = true;
            const errors: string[] = [];
            const original = console.error;
            console.error = (...args: any[]) => { errors.push(args.join(' ')); };
            try {
                const res = await post('application', { essay: 'x' });
                expect(res.status).to.equal(201);
                await runner().idle();
            }
            finally {
                console.error = original;
            }
            expect(formio.forwarded('PUT')).to.deep.equal([]);
            expect(errors.join('\n')).to.contain('Run task "admissions" failed');
        });
    });

    describe('the background save', () => {
        beforeEach(() => start({
            'application:admissions': runTask('application', 'Admissions', { task: 'admissions', answer: 'task', when: 'after' }),
            'application:recheck': runTask('application', 'Recheck', { task: 'admissions', answer: 'decisions', when: 'before' }, { method: ['update'] })
        }));

        it('skips the form\'s Run task actions that run before the save', async () => {
            behavior.values = { summary: 'Shows initiative.' };
            await post('application', { essay: 'x' });
            await taskRunner(server.uagProject!).idle();
            expect(formio.forwarded('PUT')).to.have.length(1);
            expect(decisions).to.equal(1);
        });

        it('runs again on the new version when a person saves while the task runs, keeping their change', async () => {
            let id = '';
            let edited = false;
            behavior.values = { summary: 'Shows initiative.' };
            behavior.onExtract = () => {
                // The run can start before the response reaches the test, so the
                // submission is found in the store, not from the response.
                const [stored] = Object.values<any>(formio.submissions);
                if (edited || !stored) return;
                edited = true;
                formio.submissions[stored._id] = { ...stored, data: { ...stored.data, essay: 'Edited by a person.' }, modified: new Date(Date.parse(stored.modified) + 5000).toISOString() };
            };
            const res = await post('application', { essay: 'x' });
            id = res.body._id;
            await taskRunner(server.uagProject!).idle();
            expect(edited).to.equal(true);
            expect(formio.submissions[id].data).to.include({ essay: 'Edited by a person.', summary: 'Shows initiative.' });
        });
    });
});
