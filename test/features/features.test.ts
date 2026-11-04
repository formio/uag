import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { defineEngine } from '@formio/uag-sdk';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, start, Started } from '../characterization/harness';
import { events } from '../documents/fixture';
import { resolveFeatureSettings } from '../../src/features';

const SCRIPT = path.join(__dirname, 'fixtures', 'sample-component.js');
const STYLE = path.join(__dirname, 'fixtures', 'sample-component.css');
const OTHER = path.join(__dirname, 'fixtures', 'other-component.js');

/** What the test feature and engine saw. */
const seen: { initialized: any[]; generated: number } = { initialized: [], generated: 0 };

/** An engine type other than the built-in stubs: it runs under the license. */
const writer = defineEngine({
    type: 'engine', name: 'writer', kinds: ['agent'], apiVersion: 1,
    create: ({ name }) => ({
        name, kind: 'agent', model: 'writer-1', accepts: ['text'],
        extract: async () => ({ model: 'writer-1', values: {} }),
        async generate() { seen.generated++; return { text: 'written', model: 'writer-1', stopReason: 'end' }; }
    })
});

/** A feature module: settings, four form routes, a component, a plugin type of its own. */
function sampleFeature(overrides: any = {}) {
    return {
        extra: 'features/sample',
        pluginTypes: [{ type: 'samplething', title: 'Sample thing', apiVersions: [1], editForm: 'none', unavailable: 'disable', stability: 'experimental', validate: () => [] }],
        uag: {
            name: 'sample', title: 'Sample', version: '1.2.3', apiVersion: 1,
            settings: {
                key: 'sample',
                defaults: { greeting: 'Hello', limit: 2, loud: false },
                env: { greeting: 'SAMPLE_GREETING', limit: 'SAMPLE_LIMIT', loud: 'SAMPLE_LOUD' },
                validate: (settings: any) => (settings.limit >= 1 ? [] : ['limit: must be at least 1'])
            },
            routes: {
                form: {
                    'POST /sample/echo': {
                        name: 'sample',
                        handler(req: any, res: any, api: any) {
                            api.requireAccess(req.auth, req.form, ['create']);
                            if (req.body?.refuse) throw api.errors.create(415, '"a.zip" is not accepted.', 'unsupported_file');
                            if (req.body?.crash) throw new Error('a secret detail');
                            return { greeting: api.settings.greeting, form: req.form.form.name, requestId: req.requestId };
                        }
                    },
                    'POST /sample/stream': {
                        name: 'sample', stream: true, heartbeatMs: 1000,
                        handler: async (req: any, res: any, api: any) => {
                            if (req.body?.refuse) throw api.errors.create(400, 'Send something.', 'bad_request');
                            return async ({ progress }: any) => {
                                progress(0.5, 'Half way');
                                if (req.body?.fail) throw api.errors.create(422, 'It did not work.', 'process_failed');
                                return { done: true };
                            };
                        }
                    },
                    'POST /sample/generate': {
                        name: 'sample',
                        handler: async (req: any, res: any, api: any) => {
                            const engine = api.engines.select({ needs: ['text'] });
                            const answer = await api.engines.generate(engine, { instructions: 'Write.', format: 'markdown', attachments: [] });
                            return { text: answer.text, engine: engine.name };
                        }
                    },
                    'POST /sample/read': {
                        name: 'sample',
                        handler: async (req: any, res: any, api: any) => {
                            try {
                                const bytes = await api.files.read(req.form, req.body.file, req.auth, { component: api.forms.componentAt(req.form, 'files') });
                                return { bytes: bytes ? bytes.length : null };
                            }
                            catch (err: any) {
                                throw api.errors.create(422, err.message, 'file_unreadable');
                            }
                        }
                    }
                }
            },
            components: [{ type: 'uagsample', script: SCRIPT, style: STYLE }],
            initialize: (api: any) => { seen.initialized.push({ ...api.settings }); },
            ...overrides
        }
    };
}

const notesForm = {
    title: 'Notes', type: 'form', name: 'notes', path: 'notes', tags: ['uag'],
    components: [
        { type: 'file', key: 'files', input: true, storage: 's3' },
        { type: 'textfield', key: 'name', label: 'Name', input: true }
    ],
    access: [{ type: 'read_all', roles: ['anonymous', 'authenticated'] }],
    submissionAccess: [{ type: 'create_own', roles: ['authenticated'] }]
};

