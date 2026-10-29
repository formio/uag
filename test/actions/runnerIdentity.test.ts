import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { ProjectInterface } from '@formio/appserver';
import { formflow } from '../../src/formflow';
import { UAGServer } from '../../src';
import { MAX_CHAIN, taskRunner } from '../../src/runner';
import { FakeFormio } from '../helpers/fakeFormio';
import { requireTestLicense, TEST_LICENSE } from '../agent/fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * Who a Run task action's background run acts as at Form.io: its agent role,
 * on behalf of the user who submitted, with tokens the UAG signs; or, with no
 * agent role, that user's own token. Never the project's key. Its engines
 * research as the user either way.
 */
describe('Run task identity', function () {
    this.timeout(20000);
    before(function () { requireTestLicense(this); });

    const SECRET = 'test-secret';
    const roles = {
        anonymous: { title: 'Anonymous', admin: false, default: true },
        applicant: { title: 'Applicant', admin: false, default: false },
        agent: { title: 'Agent', admin: false, default: false },
        administrator: { title: 'Administrator', admin: true, default: false }
    };
    const criteria = (task: string) => ({ type: 'content', key: `${task}Criteria`, input: false, html: `<p>Decide the ${task}.</p>`, properties: { uag: task, uagField: 'criteria' } });
    const decision = (key: string, task: string) => ({
        type: 'radio', key, label: key, input: true,
        values: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
        properties: { uag: task, uagAuthoritative: 'true' }
    });
    const application = (userUpdates: boolean) => ({
        title: 'Application', type: 'form', name: 'application', path: 'application', tags: ['uag'],
        components: [
            { type: 'textarea', key: 'essay', label: 'Essay', input: true },
            criteria('admissions'), decision('admitted', 'admissions'),
            criteria('finance'), decision('aid', 'finance')
        ],
        access: [{ type: 'read_all', roles: ['applicant'] }],
        submissionAccess: [
            { type: 'create_own', roles: ['applicant'] },
            // Without an agent role, the user's own token saves the task's results.
            ...(userUpdates ? [{ type: 'update_own', roles: ['applicant'] }, { type: 'read_own', roles: ['applicant'] }] : []),
            { type: 'create_all', roles: ['agent'] }, { type: 'update_all', roles: ['agent'] }, { type: 'read_all', roles: ['agent'] }
        ]
    });
    const runTask = (task: string, method: string, settings: any = {}, extra: any = {}) => ({
        title: task, name: 'agentRunTask', form: 'application', priority: 20, handler: ['before', 'after'], method: [method],
        settings: { task, answer: 'decisions', when: 'after', ...settings }, ...extra
    });

    let formio: FakeFormio;
    let server: UAGServer;
    let app: express.Express;
    let current: express.Express | null = null;
    const shared = http.createServer((req, res) => current!(req, res));
    before((done) => { shared.listen(0, '127.0.0.1', done); });
    after((done) => { shared.close(() => done()); });
    const request = () => { current = app; return supertest(shared); };

    const applicant = { _id: '5f0000000000000000000001', roles: ['applicant'], data: { email: 'ann@example.com' } };
    let token = '';

    async function start(settings: any, userUpdates = false, finance: any = settings) {
        formio = new FakeFormio({
            roles,
            forms: { application: application(userUpdates) },
            actions: {
                'application:admissions': runTask('admissions', 'create', settings),
                // The stub decision engine decides "no".
                'application:finance': runTask('finance', 'update', finance, { condition: { field: 'admitted', eq: 'equals', value: 'no' } })
            }
        });
        formio.secret = SECRET;
        await formio.start();
        server = new UAGServer({
            project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
            auth: { adminKey: 'admin-key', secret: SECRET },
            engines: ['stub-decision']
        } as any);
        await server.initialize();
        app = express();
        app.use(await server.router());
        token = jwt.sign({ user: { _id: applicant._id, roles: applicant.roles }, form: { _id: 'users' }, project: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, jti: 'session1' }, SECRET, { expiresIn: 3600 });
        formio.users[token] = applicant;
    }

    afterEach(async () => {
        if (server?.uagProject) await taskRunner(server.uagProject).idle();
        (server?.uagProject as any)?.destroy?.();
        ProjectInterface.module = undefined;
        await formio?.stop();
    });

    const submit = () => request().post('/application/submission').set('x-jwt-token', token).send({ data: { essay: 'Robotics club.' } });
    /** Everything the UAG asked Form.io for the background runs, after the applicant's create. */
    const runRequests = () => formio.requests.slice(formio.requests.findIndex((req) => req.method === 'POST' && /\/submission$/.test(req.url)) + 1)
        .filter((req) => /\/submission\//.test(req.url));
    const claimsOf = (req: any) => jwt.verify(req.headers['x-jwt-token'], SECRET) as any;

    /** Record who each task run researched as. */
    function researchers() {
        const service = formflow(server.uagProject!);
        const original = service.runTask.bind(service);
        const seen: any[] = [];
        (service as any).runTask = (form: any, task: any, submission: any, auth: any, options: any) => {
            seen.push({ task, roles: auth.user?.roles, id: auth.user?._id, requestId: options?.requestId });
            return original(form, task, submission, auth, options);
        };
        return seen;
    }

    describe('with an agent role', () => {
        beforeEach(() => start({ agentRole: 'agent' }));

        it('loads and saves as the agent role for the user, never with the key, and the chained task does too', async () => {
            const res = await submit();
            expect(res.status, res.text).to.equal(201);
            await taskRunner(server.uagProject!).idle();
            const requests = runRequests();
            const puts = requests.filter((req) => req.method === 'PUT');
            expect(puts.length).to.be.at.least(2);
            expect(puts[1].body.data).to.have.property('aid');
            for (const req of requests) {
                expect(req.headers, `${req.method} ${req.url}`).to.not.have.any.keys('x-token', 'x-admin-key');
                const claims = claimsOf(req);
                expect(claims).to.include({ external: true });
                expect(claims.user._id).to.equal(applicant._id);
                expect(claims.user.roles).to.deep.equal(['agent']);
                expect(claims.uag.agent).to.equal(true);
            }
        });

        it('researches as the user, with their roles', async () => {
            const seen = researchers();
            await submit();
            await taskRunner(server.uagProject!).idle();
            // Finance runs again on its own save, and changes nothing.
            expect(seen.map((entry) => entry.task).slice(0, 2)).to.deep.equal(['admissions', 'finance']);
            for (const entry of seen) {
                expect(entry).to.include({ id: applicant._id });
                expect(entry.roles).to.deep.equal(['applicant']);
            }
        });

        it('passes the submitter\'s request id to the engines of every run it starts, chained runs too', async () => {
            const seen = researchers();
            await request().post('/application/submission').set('x-jwt-token', token).set('X-Request-Id', 'demo.workflow.abc123')
                .send({ data: { essay: 'Robotics club.' } });
            await taskRunner(server.uagProject!).idle();
            expect(seen.slice(0, 2).map((entry) => entry.requestId)).to.deep.equal(['demo.workflow.abc123', 'demo.workflow.abc123']);
        });

        it('fails the run, saying the secrets must match, when Form.io refuses the agent\'s token', async () => {
            formio.secret = 'another-secret';
            const errors: string[] = [];
            const original = console.error;
            console.error = (...args: any[]) => { errors.push(args.join(' ')); };
            try {
                const res = await submit();
                expect(res.status).to.equal(201);
                await taskRunner(server.uagProject!).idle();
            }
            finally {
                console.error = original;
            }
            expect(errors.join('\n')).to.contain('JWT_SECRET must be the same as Form.io Enterprise\'s');
            expect(errors.join('\n')).to.not.contain('eyJ');
            expect(formio.forwarded('PUT')).to.deep.equal([]);
        });
    });

    describe('with an agent role, chaining a task without one', () => {
        beforeEach(() => start({ agentRole: 'agent' }, true, {}));

        it('runs the chained task as the user, with their roles, never with the agent role', async () => {
            const seen = researchers();
            await submit();
            await taskRunner(server.uagProject!).idle();
            const finance = runRequests().filter((req) => claimsOf(req).uag?.task === 'finance');
            expect(finance.filter((req) => req.method === 'PUT')).to.have.length(1);
            for (const req of finance) {
                expect(req.headers, `${req.method} ${req.url}`).to.not.have.any.keys('x-token', 'x-admin-key');
                const claims = claimsOf(req);
                expect(claims.user._id).to.equal(applicant._id);
                expect(claims.user.roles).to.deep.equal(['applicant']);
                expect(claims.uag.agent).to.equal(false);
            }
            expect(seen.filter((entry) => entry.task === 'finance').every((entry) => entry.id === applicant._id && entry.roles.join() === 'applicant')).to.equal(true);
        });
    });

    describe('with tasks whose saves start each other without end', () => {
        beforeEach(() => start({ agentRole: 'agent' }));

        it('stops after MAX_CHAIN runs in a row, saying why', async () => {
            const service = formflow(server.uagProject!);
            const original = service.runTask.bind(service);
            let runs = 0;
            // Each run changes the essay, so each save starts the finance task again.
            (service as any).runTask = async (...args: any[]) => {
                const run = await (original as any)(...args);
                run.submission.data.essay = `Run ${++runs}`;
                run.written = { ...run.written, essay: run.submission.data.essay };
                return run;
            };
            const errors: string[] = [];
            const log = console.error;
            console.error = (...args: any[]) => { errors.push(args.join(' ')); };
            try {
                await submit();
                await taskRunner(server.uagProject!).idle();
            }
            finally {
                console.error = log;
            }
            expect(runs).to.equal(1 + MAX_CHAIN);
            expect(errors.join('\n')).to.contain(`${MAX_CHAIN} runs in a row`);
        });
    });

    describe('with an administrator who submits', () => {
        beforeEach(() => start({ agentRole: 'agent' }));

        it('acts with the agent role, and researches as the user without their admin role', async () => {
            const admin = { _id: '5f0000000000000000000003', roles: ['applicant', 'administrator'], data: {} };
            const adminToken = jwt.sign({ user: { _id: admin._id, roles: admin.roles }, form: { _id: 'users' }, project: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, jti: 'session3' }, SECRET, { expiresIn: 3600 });
            formio.users[adminToken] = admin;
            const seen = researchers();
            const res = await request().post('/application/submission').set('x-jwt-token', adminToken).send({ data: { essay: 'Robotics club.' } });
            expect(res.status, res.text).to.equal(201);
            await taskRunner(server.uagProject!).idle();
            expect(formio.forwarded('PUT').length).to.be.at.least(1);
            expect(seen[0]).to.include({ task: 'admissions', id: admin._id });
            expect(seen[0].roles).to.deep.equal(['applicant']);
        });
    });

    describe('without an agent role', () => {
        beforeEach(() => start({}, true));

        it('loads and saves with the user\'s own token, and researches as them', async () => {
            const seen = researchers();
            await submit();
            await taskRunner(server.uagProject!).idle();
            const requests = runRequests();
            expect(requests.filter((req) => req.method === 'PUT').length).to.be.at.least(2);
            for (const req of requests) {
                expect(req.headers['x-jwt-token'], `${req.method} ${req.url}`).to.equal(token);
            }
            expect(seen.every((entry) => entry.id === applicant._id)).to.equal(true);
        });
    });
});
