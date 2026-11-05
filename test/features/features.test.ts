import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { defineEngine } from '@formio/uag-sdk';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, start, Started } from '../characterization/harness';
import { events } from '../documents/fixture';

const SCRIPT = path.join(__dirname, 'fixtures', 'sample-component.js');
const STYLE = path.join(__dirname, 'fixtures', 'sample-component.css');
const OTHER = path.join(__dirname, 'fixtures', 'other-component.js');

/** What the test feature and engine saw. */
const seen: { initialized: any[]; ready: any[]; generated: number } = { initialized: [], ready: [], generated: 0 };

/** An engine type other than the built-in stubs: it runs under the license. */
const writer = defineEngine({
    type: 'engine', name: 'writer', kinds: ['agent'], apiVersion: 1,
    create: ({ name }) => ({
        name, kind: 'agent', model: 'writer-1', accepts: ['text'],
        extract: async () => ({ model: 'writer-1', values: {} }),
        async generate() { seen.generated++; return { text: 'written', model: 'writer-1', stopReason: 'end' }; }
    })
});

/** The sample feature's settings: config.sample, then SAMPLE_* variables, then defaults. */
function sampleSettings(config: any, env: any) {
    const given = config.sample || {};
    const limit = Number(given.limit ?? env.SAMPLE_LIMIT ?? 2);
    if (!(limit >= 1)) throw new Error('limit: must be at least 1');
    return { greeting: given.greeting ?? env.SAMPLE_GREETING ?? 'Hello', limit, loud: String(given.loud ?? env.SAMPLE_LOUD ?? false) === 'true' };
}