describe('Features', function () {
    this.timeout(30000);
    let started: Started | undefined;
    const env = { ...process.env };
    beforeEach(() => { seen.initialized.length = 0; seen.generated = 0; });
    afterEach(async () => {
        await started?.stop();
        started = undefined;
        for (const key of ['SAMPLE_GREETING', 'SAMPLE_LIMIT', 'SAMPLE_LOUD']) {
            if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
        }
    });

    const launch = (modules: any[], config: any = {}) => start({ forms: { notes: notesForm }, modules, config });
    const admin = { 'x-admin-key': ADMIN_KEY };

    describe('settings', () => {
        it('reads each setting from config, then its environment variable, then its default, as the default\'s type', () => {
            const declared = sampleFeature().uag.settings;
            expect(resolveFeatureSettings(declared, {}, {}).settings).to.deep.equal({ greeting: 'Hello', limit: 2, loud: false });
            expect(resolveFeatureSettings(declared, {}, { SAMPLE_LIMIT: '5', SAMPLE_LOUD: 'true', SAMPLE_GREETING: 'Hi' }).settings).to.deep.equal({ greeting: 'Hi', limit: 5, loud: true });
            expect(resolveFeatureSettings(declared, { sample: { limit: 9 } }, { SAMPLE_LIMIT: '5' }).settings.limit).to.equal(9);
            expect(resolveFeatureSettings(declared, {}, { SAMPLE_LIMIT: 'many' }).problems).to.deep.equal(['limit: SAMPLE_LIMIT must be a number']);
            expect(resolveFeatureSettings(declared, {}, { SAMPLE_LIMIT: '0' }).problems).to.deep.equal(['limit: must be at least 1']);
        });

        it('initializes the feature with its resolved settings at startup', async () => {
            process.env.SAMPLE_GREETING = 'Bonjour';
            started = await launch([sampleFeature()], { sample: { limit: 3 } });
            expect(seen.initialized).to.deep.equal([{ greeting: 'Bonjour', limit: 3, loud: false }]);
        });

        it('stops startup for an invalid setting, naming the feature and the setting', async () => {
            process.env.SAMPLE_LIMIT = '0';
            let message = '';
            await launch([sampleFeature()]).then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('Feature sample (features/sample) has invalid settings: limit: must be at least 1');
        });
    });

    describe('declaring features', () => {
        it('refuses a feature API this UAG does not provide', async () => {
            let message = '';
            await launch([sampleFeature({ apiVersion: 2 })]).then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('Feature sample (features/sample) needs feature API 2; this UAG provides 1');
        });

        it('sets up a feature used twice once, with its plugin type registered once', async () => {
            const feature = sampleFeature();
            started = await launch([feature, feature]);
            const plugins = (await started.request().get('/plugins').set(admin)).body;
            expect(plugins.filter((plugin: any) => plugin.type === 'feature')).to.have.length(1);
            expect(seen.initialized).to.have.length(1);
        });

        it('stops startup when two features claim one route, or one component type', async () => {
            const other = (uag: any) => ({ extra: 'features/other', uag: { name: 'other', apiVersion: 1, ...uag } });
            let message = '';
            await launch([sampleFeature(), other({ routes: { form: { 'POST /sample/echo': { name: 'x', handler: () => ({}) } } } })])
                .then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('The form route "POST /sample/echo" is claimed by two features: sample (features/sample) and other (features/other)');
            message = '';
            await launch([sampleFeature(), other({ components: [{ type: 'uagsample', script: OTHER }] })])
                .then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('The component type "uagsample" is claimed by two features: sample (features/sample) and other (features/other)');
        });

        it('lists the feature, its components and its routes, and no settings', async () => {
            process.env.SAMPLE_GREETING = 'a secret greeting';
            started = await launch([sampleFeature()]);
            const plugins = (await started.request().get('/plugins').set(admin)).body;
            const feature = plugins.find((plugin: any) => plugin.type === 'feature' && plugin.name === 'sample');
            expect(feature).to.include({ title: 'Sample', version: '1.2.3', apiVersion: 1 });
            expect(feature.components).to.deep.equal(['uagsample']);
            expect(feature.routes).to.deep.equal(['POST /sample/echo', 'POST /sample/stream', 'POST /sample/generate', 'POST /sample/read']);
            expect(JSON.stringify(plugins)).to.not.include('a secret greeting');
        });
    });

    describe('form routes', () => {
        it('answers on the form by path and by id, with the request id, behind the caller check', async () => {
            started = await launch([sampleFeature()]);
            const byPath = await started.request().post('/notes/sample/echo').set(admin).send({});
            expect(byPath.status, byPath.text).to.equal(200);
            expect(byPath.body).to.include({ greeting: 'Hello', form: 'notes' });
            expect(byPath.body.requestId).to.be.a('string');
            const id = String((started.server.uagProject as any).forms.notes.form._id);
            const byId = await started.request().post(`/form/${id}/sample/echo`).set(admin).send({});
            expect(byId.status, byId.text).to.equal(200);
            const anonymous = await started.request().post('/notes/sample/echo').send({});
            expect(anonymous.status).to.be.oneOf([401, 403]);
        });

        it('answers a feature\'s error with its status and code, and any other error with 500 and no detail', async () => {
            started = await launch([sampleFeature()]);
            const refused = await started.request().post('/notes/sample/echo').set(admin).send({ refuse: true });
            expect(refused.status).to.equal(415);
            expect(refused.body).to.include({ error: '"a.zip" is not accepted.', code: 'unsupported_file' });
            expect(refused.body.requestId).to.be.a('string');
            const crashed = await started.request().post('/notes/sample/echo').set(admin).send({ crash: true });
            expect(crashed.status).to.equal(500);
            expect(crashed.text).to.not.include('a secret detail');
        });

        it('applies the named operation\'s rate limit', async () => {
            started = await launch([sampleFeature()], { agentApi: { rateLimits: { caller: { sample: { limit: 1, windowMs: 60000 } } } } });
            expect((await started.request().post('/notes/sample/echo').set(admin).send({})).status).to.equal(200);
            const limited = await started.request().post('/notes/sample/echo').set(admin).send({});
            expect(limited.status).to.equal(429);
            expect(limited.headers['retry-after']).to.be.a('string');
        });

        it('streams progress and done, answers JSON otherwise, and refuses before streaming with a status', async () => {
            started = await launch([sampleFeature()]);
            const streamed = await started.request().post('/notes/sample/stream').set({ ...admin, Accept: 'text/event-stream' }).send({});
            expect(streamed.headers['content-type']).to.include('text/event-stream');
            expect(events(streamed.text).map((e) => e.event)).to.deep.equal(['progress', 'done']);
            expect(events(streamed.text)[1].data).to.deep.equal({ result: { done: true } });
            const failed = await started.request().post('/notes/sample/stream').set({ ...admin, Accept: 'text/event-stream' }).send({ fail: true });
            const last = events(failed.text).pop()!;
            expect(last.event).to.equal('failed');
            expect(last.data).to.include({ error: 'It did not work.', code: 'process_failed' });
            const plain = await started.request().post('/notes/sample/stream').set(admin).send({});
            expect(plain.body).to.deep.equal({ result: { done: true } });
            const refused = await started.request().post('/notes/sample/stream').set({ ...admin, Accept: 'text/event-stream' }).send({ refuse: true });
            expect(refused.status).to.equal(400);
            expect(refused.body).to.include({ code: 'bad_request' });
        });

        it('refuses a forged stored file value before reading it', async () => {
            started = await launch([sampleFeature()]);
            const before = started.formio.requests.length;
            const res = await started.request().post('/notes/sample/read').set(admin)
                .send({ file: { storage: 's3', bucket: 'someone-elses', key: 'secret.pdf', name: 'secret.pdf', url: 'https://someone-elses.s3.amazonaws.com/secret.pdf' } });
            expect(res.status, res.text).to.equal(422);
            expect(res.body.code).to.equal('file_unreadable');
            expect(started.formio.requests.slice(before).filter((req: any) => /s3|storage/.test(req.url))).to.deep.equal([]);
        });
    });

    describe('engines', () => {
        it('generates under the license with an engine other than the stubs', async function () {
            requireTestLicense(this);
            started = await launch([sampleFeature()], { engines: ['writer'], engineTypes: { writer } });
            const res = await started.request().post('/notes/sample/generate').set(admin).send({});
            expect(res.status, res.text).to.equal(200);
            expect(res.body).to.deep.equal({ text: 'written', engine: 'writer' });
        });

        it('refuses to generate without a license, without calling the engine', async () => {
            started = await launch([sampleFeature()], { license: '', engines: ['writer'], engineTypes: { writer } });
            const res = await started.request().post('/notes/sample/generate').set(admin).send({});
            expect(res.status).to.equal(403);
            expect(res.body.code).to.equal('license_required');
            expect(seen.generated).to.equal(0);
        });
    });

    describe('components', () => {
        it('serves the component, and adds it to uag.use.js, portal.js and the stylesheets', async () => {
            started = await launch([sampleFeature()]);
            const script = fs.readFileSync(SCRIPT, 'utf8');
            const own = await started.request().get('/uag-js/components/uagsample.js');
            expect(own.status).to.equal(200);
            expect(own.headers['content-type']).to.include('application/javascript');
            expect(own.text).to.equal(script);
            expect((await started.request().get('/uag-js/components/uagsample.css')).text).to.equal(fs.readFileSync(STYLE, 'utf8'));
            for (const file of ['uag.use.js', 'portal.js']) {
                const res = await started.request().get(`/uag-js/${file}`);
                expect(res.text, file).to.include(script);
                expect(res.text.indexOf(script), file).to.be.greaterThan(res.text.indexOf('Formio.use(lib.UAG('));
            }
            for (const file of ['uag-js.css', 'portal.css']) {
                expect((await started.request().get(`/uag-js/${file}`)).text, file).to.include('.uag-sample');
            }
        });

        it('serves no component without a feature', async () => {
            started = await launch([]);
            expect((await started.request().get('/uag-js/components/uagsample.js')).status).to.equal(404);
            expect((await started.request().get('/uag-js/portal.js')).text).to.not.include('sample component');
        });
    });
});
