import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import { ProjectInterface } from '@formio/appserver';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { FakeFormio } from '../helpers/fakeFormio';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * The Agent API's one error shape, through the whole server: every refusal of a
 * form's agent operation or of /agent/capabilities is JSON
 * `{ requestId, error, code }` with the same id in X-Request-Id, whichever part
 * of the server refused it. The project's Form.io routes keep Form.io's answers.
 */
describe('Agent API errors, through the whole server', function () {
    this.timeout(20000);

    let formio: FakeFormio;
    let server: UAGServer;
    let app: express.Express;
    let current: express.Express | null = null;
    const shared = http.createServer((req, res) => current!(req, res));
    before((done) => { shared.listen(0, '127.0.0.1', done); });
    after((done) => { shared.close(() => done()); });
    const request = () => { current = app; return supertest(shared); };

    before(async () => {
        formio = new FakeFormio({
            forms: {
                claim: {
                    title: 'Claim', type: 'form', name: 'claim', path: 'claim', tags: ['uag'],
                    components: [
                        { type: 'textarea', key: 'description', label: 'Description', input: true, properties: { uag: 'triage', uagField: 'input' } },
                        { type: 'radio', key: 'kind', label: 'Kind', input: true, values: [{ label: 'A', value: 'a' }], properties: { uag: 'triage' } }
                    ]
                }
            }
        });
        await formio.start();
        server = new UAGServer({
            project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1,
            auth: { adminKey: 'admin-key', secret: 'test-secret' },
            engines: ['stub-decision']
        } as any);
        await server.initialize();
        app = express();
        app.use(await server.router());
    });

    after(async () => {
        if (server?.uagProject) await taskRunner(server.uagProject).idle();
        (server?.uagProject as any)?.destroy?.();
        ProjectInterface.module = undefined;
        await formio?.stop();
    });

    function shaped(res: any, status: number, code: string) {
        expect(res.status, res.text).to.equal(status);
        expect(res.headers['content-type']).to.match(/application\/json/);
        expect(res.body.code, res.text).to.equal(code);
        expect(res.body.error).to.be.a('string').and.not.equal('');
        expect(res.body.requestId).to.be.a('string').and.equal(res.headers['x-request-id']);
        expect(res.body).to.not.have.property('detail');
    }

    it('answers a Form.io token the project refuses (plain text from its authentication) in the shape', async () => {
        shaped(await request().post('/claim/agent/decide').set('x-jwt-token', 'expired-or-unknown').send({ data: {} }), 401, 'unauthorized');
    });

    it('answers a body that is not JSON in the shape, not as an HTML page', async () => {
        const res = await request().post('/claim/agent/decide').set('x-admin-key', 'admin-key').set('Content-Type', 'application/json').send('{"data": ');
        shaped(res, 400, 'invalid_request');
        expect(res.body.error).to.equal('The request body is not valid JSON.');
    });

    it('answers a form the project does not have, a missing credential and a wrong key in the shape', async () => {
        shaped(await request().post('/nope/agent/decide').set('x-admin-key', 'admin-key').send({ data: {} }), 404, 'form_not_found');
        shaped(await request().post('/claim/agent/decide').send({ data: {} }), 401, 'sign_in_required');
        shaped(await request().get('/agent/capabilities').set('x-admin-key', 'wrong'), 401, 'unauthorized');
    });

    it('answers a refusal from inside the operation in the shape, keeping the caller\'s request id', async () => {
        const res = await request().post('/claim/agent/decide').set('x-admin-key', 'admin-key').set('X-Request-Id', 'abc-123').send({ task: 'nope', data: {} });
        shaped(res, 400, 'invalid_request');
        expect(res.body.requestId).to.equal('abc-123');
    });

    it('carries the request id on success too', async () => {
        const res = await request().get('/agent/capabilities').set('x-admin-key', 'admin-key');
        expect(res.status, res.text).to.equal(200);
        expect(res.body.requestId).to.equal(res.headers['x-request-id']);
    });

    it('leaves the project\'s Form.io routes as Form.io answers them', async () => {
        const res = await request().post('/claim/submission').set('x-jwt-token', 'expired-or-unknown').send({ data: {} });
        expect(res.status).to.equal(401);
        expect(res.headers['content-type']).to.not.match(/application\/json/);
        expect(res.headers).to.not.have.property('x-request-id');
    });
});
