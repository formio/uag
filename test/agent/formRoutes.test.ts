import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { ProjectInterface } from '@formio/appserver';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { AGENT_BODY_LIMIT } from '../../src/agent/router';
import { FakeFormio } from '../helpers/fakeFormio';
import { requireTestLicense, TEST_LICENSE } from './fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * A form's agent operations on the UAG itself: under the form's path and id,
 * behind the project's own authentication, so a Form.io user token and a
 * portal team member's remote token work as they do for submissions.
 */
describe('Agent operations on the form\'s routes', function () {
    this.timeout(20000);
    before(function () { requireTestLicense(this); });

    const SECRET = 'test-secret';
    const PORTAL = 'portal-secret';
    const PROJECT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const roles = {
        anonymous: { title: 'Anonymous', admin: false, default: true },
        applicant: { title: 'Applicant', admin: false, default: false },
        reader: { title: 'Reader', admin: false, default: false }
    };
    const application = {
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
        access: [{ type: 'read_all', roles: ['anonymous', 'applicant', 'reader'] }],
        submissionAccess: [{ type: 'create_own', roles: ['applicant'] }, { type: 'read_all', roles: ['reader'] }]
    };
    const runTask = {
        title: 'Admissions', name: 'agentRunTask', form: 'application', priority: 20, handler: ['before', 'after'], method: ['create'],
        settings: { task: 'admissions', answer: 'decisions', when: 'before' }
    };

    let formio: FakeFormio;
    let server: UAGServer;
    let app: express.Express;
    let current: express.Express | null = null;
    const shared = http.createServer((req, res) => current!(req, res));
    before((done) => { shared.listen(0, '127.0.0.1', done); });
    after((done) => { shared.close(() => done()); });
    const request = () => { current = app; return supertest(shared); };

    const tokenFor = (user: any) => {
        const token = jwt.sign({ user: { _id: user._id, roles: user.roles }, form: { _id: 'users' }, project: { _id: PROJECT_ID }, jti: `session-${user._id}` }, SECRET, { expiresIn: 3600 });
        formio.users[token] = user;
        return token;
    };
    const applicant = { _id: '5f0000000000000000000001', roles: ['applicant'], data: {} };
    const reader = { _id: '5f0000000000000000000002', roles: ['reader'], data: {} };
    const member = (permission: string) => jwt.sign({ user: { _id: 'member1', data: {}, created: '2026-01-01T00:00:00.000Z' }, project: { _id: PROJECT_ID }, permission }, PORTAL, { expiresIn: 600 });
    const body = { data: { essay: 'Robotics club captain.' } };

    async function start(settings: any = {}, form: any = application) {
        formio = new FakeFormio({ roles, forms: { application: form }, actions: { 'application:admissions': { ...runTask, settings: { ...runTask.settings, ...settings } } } });
        formio.secret = SECRET;
        await formio.start();
        server = new UAGServer({
            project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
            auth: { adminKey: 'admin-key', secret: SECRET, portal: PORTAL },
            engines: ['stub-decision']
        } as any);
        await server.initialize();
        app = express();
        app.use(await server.router());
    }

    async function stop() {
        if (server?.uagProject) await taskRunner(server.uagProject).idle();
        (server?.uagProject as any)?.destroy?.();
        ProjectInterface.module = undefined;
        await formio?.stop();
    }

    beforeEach(() => start());

    afterEach(() => stop());

    it('decides for a Form.io user token, by path and by id, with the same answer', async () => {
        const token = tokenFor(applicant);
        const byPath = await request().post('/application/agent/decide').set('x-jwt-token', token).send(body);
        expect(byPath.status, byPath.text).to.equal(200);
        const byId = await request().post(`/form/${formio.formIds.application}/agent/decide`).set('x-jwt-token', token).send(body);
        expect(byId.status, byId.text).to.equal(200);
        expect(byId.body.tasks).to.deep.equal(byPath.body.tasks).and.deep.equal(['admissions']);
        expect(Object.keys(byId.body.fields)).to.deep.equal(Object.keys(byPath.body.fields));
    });

    it('refuses a user who may only read the form\'s submissions', async () => {
        const res = await request().post('/application/agent/extract').set('x-jwt-token', tokenFor(reader)).send(body);
        expect(res.status, res.text).to.equal(403);
    });

    it('no longer answers the operations at the root', async () => {
        const token = tokenFor(applicant);
        for (const operation of ['extract', 'decide', 'generate']) {
            const res = await request().post(`/agent/${operation}`).set('x-jwt-token', token).send({ form: 'application', ...body });
            expect(res.status, operation).to.equal(404);
        }
    });

    it('answers 404 for an administrator\'s operation on no form, passing nothing to Form.io', async () => {
        formio.requests = [];
        for (const path of ['/agent/decide', '/nope/agent/decide', '/nope/Agent/Decide', '/NOPE/AGENT/EXTRACT', '/form/0000000000000000000000ff/agent/extract', '/form/0000000000000000000000ff/Agent/extract', '/nope/agent/chat']) {
            const res = await request().post(path).set('x-admin-key', 'admin-key').send({ form: 'application', ...body });
            expect(res.status, path).to.equal(404);
        }
        expect(formio.requests.filter((req) => /agent/i.test(req.url)), 'forwarded').to.have.length(0);
    });

    it('answers the operations of a form named in another case, as its routes do', async () => {
        const res = await request().post('/Application/Agent/Decide').set('x-jwt-token', tokenFor(applicant)).send(body);
        expect(res.status, res.text).to.equal(200);
    });

    it('refuses a body over the agent operations\' limit, though the server takes larger bodies', async () => {
        const res = await request().post('/application/agent/decide').set('x-jwt-token', tokenFor(applicant))
            .send({ data: { essay: 'x'.repeat(AGENT_BODY_LIMIT + 1) } });
        expect(res.status, res.text.slice(0, 200)).to.equal(413);
    });

    it('lets a portal team writer use the operations, and refuses readers and team access', async () => {
        const write = await request().post('/application/agent/decide').set('x-remote-token', member('team_write')).send(body);
        expect(write.status, write.text).to.equal(200);
        for (const permission of ['team_read', 'team_access']) {
            const res = await request().post('/application/agent/decide').set('x-remote-token', member(permission)).send(body);
            expect(res.status, permission).to.equal(401);
        }
    });

    it('runs Run task on a team writer\'s submission, forwarded with the project credential', async () => {
        const res = await request().post('/application/submission').set('x-remote-token', member('team_write')).send({ data: { ...body.data, status: 'accepted' } });
        expect(res.status, res.text).to.equal(201);
        const forwarded = formio.forwarded('POST');
        expect(forwarded).to.have.length(1);
        expect(forwarded[0].headers['x-admin-key']).to.equal('admin-key');
        expect(forwarded[0].headers).to.not.have.property('x-remote-token');
        // The task decided the owned field before the save.
        expect(forwarded[0].body.metadata.uag.decisions).to.have.property('status');
    });

    it('saves a team writer\'s run after the save with the project credential', async () => {
        await stop();
        await start({ answer: 'task', when: 'after' });
        const res = await request().post('/application/submission').set('x-remote-token', member('team_write')).send(body);
        expect(res.status, res.text).to.equal(201);
        await taskRunner(server.uagProject!).idle();
        const updates = formio.forwarded('PUT');
        expect(updates).to.have.length(1);
        expect(updates[0].headers['x-admin-key']).to.equal('admin-key');
        expect(updates[0].body.data).to.have.property('status');
    });

    it('treats a portal owner\'s remote token as an administrator, from a browser too', async () => {
        const res = await request().post('/application/agent/decide').set('x-remote-token', member('owner')).set('Origin', 'https://portal.example.com').send(body);
        expect(res.status, res.text).to.equal(200);
    });

    it('lets anonymous visitors use a form that opts in and lets Anonymous create, and no other', async () => {
        const anonymousForm = (submissionAccess: any[]) => ({ ...application, properties: { uagAnonymous: 'true' }, submissionAccess });
        await stop();
        await start({}, anonymousForm([{ type: 'create_own', roles: ['anonymous'] }]));
        const allowed = await request().post('/application/agent/decide').send(body);
        expect(allowed.status, allowed.text).to.equal(200);
        await stop();
        await start({}, anonymousForm([{ type: 'create_own', roles: ['applicant'] }]));
        const noCreate = await request().post('/application/agent/decide').send(body);
        expect(noCreate.status, noCreate.text).to.equal(403);
        await stop();
        await start({}, { ...application, submissionAccess: [{ type: 'create_own', roles: ['anonymous'] }] });
        const noOptIn = await request().post('/application/agent/decide').send(body);
        expect(noOptIn.status, noOptIn.text).to.equal(401);
    });

    it('refuses a team reader\'s submission, forwarding nothing', async () => {
        const res = await request().post('/application/submission').set('x-remote-token', member('team_read')).send(body);
        expect(res.status).to.equal(401);
        expect(formio.forwarded('POST')).to.have.length(0);
    });
});
