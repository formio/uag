import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { Collection, MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ProjectInterface } from '@formio/appserver';
import { UAGServer } from '../src';
import { TaskRunJob, TaskRunner, TaskRunOutcome, taskRunner } from '../src/runner';
import { LEASE_MS, MAX_ATTEMPTS, TaskRunRecord, TaskRunStore } from '../src/runs';
import { FakeFormio } from './helpers/fakeFormio';
import { requireTestLicense, TEST_LICENSE } from './agent/fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * Run task records in the UAG's database: every run recorded; runs that act
 * with an agent role queued there, taken by one replica at a time under a
 * lease, and resumed after a restart; all of them shown in Action Logs.
 */
describe('Run task records', function () {
    this.timeout(60000);
    let mongod: MongoMemoryServer;
    let client: MongoClient;
    let counter = 0;

    before(async () => {
        mongod = await MongoMemoryServer.create();
        client = await MongoClient.connect(mongod.getUri());
    });

    after(async () => {
        await client?.close();
        await mongod?.stop();
    });

    const collection = () => client.db(`runs${++counter}`).collection<TaskRunRecord>('uag-taskruns');
    const run = (overrides: Partial<TaskRunRecord> = {}): any => ({
        project: 'project1', form: 'form1', formName: 'application', submission: 'sub1', action: 'Admissions',
        task: 'admissions', answer: 'task', handler: 'after', method: 'create', durable: true,
        actingFor: { _id: 'user1', roles: ['applicant'] }, agentRole: 'agent', ...overrides
    });

    describe('the store', () => {
        it('lets one replica take a pending run', async () => {
            const runs = collection();
            const [one, two] = [new TaskRunStore(runs), new TaskRunStore(runs)];
            await one.add(run());
            const claimed = await Promise.all([one.claim(), two.claim(), one.claim(), two.claim()]);
            expect(claimed.filter(Boolean)).to.have.length(1);
            expect(claimed.find(Boolean)).to.include({ status: 'running', attempts: 1 });
        });

        it('lets another replica take a run whose lease ran out, and ignores the first replica\'s result', async () => {
            const runs = collection();
            const [first, second] = [new TaskRunStore(runs), new TaskRunStore(runs)];
            const id = await first.add(run());
            await first.claim();
            expect(await second.claim()).to.equal(null);
            const later = new Date(Date.now() + LEASE_MS + 1000);
            const taken = await second.claim(later);
            expect(taken).to.include({ owner: second.owner, attempts: 2 });
            await first.finish(id, { status: 'done', saved: true, written: ['a'], cleared: [] });
            expect((await runs.findOne({ _id: id }))!.status).to.equal('running');
            expect(await first.renew(id)).to.equal(false);
        });

        it('gives a run up after it lost its replica too many times', async () => {
            const runs = collection();
            const store = new TaskRunStore(runs);
            const id = await store.add(run());
            let now = Date.now();
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                expect(await store.claim(new Date(now))).to.not.equal(null);
                now += LEASE_MS + 1000;
            }
            expect(await store.claim(new Date(now))).to.equal(null);
            expect(await runs.findOne({ _id: id })).to.include({ status: 'failed' });
        });

        it('takes only its own project\'s runs from a database UAGs of other projects share', async () => {
            const runs = collection();
            const other = new TaskRunStore(runs, 'project2');
            const own = new TaskRunStore(runs, 'project1');
            const id = await own.add(run());
            expect(await other.claim()).to.equal(null);
            let now = Date.now();
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                expect(await own.claim(new Date(now))).to.not.equal(null);
                now += LEASE_MS + 1000;
            }
            // Nor does it give up another project's run.
            await other.claim(new Date(now));
            expect(await runs.findOne({ _id: id })).to.include({ status: 'running' });
            expect(await own.claim(new Date(now))).to.equal(null);
            expect(await runs.findOne({ _id: id })).to.include({ status: 'failed' });
        });

        it('lists no records for a limit of 0, still counting them', async () => {
            const runs = collection();
            const store = new TaskRunStore(runs, 'project1');
            await store.add(run());
            await store.add(run());
            expect(await store.list({ project: 'project1' }, 0)).to.deep.equal({ items: [], total: 2 });
            expect((await store.list({ project: 'project1' }, 1)).items).to.have.length(1);
        });

        it('never takes a run that is not durable', async () => {
            const runs = collection();
            const store = new TaskRunStore(runs);
            await store.add(run({ durable: false, status: 'running' } as any));
            await store.add(run({ durable: false }));
            expect(await store.claim(new Date(Date.now() + LEASE_MS * 10))).to.equal(null);
        });
    });

    describe('the runner', () => {
        /** A runner whose runs end as `outcome`, after `gate` opens. */
        class StubRunner extends TaskRunner {
            executed: TaskRunJob[] = [];
            gate: Promise<void> = Promise.resolve();
            async execute(job: TaskRunJob): Promise<TaskRunOutcome> {
                this.executed.push(job);
                await this.gate;
                return { status: 'done', written: { status: 'accepted' }, cleared: [], engines: [{ kind: 'decision', engine: 'jev', model: 'jev-1' }], saved: true };
            }
        }
        const project: any = { project: { _id: 'project1' } };
        const job = (overrides: Partial<TaskRunJob> = {}): TaskRunJob => ({
            form: 'application', formId: 'form1', submission: 'sub1', task: 'admissions', answer: 'task', method: 'create',
            actingFor: { _id: 'user1', roles: ['applicant'], email: 'ann@example.com' }, action: 'Admissions', ...overrides
        });

        it('records a durable run as pending before enqueue resolves, then runs and records it', async () => {
            const runs = collection();
            const runner = new StubRunner(project);
            let open!: () => void;
            runner.gate = new Promise((resolve) => { open = resolve; });
            runner.useStore(new TaskRunStore(runs));
            await runner.enqueue(job({ agentRole: 'agent' }));
            const recorded = await runs.findOne({});
            expect(recorded).to.include({ durable: true, task: 'admissions', agentRole: 'agent' });
            expect(['pending', 'running']).to.include(recorded!.status);
            open();
            await runner.idle();
            runner.stop();
            expect(await runs.findOne({})).to.deep.include({ status: 'done', saved: true, written: ['status'] });
        });

        it('resumes a run a stopped replica recorded', async () => {
            const runs = collection();
            // The replica that recorded the run stopped before running it.
            await new TaskRunStore(runs).add(run());
            const runner = new StubRunner(project);
            runner.useStore(new TaskRunStore(runs));
            await runner.idle();
            runner.stop();
            expect(runner.executed).to.have.length(1);
            expect(runner.executed[0]).to.include({ submission: 'sub1', agentRole: 'agent' });
            expect(runner.executed[0].actingFor).to.deep.equal({ _id: 'user1', roles: ['applicant'] });
            expect(await runs.findOne({})).to.include({ status: 'done' });
        });

        it('runs a run once when two replicas sweep at the same time', async () => {
            const runs = collection();
            await new TaskRunStore(runs).add(run());
            const [one, two] = [new StubRunner(project), new StubRunner(project)];
            one.useStore(new TaskRunStore(runs));
            two.useStore(new TaskRunStore(runs));
            await Promise.all([one.idle(), two.idle()]);
            one.stop();
            two.stop();
            expect(one.executed.length + two.executed.length).to.equal(1);
        });

        it('records a run without an agent role, keeping it and the caller\'s token out of the queue', async () => {
            const runs = collection();
            const runner = new StubRunner(project);
            runner.useStore(new TaskRunStore(runs));
            const caller: any = { token: 'the-callers-token', clone() { return this; } };
            await runner.enqueue(job({ caller }));
            await runner.idle();
            runner.stop();
            const recorded = await runs.findOne({});
            expect(recorded).to.include({ durable: false, status: 'done' });
            expect(JSON.stringify(recorded)).to.not.contain('the-callers-token');
            expect(recorded!.actingFor).to.deep.equal({ _id: 'user1', roles: ['applicant'], email: 'ann@example.com' });
        });
    });

    describe('in a UAG with its database', () => {
        before(function () { requireTestLicense(this); });

        const SECRET = 'test-secret';
        const env = { ...process.env };
        const criteria = { type: 'content', key: 'admissionsCriteria', input: false, html: '<p>Decide.</p>', properties: { uag: 'admissions', uagField: 'criteria' } };
        const application = {
            title: 'Application', type: 'form', name: 'application', path: 'application', tags: ['uag'],
            components: [
                { type: 'textarea', key: 'essay', label: 'Essay', input: true },
                criteria,
                {
                    type: 'radio', key: 'admitted', label: 'Admitted', input: true,
                    values: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
                    properties: { uag: 'admissions', uagAuthoritative: 'true' }
                }
            ],
            access: [{ type: 'read_all', roles: ['applicant'] }],
            submissionAccess: [{ type: 'create_own', roles: ['applicant'] }, { type: 'read_all', roles: ['agent'] }, { type: 'update_all', roles: ['agent'] }]
        };
        const roles = {
            anonymous: { title: 'Anonymous', admin: false, default: true },
            applicant: { title: 'Applicant', admin: false, default: false },
            agent: { title: 'Agent', admin: false, default: false }
        };
        let formio: FakeFormio;
        let server: UAGServer;
        let app: express.Express;
        let runs: Collection<TaskRunRecord>;
        let current: express.Express | null = null;
        const shared = http.createServer((req, res) => current!(req, res));
        before((done) => { shared.listen(0, '127.0.0.1', done); });
        after((done) => { shared.close(() => done()); });
        const request = () => { current = app; return supertest(shared); };
        const applicant = { _id: '5f0000000000000000000001', roles: ['applicant'], data: { email: 'ann@example.com' } };
        let token = '';

        beforeEach(async () => {
            const name = `uagserver${++counter}`;
            formio = new FakeFormio({
                roles, forms: { application },
                actions: { 'application:admissions': { title: 'Admissions', name: 'agentRunTask', form: 'application', priority: 20, handler: ['before', 'after'], method: ['create'], settings: { task: 'admissions', answer: 'decisions', when: 'after', agentRole: 'agent' } } }
            });
            formio.secret = SECRET;
            await formio.start();
            process.env.MONGO = mongod.getUri().replace('127.0.0.1', 'localhost');
            process.env.UAG_DATABASE = name;
            server = new UAGServer({
                project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
                auth: { adminKey: 'admin-key', secret: SECRET }, engines: ['stub-decision']
            } as any);
            await server.initialize();
            app = express();
            app.use(await server.router());
            runs = client.db(name).collection<TaskRunRecord>('uag-taskruns');
            token = jwt.sign({ user: { _id: applicant._id, roles: applicant.roles }, form: { _id: 'users' }, project: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, jti: 's1' }, SECRET, { expiresIn: 3600 });
            formio.users[token] = applicant;
        });

        afterEach(async () => {
            const runner = server?.uagProject ? taskRunner(server.uagProject) : undefined;
            await runner?.idle();
            runner?.stop();
            await server?.database?.close();
            (server?.uagProject as any)?.destroy?.();
            ProjectInterface.module = undefined;
            process.env = { ...env };
            await formio?.stop();
        });

        const submit = () => request().post('/application/submission').set('x-jwt-token', token).send({ data: { essay: 'Robotics club.' } });

        it('reports durable runs in capabilities', async () => {
            const res = await request().get('/agent/capabilities').set('x-admin-key', 'admin-key');
            expect(res.body).to.include({ durableRuns: true });
        });

        it('records the run before answering, and completes it', async () => {
            const res = await submit();
            expect(res.status, res.text).to.equal(201);
            expect(await runs.countDocuments({ submission: res.body._id })).to.equal(1);
            await taskRunner(server.uagProject!).idle();
            const record = await runs.findOne({ submission: res.body._id });
            expect(record).to.include({ status: 'done', durable: true, saved: true, task: 'admissions' });
            expect(record!.written).to.deep.equal(['admitted']);
            expect(formio.forwarded('PUT')).to.have.length(1);
        });

        it('resumes a run another replica recorded and stopped on', async () => {
            const res = await submit();
            await taskRunner(server.uagProject!).idle();
            const puts = formio.forwarded('PUT').length;
            // A run recorded by a replica that stopped: the submission changed since, so the task has work to do.
            formio.submissions[res.body._id].data.admitted = undefined;
            await runs.insertOne({ ...(await runs.findOne({}))!, _id: new ObjectId(), status: 'pending', attempts: 0, owner: undefined, created: new Date(), modified: new Date() } as any);
            const replica = new TaskRunner(server.uagProject!);
            replica.useStore(new TaskRunStore(runs));
            await replica.idle();
            replica.stop();
            expect(formio.forwarded('PUT')).to.have.length(puts + 1);
            expect(await runs.countDocuments({ status: 'done' })).to.equal(2);
        });

        it('shows its runs in Action Logs with Form.io\'s entries, newest first', async () => {
            const res = await submit();
            await taskRunner(server.uagProject!).idle();
            const formId = formio.formIds.application;
            formio.actionItems.push({ _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', title: 'Webhook', action: 'webhook', form: formId, handler: 'after', method: 'create', state: 'complete', messages: [], created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z' });
            const logs = await request().get(`/action?form=${formId}&limit=10&skip=0&sort=-modified`).set('x-admin-key', 'admin-key');
            expect(logs.status, logs.text).to.equal(200);
            expect(logs.headers['content-range']).to.equal('0-1/2');
            expect(logs.body.map((item: any) => item.title)).to.deep.equal(['Admissions', 'Webhook']);
            const run = logs.body[0];
            expect(run).to.include({ action: 'agentRunTask', submission: res.body._id, handler: 'after', method: 'create', state: 'complete', form: formId });
            expect(run.messages.map((message: any) => message.info).join(' ')).to.contain('Saved 1 field(s): admitted');
            const one = await request().get(`/action/${run._id}`).set('x-admin-key', 'admin-key');
            expect(one.body).to.include({ _id: run._id, state: 'complete' });
            // A title filter is text, never a regular expression run against the database.
            const titled = await request().get(`/action?form=${formId}&title__regex=${encodeURIComponent('Admissions (')}`).set('x-admin-key', 'admin-key');
            expect(titled.status).to.equal(200);
            const byTitle = await request().get(`/action?form=${formId}&title__regex=admiss`).set('x-admin-key', 'admin-key');
            expect(byTitle.body.map((item: any) => item.title)).to.include('Admissions');
            const errors = await request().get(`/action?form=${formId}&state=error`).set('x-admin-key', 'admin-key');
            expect(errors.body.map((item: any) => item.title)).to.not.include('Admissions');
        });

        it('shows nothing to a caller Form.io refuses', async () => {
            await submit();
            await taskRunner(server.uagProject!).idle();
            const logs = await request().get(`/action?form=${formio.formIds.application}`);
            expect(logs.status).to.equal(401);
            const id = String((await runs.findOne({}))!._id);
            expect((await request().get(`/action/${id}`)).status).to.equal(401);
        });
    });
});