/** A feature module: settings, four form routes, a component, a plugin type of its own. */
function sampleFeature(overrides: any = {}) {
    return {
        extra: 'features/sample',
        pluginTypes: [{ type: 'samplething', title: 'Sample thing', apiVersions: [1], editForm: 'none', unavailable: 'disable', stability: 'experimental', validate: () => [] }],
        uag: {
            name: 'sample', title: 'Sample', version: '1.2.3', apiVersion: 1,
            settings: sampleSettings,
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
                        name: 'sample',
                        handler: async (req: any, res: any, api: any) => {
                            if (req.body?.refuse) throw api.errors.create(400, 'Send something.', 'bad_request');
                            return api.stream(req, res, async ({ progress }: any) => {
                                progress(0.5, 'Half way');
                                if (req.body?.fail) throw api.errors.create(422, 'It did not work.', 'process_failed');
                                return { done: true };
                            }, { heartbeatMs: 1000 });
                        }
                    },
                    'POST /sample/generate': {
                        name: 'sample',
                        handler: async (req: any, res: any, api: any) => {
                            const engine = api.engines.select({ needs: ['text'] });
                            const answer = await engine.generate({ instructions: 'Write.', format: 'markdown', attachments: [] });
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
            initialize: (api: any) => {
                seen.initialized.push({ ...api.settings });
                seen.ready.push({ converters: api.converters.list().length > 0, engine: (() => { try { return api.engines.select({ needs: ['text'] }).name; } catch (err: any) { return err.message; } })() });
            },
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
    beforeEach(() => { seen.initialized.length = 0; seen.ready.length = 0; seen.generated = 0; });
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
        it('gives the feature what its settings function returns, from the configuration and the environment', () => {
            expect(sampleSettings({}, {})).to.deep.equal({ greeting: 'Hello', limit: 2, loud: false });
            expect(sampleSettings({ sample: { limit: 9 } }, { SAMPLE_LIMIT: '5', SAMPLE_GREETING: 'Hi' })).to.deep.equal({ greeting: 'Hi', limit: 9, loud: false });
        });

        it('initializes the feature with its resolved settings at startup', async () => {
            process.env.SAMPLE_GREETING = 'Bonjour';
            started = await launch([sampleFeature()], { sample: { limit: 3 }, engines: ['stub-agent'] });
            expect(seen.initialized).to.deep.equal([{ greeting: 'Bonjour', limit: 3, loud: false }]);
            // initialize runs once the plugins (converters) and the engines are ready.
            expect(seen.ready).to.deep.equal([{ converters: true, engine: 'stub-agent' }]);
        });

        it('stops startup for an invalid setting, naming the feature and the setting', async () => {
            process.env.SAMPLE_LIMIT = '0';
            let message = '';
            await launch([sampleFeature()]).then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('Feature sample (features/sample) has invalid settings: limit: must be at least 1');
        });
    });

    describe('using modules', () => {
        const tool = (name: string) => ({ name, description: name, inputSchema: {}, annotations: { title: name, readOnlyHint: true }, execute: async () => ({ content: [] }) });
        const plugin = { type: 'samplething', name: 'one', title: 'One', version: '1.0.0', apiVersion: 1 };

        it('uses a list of modules in turn, and an extra given twice once', async () => {
            const feature = sampleFeature();
            const things = { extra: 'things/one', plugins: [plugin] };
            started = await launch([[feature, things, things, feature]]);
            const plugins = (await started.request().get('/plugins').set(admin)).body;
            expect(plugins.filter((p: any) => p.type === 'samplething').map((p: any) => p.name)).to.deep.equal(['one']);
            expect(plugins.filter((p: any) => p.type === 'feature')).to.have.length(1);
        });

        it('adds up MCP tools across separate use() calls', async () => {
            started = await launch([{ extra: 'tools/a', config: { tools: [tool('tool_a')] } }, { extra: 'tools/b', config: { tools: [tool('tool_b')] } }]);
            const names = (await started.request().get('/plugins').set(admin)).body.filter((p: any) => p.type === 'tool').map((p: any) => p.name);
            expect(names).to.include.members(['tool_a', 'tool_b']);
        });

        it('stops startup when two modules define one MCP tool, or one engine type, naming both', async () => {
            let message = '';
            await launch([{ extra: 'tools/a', config: { tools: [tool('lookup')] } }, { extra: 'modules/crm', config: { tools: [tool('lookup')] } }])
                .then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('The MCP tool "lookup" is defined by both tools/a and modules/crm');
            message = '';
            const engine = { type: 'engine', name: 'echo', kinds: ['agent'], apiVersion: 1, create: () => ({}) };
            await launch([{ extra: 'engines/a', config: { engineTypes: { echo: engine } } }, { extra: 'engines/b', config: { engineTypes: { echo: engine } } }])
                .then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('The engine type "echo" is defined by both engines/a and engines/b');
        });
    });

    describe('review fixes', () => {
        const tool = (name: string) => ({ name, description: name, inputSchema: {}, annotations: { title: name, readOnlyHint: true }, execute: async () => ({ content: [] }) });

        it('checks the caller\'s access to the form by default, and lets a route opt out', async () => {
            const open: any = { name: 'open', apiVersion: 1, routes: { form: {
                'POST /open/checked': { name: 'open', handler: () => ({ ok: true }) },
                'POST /open/public': { name: 'open', access: false, handler: () => ({ ok: true }) }
            } } };
            started = await launch([{ extra: 'features/open', uag: open }]);
            const token = started.tokenFor({ _id: 'reader1', roles: [] });
            expect((await started.request().post('/notes/open/checked').set('x-jwt-token', token).send({})).status).to.be.oneOf([401, 403]);
            const passed = await started.request().post('/notes/open/public').set('x-jwt-token', token).send({});
            expect(passed.status, passed.text).to.equal(200);
        });

        it('keys anonymous callers by their address, and others by who they are', async () => {
            const who: any = { name: 'who', apiVersion: 1 };
            started = await launch([{ extra: 'features/who', uag: who }]);
            const features = (started.server as any).features;
            const api: any = features.apiFor(features.list.find((f: any) => f.definition.name === 'who'), started.server.uagProject);
            expect(api.callerKey({ auth: {}, ip: '10.1.2.3' })).to.equal('anonymous:10.1.2.3');
            expect(api.callerKey({ auth: { user: { _id: 'u1' } }, ip: '10.1.2.3' })).to.equal('u1');
        });

        it('hands out an engine handle, never the engine', async () => {
            const keys: string[][] = [];
            const peek: any = { name: 'peek', apiVersion: 1, initialize: (api: any) => { keys.push(Object.keys(api.engines.select({ needs: ['text'] })).sort()); } };
            started = await launch([{ extra: 'features/peek', uag: peek }], { engines: ['stub-agent'] });
            expect(keys).to.deep.equal([['accepts', 'generate', 'model', 'name']]);
        });

        it('compares routes as Express matches them, and keeps the form\'s own paths', async () => {
            let message = '';
            const a: any = { name: 'a', apiVersion: 1, routes: { form: { 'POST /Doc/Run': { name: 'a', handler: () => ({}) } } } };
            const b: any = { name: 'b', apiVersion: 1, routes: { form: { 'POST /doc/run/': { name: 'b', handler: () => ({}) } } } };
            await launch([{ extra: 'features/a', uag: a }, { extra: 'features/b', uag: b }]).then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('The form route "POST /doc/run/" is claimed by two features: a (features/a) and b (features/b)');
            message = '';
            const own: any = { name: 'own', apiVersion: 1, routes: { form: { 'POST /submission/x': { name: 'own', handler: () => ({}) } } } };
            await launch([{ extra: 'features/own', uag: own }]).then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('route "POST /submission/x" is one of the form\'s own routes');
        });

        it('applies the rest of a module whose feature is already in use', async () => {
            const feature = sampleFeature();
            started = await launch([feature, { extra: 'modules/more', uag: feature.uag, config: { tools: [tool('more_tool')] } }]);
            const names = (await started.request().get('/plugins').set(admin)).body.filter((p: any) => p.type === 'tool').map((p: any) => p.name);
            expect(names).to.include('more_tool');
        });

        it('refuses a module tool named like one in the server\'s own configuration', async () => {
            let message = '';
            await start({ forms: { notes: notesForm }, config: { tools: [tool('lookup')] }, modules: [{ extra: 'tools/lookup', config: { tools: [tool('lookup')] } }] })
                .then((s) => { started = s; }, (err) => { message = err.message; });
            expect(message).to.include('The MCP tool "lookup" is defined by both the server\'s configuration and tools/lookup');
        });

        it('streams a failure with its status', async () => {
            started = await launch([sampleFeature()]);
            const failed = await started.request().post('/notes/sample/stream').set({ ...admin, Accept: 'text/event-stream' }).send({ fail: true });
            expect(events(failed.text).pop()!.data).to.include({ status: 422, code: 'process_failed' });
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

        it('takes several features in one module, as compose makes them', async () => {
            const sample = sampleFeature();
            const other = { name: 'other', apiVersion: 1, routes: { form: { 'POST /other/ping': { name: 'other', handler: () => ({ pong: true }) } } } };
            started = await launch([{ ...sample, uag: [sample.uag, other] }]);
            const plugins = (await started.request().get('/plugins').set(admin)).body;
            expect(plugins.filter((plugin: any) => plugin.type === 'feature').map((plugin: any) => plugin.name)).to.deep.equal(['sample', 'other']);
            expect((await started.request().post('/notes/other/ping').set(admin).send({})).body).to.deep.equal({ pong: true });
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
            started = await launch([[sampleFeature(), { extra: 'things/one', plugins: [{ type: 'samplething', name: 'one', title: 'One', version: '1.0.0', apiVersion: 1 }] }]]);
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
                // Each component in its own try, so one failing to load leaves the others.
                expect(res.text, file).to.include(`try {\n${script}\n} catch (err) { console.error("[uag-js] The uagsample component of the sample feature could not load:", err); }`);
                // The manifest carries the plugins of the types features define.
                expect(res.text, file).to.match(/"type":"samplething","name":"one"/);
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
