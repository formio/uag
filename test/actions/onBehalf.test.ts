import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { ProjectInterface } from '@formio/appserver';
import { formflow } from '../../src/formflow';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { FakeFormio } from '../helpers/fakeFormio';
import { requireTestLicense, TEST_LICENSE } from '../agent/fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * Creating a submission through the UAG: with the caller's own token when the
 * form lets their roles create, or by the agent on their behalf, owned by them,
 * when the form grants the agent role "Create All" and the caller is one of the
 * Run task action's submitter roles.
 */
describe('Creating on a user\'s behalf', function () {
    this.timeout(20000);
    before(function () { requireTestLicense(this); });

    const SECRET = 'test-secret';
    const roles = {
        anonymous: { title: 'Anonymous', admin: false, default: true },
        applicant: { title: 'Applicant', admin: false, default: false },
        reviewer: { title: 'Reviewer', admin: false, default: false },
        agent: { title: 'Agent', admin: false, default: false },
        other: { title: 'Other agent', admin: false, default: false },
        administrator: { title: 'Administrator', admin: true, default: false }
    };
    const application = (submissionAccess: any[]) => ({
        title: 'Application', type: 'form', name: 'application', path: 'application', tags: ['uag'],
        components: [
            { type: 'textarea', key: 'essay', label: 'Essay', input: true, properties: { uag: 'admissions', uagField: 'input' } },
            { type: 'content', key: 'admissionsCriteria', input: false, html: '<p>Decide.</p>', properties: { uag: 'admissions', uagField: 'criteria' } },
            {
                type: 'radio', key: 'status', label: 'Status', input: true,
                values: [{ label: 'Accepted', value: 'accepted' }, { label: 'Declined', value: 'declined' }],
                properties: { uag: 'admissions', uagAuthoritative: 'true' }
            }
        ],
        access: [{ type: 'read_all', roles: ['anonymous', 'applicant'] }],
        submissionAccess
    });
    const runTask = (settings: any, title = 'Admissions') => ({
        title, name: 'agentRunTask', form: 'application', priority: 20, handler: ['before', 'after'], method: ['create'],
        settings: { task: 'admissions', answer: 'decisions', when: 'before', ...settings }
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
    /** A token Form.io would sign for the applicant (Enterprise adds a session, checked with Form.io). */
    const tokenFor = (user: any) => {
        const token = jwt.sign({ user: { _id: user._id, roles: user.roles }, form: { _id: 'users' }, project: { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, jti: 'session1' }, SECRET, { expiresIn: 3600 });
        formio.users[token] = user;
        return token;
    };
    const submit = (token?: string) => {
        const req = request().post('/application/submission');
        if (token) req.set('x-jwt-token', token);
        return req.send({ data: { essay: 'Robotics club.', status: 'accepted' } });
    };
    const forwarded = () => formio.forwarded('POST');
    const forwardedClaims = () => jwt.verify(forwarded()[0].headers['x-jwt-token'], SECRET) as any;

    async function start(submissionAccess: any[], actions: Record<string, any>) {
        formio = new FakeFormio({ roles, forms: { application: application(submissionAccess) }, actions });
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
    }

    afterEach(async () => {
        if (server?.uagProject) await taskRunner(server.uagProject).idle();
        (server?.uagProject as any)?.destroy?.();
        ProjectInterface.module = undefined;
        await formio?.stop();
    });

    it('creates with the caller\'s own token when their role may create', async () => {
        await start([{ type: 'create_own', roles: ['applicant'] }], { 'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['applicant'] }) });
        const token = tokenFor(applicant);
        const res = await submit(token);
        expect(res.status, res.text).to.equal(201);
        expect(forwarded()[0].headers['x-jwt-token']).to.equal(token);
    });

    it('creates on the caller\'s behalf with the agent role, owned by the caller, never with a key', async () => {
        await start([{ type: 'create_all', roles: ['agent'] }], { 'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['applicant'] }) });
        const res = await submit(tokenFor(applicant));
        expect(res.status, res.text).to.equal(201);
        const request = forwarded()[0];
        expect(request.headers).to.not.have.any.keys('x-token', 'x-admin-key');
        const claims = forwardedClaims();
        expect(claims).to.include({ external: true });
        expect(claims).to.not.have.any.keys('jti', 'isAdmin');
        expect(claims.user).to.include({ _id: applicant._id });
        expect(claims.user.roles).to.deep.equal(['agent']);
        expect(request.body.owner).to.equal(applicant._id);
        // The agent decided the owned field; the client's value never reached Form.io as theirs.
        expect(request.body.metadata.uag.decisions).to.have.property('status');
    });

    it('runs the task before the save as the caller, not the agent', async () => {
        await start([{ type: 'create_all', roles: ['agent'] }], { 'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['applicant'] }) });
        const service = formflow(server.uagProject!);
        const runTaskOriginal = service.runTask.bind(service);
        let ranAs: any = null;
        (service as any).runTask = (form: any, task: any, submission: any, auth: any, options: any) => {
            ranAs = auth;
            return runTaskOriginal(form, task, submission, auth, options);
        };
        await submit(tokenFor(applicant));
        expect(ranAs.user._id).to.equal(applicant._id);
        expect(ranAs.user.roles).to.deep.equal(['applicant']);
    });

    it('creates for an anonymous submitter with no owner', async () => {
        await start([{ type: 'create_all', roles: ['agent'] }], { 'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['anonymous'] }) });
        const res = await submit();
        expect(res.status, res.text).to.equal(201);
        expect(forwardedClaims().user._id).to.equal('external');
        expect(forwarded()[0].body.owner ?? null).to.equal(null);
    });

    it('refuses a caller who is not a submitter, creating nothing', async () => {
        await start([{ type: 'create_all', roles: ['agent'] }], { 'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['reviewer'] }) });
        const res = await submit(tokenFor(applicant));
        expect(res.status).to.equal(403);
        expect(forwarded()).to.deep.equal([]);
    });

    it('refuses when the agent role may not create submissions', async () => {
        await start([], { 'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['applicant'] }) });
        const res = await submit(tokenFor(applicant));
        expect(res.status).to.equal(403);
        expect(forwarded()).to.deep.equal([]);
    });

    it('refuses, as a configuration error, actions that name different agent roles', async () => {
        await start([{ type: 'create_all', roles: ['agent', 'other'] }], {
            'application:admissions': runTask({ agentRole: 'agent', submitterRoles: ['applicant'] }),
            'application:second': runTask({ agentRole: 'other', submitterRoles: ['applicant'] }, 'Second')
        });
        const errors: string[] = [];
        const original = console.error;
        console.error = (...args: any[]) => { errors.push(args.join(' ')); };
        try {
            const res = await submit(tokenFor(applicant));
            expect(res.status).to.equal(500);
        }
        finally {
            console.error = original;
        }
        expect(errors.join('\n')).to.contain('Admissions').and.contain('Second');
        expect(forwarded()).to.deep.equal([]);
    });

    it('offers the project\'s roles, without admin roles, for the agent and the submitters', async () => {
        await start([], {});
        const res = await request().get(`/form/${formio.formIds.application}/actions/agentRunTask`).set('x-admin-key', 'admin-key');
        const components = JSON.stringify(res.body.settingsForm?.components || []);
        expect(components).to.contain('"key":"agentRole"').and.contain('"key":"submitterRoles"').and.contain('Agent');
        expect(components).to.not.contain('Administrator');
    });
});
