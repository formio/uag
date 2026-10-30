import { expect } from 'chai';
import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defineEngine } from '@formio/uag-sdk';
import { ProjectInterface } from '@formio/appserver';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { issueScopedToken } from '../../src/formflow';
import { userAuth } from '../../src/identity';
import { FakeFormio } from '../helpers/fakeFormio';
import { requireTestLicense, TEST_LICENSE } from './fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * Research with the scoped token the UAG gives an agent engine, as a remote
 * engine server does it: over the UAG's own /mcp, as the caller. A caller
 * signed in with a Form.io token researches with that user's permissions, and a
 * background run researches as the user who submitted.
 */
describe('Research with a scoped token, as the caller', function () {
    this.timeout(20000);
    before(function () { requireTestLicense(this); });

    const SECRET = 'test-secret';
    const PROJECT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const roles = {
        anonymous: { title: 'Anonymous', admin: false, default: true },
        applicant: { title: 'Applicant', admin: false, default: false },
        administrator: { title: 'Administrator', admin: true, default: false },
        reviewer: { title: 'Reviewer', admin: false, default: false }
    };
    const application = {
        title: 'Application', type: 'form', name: 'application', path: 'application', tags: ['uag'],
        components: [
            { type: 'textarea', key: 'essay', label: 'Essay', input: true, properties: { uag: 'review', uagField: 'input' } },
            { type: 'content', key: 'reviewCriteria', input: false, html: '<p>Summarize.</p>', properties: { uag: 'review', uagField: 'criteria', uagTools: 'get_forms' } },
            { type: 'textarea', key: 'summary', label: 'Summary', input: true, properties: { uag: 'review' } }
        ],
        access: [{ type: 'read_all', roles: ['anonymous', 'applicant', 'reviewer'] }],
        submissionAccess: [{ type: 'create_own', roles: ['applicant'] }, { type: 'read_own', roles: ['applicant'] }, { type: 'update_own', roles: ['applicant'] }, { type: 'read_all', roles: ['reviewer'] }, { type: 'update_all', roles: ['reviewer'] }]
    };
    // A form only reviewers may use: research as an applicant must not see it as theirs.
    const review = {
        title: 'Review', type: 'form', name: 'review', path: 'review', tags: ['uag'],
        components: [{ type: 'textfield', key: 'note', label: 'Note', input: true }],
        access: [{ type: 'read_all', roles: ['reviewer'] }],
        submissionAccess: [{ type: 'create_all', roles: ['reviewer'] }]
    };

    type Research = { token?: string; status: 'ok' | 'refused'; forms?: Record<string, boolean>; error?: string };
    let researched: Research[] = [];
    let mcpUrl = '';

    /** An agent engine that researches the way the remote engine server does: over /mcp, with the scoped token. */
    const researcher = defineEngine({
        type: 'researcher',
        kinds: ['agent'],
        apiVersion: 1,
        settings: {},
        create: ({ name }) => ({
            name, kind: 'agent', model: 'researcher-1', toolUse: true,
            async extract(request: any) {
                const entry: Research = { token: request.scopedToken, status: 'refused' };
                researched.push(entry);
                const client = new Client({ name: 'research-test', version: '1.0.0' });
                try {
                    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), {
                        requestInit: { headers: { Authorization: `Bearer ${request.scopedToken}` } }
                    }));
                    const result: any = await client.callTool({ name: 'get_forms', arguments: {} });
                    const text = (result.content || []).map((c: any) => c.text).join('\n');
                    // Each form, and whether its permissions line grants Create.
                    entry.forms = Object.fromEntries(text.split('\n- ').slice(1)
                        .map((block: string) => [block.match(/\(\*\*(\w+)\*\*\)/)?.[1], /\*\*Permissions\*\*: Create/.test(block)]));
                    entry.status = result.isError ? 'refused' : 'ok';
                }
                catch (err: any) {
                    entry.error = err.message;
                }
                finally {
                    await client.close().catch(() => undefined);
                }
                return { model: 'researcher-1', values: { summary: 'Researched.' } };
            }
        })
    });

    let formio: FakeFormio;
    let server: UAGServer;
    let app: express.Express;
    const shared = http.createServer((req, res) => app(req, res));
    before((done) => { shared.listen(0, '127.0.0.1', () => { mcpUrl = `http://127.0.0.1:${(shared.address() as AddressInfo).port}/mcp`; done(); }); });
    after((done) => { shared.close(() => done()); });
    const request = () => supertest(shared);

    const sessionToken = (user: any, expiresIn = 3600) => {
        const token = jwt.sign({ user: { _id: user._id, roles: user.roles }, form: { _id: 'users' }, project: { _id: PROJECT_ID }, jti: `session-${user._id}` }, SECRET, { expiresIn });
        formio.users[token] = user;
        return token;
    };
    const applicant = { _id: '5f0000000000000000000001', roles: ['applicant'], data: { email: 'ada@example.com' } };
    const body = { task: 'review', data: { essay: 'Robotics club captain.' } };

    async function start(actions: Record<string, any> = {}) {
        researched = [];
        formio = new FakeFormio({ roles, forms: { application, review }, actions });
        formio.secret = SECRET;
        await formio.start();
        server = new UAGServer({
            project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
            auth: { adminKey: 'admin-key', secret: SECRET },
            engines: ['researcher'],
            engineTypes: { researcher }
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

    it('researches as a user signed in with a Form.io token, with only their permissions', async () => {
        await start();
        const res = await request().post('/application/agent/generate').set('x-jwt-token', sessionToken(applicant)).send(body);
        expect(res.status, res.text).to.equal(200);
        expect(researched).to.have.length(1);
        expect(researched[0], researched[0].error).to.include({ status: 'ok' });
        // The applicant may create applications and nothing on the reviewers' form.
        expect(researched[0].forms).to.deep.equal({ application: true, review: false });
        // The user's token travels sealed, never readable in the scoped token.
        const claims: any = jwt.decode(researched[0].token!);
        expect(claims).to.include({ admin: false });
        expect(claims.bearer).to.be.a('string');
    });

    it('researches as the submitter in a background run with an agent role', async () => {
        await start({
            'application:review': {
                title: 'Review', name: 'agentRunTask', form: 'application', priority: 20, handler: ['before', 'after'], method: ['create'],
                settings: { task: 'review', answer: 'task', when: 'after', agentRole: 'reviewer' }
            }
        });
        const res = await request().post('/application/submission').set('x-jwt-token', sessionToken(applicant)).send({ data: body.data });
        expect(res.status, res.text).to.equal(201);
        await taskRunner(server.uagProject!).idle();
        expect(researched).to.have.length(1);
        expect(researched[0], researched[0].error).to.include({ status: 'ok' });
        // Research acts as the applicant, never with the agent role (reviewer).
        expect(researched[0].forms).to.deep.equal({ application: true, review: false });
        expect(formio.forwarded('PUT'), 'the run saved').to.have.length(1);
    });

    it('researches as the caller in a run after the save without an agent role', async () => {
        await start({
            'application:review': {
                title: 'Review', name: 'agentRunTask', form: 'application', priority: 20, handler: ['before', 'after'], method: ['create'],
                settings: { task: 'review', answer: 'task', when: 'after' }
            }
        });
        const res = await request().post('/application/submission').set('x-jwt-token', sessionToken(applicant)).send({ data: body.data });
        expect(res.status, res.text).to.equal(201);
        await taskRunner(server.uagProject!).idle();
        expect(researched).to.have.length(1);
        expect(researched[0], researched[0].error).to.include({ status: 'ok' });
        expect(researched[0].forms).to.deep.equal({ application: true, review: false });
        expect(formio.forwarded('PUT'), 'the run saved').to.have.length(1);
    });

    it('keeps a token the UAG signed for a run as it is, so Form.io takes its roles from it', async () => {
        await start();
        const project: any = server.uagProject;
        // A submitter with an admin role researches with their other roles only.
        const research = await userAuth(project, { _id: applicant._id, roles: ['applicant', 'administrator'] }, { action: 'Review', task: 'review' });
        const auth = await project.formioTokenAuth(project.provider('auth.pkce'), research.token);
        expect(auth.token, 'signed again').to.equal(research.token);
        expect(auth.admin).to.equal(false);
        expect((jwt.decode(auth.token) as any).user.roles).to.deep.equal(['applicant']);
    });

    it('refuses a Form.io token on /mcp that no scoped token carries', async () => {
        await start();
        const token = sessionToken(applicant);
        for (const headers of [{ Authorization: `Bearer ${token}` }, { 'x-jwt-token': token }]) {
            const res = await request().post('/mcp').set(headers).set('Accept', 'application/json, text/event-stream')
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_forms', arguments: {} } });
            expect(res.status, JSON.stringify(headers)).to.equal(401);
        }
    });

    it('refuses a scoped token whose user token has expired', async () => {
        await start();
        const expired = jwt.sign({ user: { _id: applicant._id, roles: applicant.roles }, project: { _id: PROJECT_ID }, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
        const scoped = issueScopedToken(server.uagProject as any, { admin: false, bearer: expired }, [{ name: 'get_forms', readOnly: true }], 5000)!;
        const res = await request().post('/mcp').set('Authorization', `Bearer ${scoped}`).set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_forms', arguments: {} } });
        expect(res.status).to.equal(401);
    });

    it('refuses a scoped token whose user token belongs to another project', async () => {
        await start();
        const other = jwt.sign({ user: { _id: applicant._id, roles: applicant.roles, project: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, project: { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' } }, SECRET, { expiresIn: 600 });
        const scoped = issueScopedToken(server.uagProject as any, { admin: false, bearer: other }, [{ name: 'get_forms', readOnly: true }], 5000)!;
        const res = await request().post('/mcp').set('Authorization', `Bearer ${scoped}`).set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_forms', arguments: {} } });
        expect(res.status).to.equal(401);
    });

    const mcpWith = (bearer: string) => {
        const scoped = issueScopedToken(server.uagProject as any, { admin: false, bearer }, [{ name: 'get_forms', readOnly: true }], 5000)!;
        return request().post('/mcp').set('Authorization', `Bearer ${scoped}`).set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_forms', arguments: {} } });
    };

    it('refuses a signed user token in a scoped token that names no project', async () => {
        await start();
        for (const project of [undefined, { _id: '' }]) {
            const token = jwt.sign({ external: true, user: { _id: 'x1', roles: applicant.roles }, ...(project && { project }) }, SECRET, { expiresIn: 600 });
            const res = await mcpWith(token);
            expect(res.status, JSON.stringify(project)).to.equal(401);
        }
    });

    it('refuses a session token whose user Form.io places in another project', async () => {
        await start();
        const token = sessionToken({ ...applicant, _id: '5f0000000000000000000008', project: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
        const res = await mcpWith(token);
        expect(res.status).to.equal(401);
        // The same user in this project is accepted.
        const own = await mcpWith(sessionToken({ ...applicant, _id: '5f0000000000000000000009', project: String((server.uagProject as any).project._id) }));
        expect(own.status, own.text).to.equal(200);
    });
});
