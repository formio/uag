import { expect } from 'chai';
import supertest from 'supertest';
import { createTestModuleApi, mountModuleRoutes, testAuth, testForm } from '../../src/testing';

/** A module as an author writes one: settings, a plain route, a streamed route, and an engine call. */
const counter: any = {
    name: 'counter', apiVersion: 1, host: 'uag',
    settings: (config: any, env: any) => ({ max: Number(config.counter?.max ?? env.COUNTER_MAX ?? 10) }),
    pluginTypes: (api: any) => [{ type: 'counted', title: 'Counted', apiVersions: [1], editForm: 'none', unavailable: 'disable', stability: 'experimental', validate: () => [], manifest: () => ({ by: api.name }) }],
    routes: {
        form: {
            'POST /counter/count': {
                handler(req: any, res: any, api: any) {
                    const component = api.forms.componentAt(req.form, req.body?.path);
                    if (!component) throw api.errors.create(404, `No component at "${req.body?.path}".`, 'component_not_found');
                    const words = String(req.body?.text || '').split(/\s+/).filter(Boolean).length;
                    if (words > api.settings.max) throw api.errors.create(413, `At most ${api.settings.max} words.`, 'too_many_words');
                    return { words, form: req.form.name, requestId: req.requestId };
                }
            },
            'POST /counter/stream': {
                handler: (req: any, res: any, api: any) => api.stream(req, res, async ({ progress }: any) => {
                    progress(0.5, 'Half way');
                    const engine = api.engines.select({ needs: ['text'] });
                    return (await engine.generate({ instructions: 'Count.' })).text;
                })
            },
            'POST /counter/read': {
                async handler(req: any, res: any, api: any) {
                    const bytes = await api.files.read(req.form, req.body.file, req.auth, { component: api.forms.componentByKey(req.form, 'files') });
                    return { text: bytes?.toString('utf8') };
                }
            }
        }
    }
};

const form = testForm({ _id: 'f1', name: 'notes', path: 'notes', title: 'Notes', components: [{ type: 'textarea', key: 'text' }, { type: 'file', key: 'files', storage: 'base64' }] });
const writer = { name: 'writer', generate: async () => ({ text: 'written' }) };

describe('The module test kit (@formio/uag/testing)', () => {
    it('resolves the settings as the server does, from the configuration and the environment', async () => {
        expect((await createTestModuleApi(counter)).settings).to.deep.equal({ max: 10 });
        expect((await createTestModuleApi(counter, { env: { COUNTER_MAX: '3' } })).settings).to.deep.equal({ max: 3 });
        const api = await createTestModuleApi(counter, { config: { counter: { max: 2 } } });
        expect(api.settings).to.deep.equal({ max: 2 });
        expect(Object.isFrozen(api.settings)).to.equal(true);
        expect(api.host.name).to.equal('uag');
    });

    it('builds the module\'s plugin types from its API', async () => {
        const api = await createTestModuleApi(counter, { plugins: [{ type: 'counted', name: 'one', title: 'One', version: '1.0.0', apiVersion: 1 }] });
        expect(api.plugins.list('counted').map((plugin: any) => plugin.name)).to.deep.equal(['one']);
    });

    it('mounts the routes by the form\'s path and id, with the access check and the UAG\'s error shape', async () => {
        const app = await mountModuleRoutes(counter, { form, config: { counter: { max: 2 } } });
        const counted = await supertest(app).post('/notes/counter/count').send({ path: 'text', text: 'one two' });
        expect(counted.status).to.equal(200);
        expect(counted.body).to.include({ words: 2, form: 'notes' });
        expect(counted.body.requestId).to.be.a('string');
        expect((await supertest(app).post('/form/f1/counter/count').send({ path: 'text', text: 'one' })).body.words).to.equal(1);
        const refused = await supertest(app).post('/notes/counter/count').send({ path: 'text', text: 'one two three' });
        expect(refused.status).to.equal(413);
        expect(refused.body).to.include({ error: 'At most 2 words.', code: 'too_many_words' });
        const reader = await mountModuleRoutes(counter, { form, auth: testAuth({ permissions: ['read'] }) });
        expect((await supertest(reader).post('/notes/counter/count').send({ path: 'text' })).status).to.equal(403);
        const readerObject = await mountModuleRoutes(counter, { form, auth: testAuth({ permissions: { read: true } }) });
        expect((await supertest(readerObject).post('/notes/counter/count').send({ path: 'text' })).status).to.equal(403);
    });

    it('streams progress and the result through an engine handle, and refuses without a license', async () => {
        const app = await mountModuleRoutes(counter, { form, engines: [writer] });
        const streamed = await supertest(app).post('/notes/counter/stream').set('Accept', 'text/event-stream').send({});
        expect(streamed.text).to.equal('event: progress\ndata: {"progress":0.5,"message":"Half way"}\n\nevent: done\ndata: {"result":"written"}\n\n');
        expect((await supertest(app).post('/notes/counter/stream').send({})).body).to.deep.equal({ result: 'written' });
        const unlicensed = await mountModuleRoutes(counter, { form, engines: [writer], licensed: false });
        const failed = await supertest(unlicensed).post('/notes/counter/stream').set('Accept', 'text/event-stream').send({});
        expect(failed.text).to.match(/event: failed\ndata: \{"status":403,"requestId":"[^"]+","error":"[^"]+","code":"license_required"\}/);
    });

    it('reads base64 files, and others through "files"', async () => {
        const file = { storage: 'base64', name: 'a.txt', url: `data:text/plain;base64,${Buffer.from('hello').toString('base64')}` };
        const app = await mountModuleRoutes(counter, { form });
        expect((await supertest(app).post('/notes/counter/read').send({ file })).body).to.deep.equal({ text: 'hello' });
        const stored = { storage: 's3', name: 'b.txt', key: 'b.txt' };
        const refused = await supertest(app).post('/notes/counter/read').send({ file: stored });
        expect(refused.status).to.equal(500);
        const files = (value: any) => Buffer.from(`stored ${value.key}`);
        const mounted = await mountModuleRoutes(counter, { form, files });
        expect((await supertest(mounted).post('/notes/counter/read').send({ file: stored })).body).to.deep.equal({ text: 'stored b.txt' });
        const api = await createTestModuleApi(counter, { files });
        expect(String(await api.files.read(form, stored, testAuth(), {}))).to.equal('stored b.txt');
        expect(String(await api.files.read(form, file, testAuth(), {}))).to.equal('hello');
        const own = testForm({ _id: 'f2', name: 'own', path: 'own', components: [] }, { files: () => Buffer.from('own') });
        expect(String(await api.files.read(own, stored, testAuth(), {}))).to.equal('own');
    });
});
