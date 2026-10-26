'use strict';
const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defineEngine, parseInstances, EngineConfigError } = require('..');
const { enginePaths, loadEngines, resolveType } = require('../loader');

const SDK = path.resolve(__dirname, '..');

/** A directory holding `node_modules/<name>` for each package given. */
function installDir(packages) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-engines-'));
    for (const [name, { version = '1.2.3', source }] of Object.entries(packages)) {
        const dir = path.join(root, 'node_modules', ...name.split('/'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }));
        fs.writeFileSync(path.join(dir, 'index.js'), source);
    }
    return root;
}

/** Source for an engine package built with this SDK. */
function enginePackage(type, { kind = 'agent', apiVersion = 1, settings = '{}', create } = {}) {
    return `
const { defineEngine } = require(${JSON.stringify(SDK)});
module.exports = defineEngine({
    type: ${JSON.stringify(type)},
    kinds: [${JSON.stringify(kind)}],
    apiVersion: ${apiVersion},
    settings: ${settings},
    create: ${create || `({ name, settings }) => ({ name, kind: ${JSON.stringify(kind)}, model: settings.model || '${type}-1', maxOptions: 10, decide: async () => ({}), extract: async () => ({}) })`},
});`;
}

const agentType = (type, extra = {}) => defineEngine({
    type,
    kinds: ['agent'],
    apiVersion: 1,
    create: ({ name }) => ({ name, kind: 'agent', model: `${type}-1`, extract: async () => ({ model: `${type}-1`, values: {} }) }),
    ...extra,
});

async function refusal(promise) {
    try {
        await promise;
    }
    catch (err) {
        expect(err).to.be.instanceOf(EngineConfigError);
        return err.message;
    }
    throw new Error('expected loading to fail');
}

const created = [];
afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function install(packages) {
    const dir = installDir(packages);
    created.push(dir);
    return dir;
}

describe('engine loader', () => {
    it('loads an official engine by its short name, with its package and version', async () => {
        const root = install({ '@formio/uag-openai': { version: '1.0.0', source: enginePackage('openai') } });
        const [loaded] = await loadEngines(parseInstances('openai'), { paths: [root] });
        expect(loaded).to.include({ type: 'openai', package: '@formio/uag-openai', version: '1.0.0' });
        expect(loaded.engine).to.include({ name: 'openai', kind: 'agent', model: 'openai-1' });
    });

    it('loads a third-party engine from uag-engine-<type>, after @formio/uag-<type>', async () => {
        const root = install({
            'uag-engine-acme': { source: enginePackage('acme') },
            '@formio/uag-jev': { source: enginePackage('jev', { kind: 'decision' }) },
            'uag-engine-jev': { source: 'throw new Error("not this one")' },
        });
        const loaded = await loadEngines(parseInstances('acme,jev'), { paths: [root] });
        expect(loaded.map((l) => l.package)).to.deep.equal(['uag-engine-acme', '@formio/uag-jev']);
    });

    it('loads a package named explicitly, and names a bare package entry after its type', async () => {
        const root = install({
            '@acme/uag-engine-x': { source: enginePackage('xray') },
            'uag-engine-yankee': { source: enginePackage('yankee') },
        });
        const loaded = await loadEngines(parseInstances('x:@acme/uag-engine-x,uag-engine-yankee,@acme/uag-engine-x'), { paths: [root] });
        expect(loaded.map((l) => [l.engine.name, l.type])).to.deep.equal([['x', 'xray'], ['yankee', 'yankee'], ['xray', 'xray']]);
    });

    it('loads an engine from a directory in UAG_ENGINE_PATH', async () => {
        const own = install({});
        const mounted = install({ '@acme/uag-engine-x': { source: enginePackage('x') } });
        const paths = enginePaths(own, { UAG_ENGINE_PATH: `${mounted}${path.delimiter}` });
        expect(paths).to.deep.equal([own, mounted]);
        const [loaded] = await loadEngines(parseInstances('x:@acme/uag-engine-x'), { paths });
        expect(loaded.package).to.equal('@acme/uag-engine-x');
    });

    it('refuses a relative UAG_ENGINE_PATH, so the working directory is never searched', () => {
        expect(() => enginePaths('/app', { UAG_ENGINE_PATH: 'engines' })).to.throw(EngineConfigError, 'absolute');
    });

    it('names the packages it looked for, and how to install one, when a type is not installed', async () => {
        const message = await refusal(loadEngines(parseInstances('mistral'), { paths: [install({})] }));
        expect(message).to.include('"@formio/uag-mistral"').and.include('"uag-engine-mistral"').and.include('npm install').and.include('UAG_ENGINE_PATH');
        expect(message).to.not.include('without installing');
        const typo = await refusal(loadEngines(parseInstances('stub-desicion'), { types: { 'stub-decision': agentType('stub-decision'), remote: agentType('remote') } }));
        expect(typo).to.include('Types available without installing: stub-decision, remote.');
    });

    it('refuses a path as a type before loading any file', async () => {
        const evil = install({});
        fs.writeFileSync(path.join(evil, 'evil.js'), 'globalThis.__uagEvilLoaded = true;');
        const relative = path.relative(process.cwd(), path.join(evil, 'evil.js'));
        expect(await refusal(loadEngines([{ name: 'x', type: relative }], { paths: [evil] }))).to.include('is not valid');
        expect(await refusal(loadEngines([{ name: 'x', type: path.join(evil, 'evil.js') }], { paths: [evil] }))).to.include('is not valid');
        expect(globalThis.__uagEvilLoaded).to.equal(undefined);
    });

    it('refuses a package that is not an engine, naming it', async () => {
        const root = install({ '@acme/not-an-engine': { source: 'module.exports = { chunk() {} };' } });
        expect(await refusal(loadEngines(parseInstances('x:@acme/not-an-engine'), { paths: [root] })))
            .to.include('"@acme/not-an-engine" is not a UAG engine');
    });

    it('refuses a package built for another contract version, naming the package and both versions', async () => {
        const root = install({ 'uag-engine-future': { source: enginePackage('future', { apiVersion: 2 }) } });
        expect(await refusal(loadEngines(parseInstances('uag-engine-future'), { paths: [root] })))
            .to.include('"uag-engine-future"').and.include('version 2').and.include('version 1');
    });

    it('reports a package that fails to load', async () => {
        const root = install({ 'uag-engine-broken': { source: 'throw new Error("missing dependency")' } });
        expect(await refusal(loadEngines(parseInstances('uag-engine-broken'), { paths: [root] }))).to.include('failed to load: missing dependency');
    });

    it('resolves a type given by the host before any package', async () => {
        const root = install({ '@formio/uag-remote': { source: 'throw new Error("not loaded")' } });
        const remote = agentType('remote');
        const [loaded] = await loadEngines(parseInstances('claude:remote'), { paths: [root], types: { remote } });
        expect(loaded).to.deep.include({ type: 'remote' });
        expect(loaded).to.not.have.property('package');
        expect(resolveType('remote', { types: { remote } }).definition).to.equal(remote);
    });

    it('loads an embedded type, named after it when no name is given', async () => {
        const mine = agentType('mine');
        const loaded = await loadEngines(parseInstances([{ type: mine }, { name: 'other', type: mine }]));
        expect(loaded.map((l) => l.engine.name)).to.deep.equal(['mine', 'other']);
    });

    it('loads a type defined with another copy of the SDK, or with none', async () => {
        const copy = install({});
        fs.cpSync(SDK, path.join(copy, 'sdk'), { recursive: true, filter: (src) => !src.includes(`${path.sep}test`) });
        const other = require(path.join(copy, 'sdk'));
        expect(other.defineEngine).to.not.equal(defineEngine);
        const fromCopy = other.defineEngine({ type: 'copy', kinds: ['agent'], apiVersion: 1, create: ({ name }) => ({ name, kind: 'agent', model: 'm', extract: async () => ({}) }) });
        const plain = { type: 'plain', kinds: ['agent'], apiVersion: 1, create: ({ name }) => ({ name, kind: 'agent', model: 'm', extract: async () => ({}) }) };
        const loaded = await loadEngines(parseInstances([{ type: fromCopy }, { type: plain }]));
        expect(loaded.map((l) => l.type)).to.deep.equal(['copy', 'plain']);
    });

    it('runs two instances of one type with a shared key and their own models', async () => {
        const claude = agentType('claude', {
            settings: { apiKey: { env: 'CLAUDE_API_KEY', required: true, secret: true }, model: { env: 'CLAUDE_MODEL', default: 'claude-opus-5-5' } },
            create: ({ name, settings }) => ({ name, kind: 'agent', model: settings.model, key: settings.apiKey, extract: async () => ({}) }),
        });
        const env = { CLAUDE_API_KEY: 'sk-shared', UAG_ENGINE_FAST_MODEL: 'claude-haiku-5-5', UAG_ENGINE_DEEP_API_KEY: 'sk-deep' };
        const loaded = await loadEngines(parseInstances('fast:claude,deep:claude'), { types: { claude }, env });
        expect(loaded.map((l) => [l.engine.name, l.engine.model, l.engine.key])).to.deep.equal([
            ['fast', 'claude-haiku-5-5', 'sk-shared'],
            ['deep', 'claude-opus-5-5', 'sk-deep'],
        ]);
    });

    it('keeps secret settings out of a failing factory\'s error', async () => {
        const leaky = agentType('leaky', {
            settings: { apiKey: { env: 'LEAKY_KEY', required: true, secret: true } },
            create: ({ settings }) => { throw new Error(`401 Unauthorized for key ${settings.apiKey} at https://api.example.com`); },
        });
        const message = await refusal(loadEngines(parseInstances('leaky'), { types: { leaky }, env: { LEAKY_KEY: 'sk-live-0123456789' } }));
        expect(message).to.include('The "leaky" engine (type "leaky") failed to start').and.include('[redacted]');
        expect(message).to.not.include('sk-live-0123456789');
    });

    it('gives settings needed only in some cases the standard error', async () => {
        const local = agentType('local', {
            settings: { apiKey: { env: 'LOCAL_KEY', secret: true }, baseURL: { env: 'LOCAL_URL' } },
            create: ({ name, settings, requireSetting }) => {
                if (!settings.baseURL) requireSetting('apiKey');
                return { name, kind: 'agent', model: 'm', extract: async () => ({}) };
            },
        });
        expect(await refusal(loadEngines(parseInstances('local'), { types: { local }, env: {} })))
            .to.equal('The "local" engine (type "local") needs its apiKey setting: set UAG_ENGINE_LOCAL_API_KEY or LOCAL_KEY.');
        expect(await loadEngines(parseInstances('local'), { types: { local }, env: { LOCAL_URL: 'http://localhost:11434/v1' } })).to.have.length(1);
    });

    it('refuses duplicates found only once types are known', async () => {
        const root = install({ 'uag-engine-acme': { source: enginePackage('acme') } });
        expect(await refusal(loadEngines(parseInstances('uag-engine-acme,acme'), { paths: [root] }))).to.include('Two engines are named "acme"');
    });

    it('refuses two instances whose settings would share a variable', async () => {
        const a = agentType('a', { settings: { apiKey: {} } });
        const b = agentType('b', { settings: { key: {} } });
        expect(await refusal(loadEngines(parseInstances('fast:a,fast-api:b'), { types: { a, b } }))).to.include('UAG_ENGINE_FAST_API_KEY');
    });

    it('refuses an engine that ignores its instance name or its declared kind', async () => {
        const renamed = agentType('renamed', { create: () => ({ name: 'other', kind: 'agent', model: 'm', extract: async () => ({}) }) });
        expect(await refusal(loadEngines(parseInstances('renamed'), { types: { renamed } }))).to.include('must use the instance name');
        const wrongKind = agentType('wrong', { create: ({ name }) => ({ name, kind: 'decision', model: 'm', decide: async () => ({}) }) });
        expect(await refusal(loadEngines(parseInstances('wrong'), { types: { wrong: wrongKind } }))).to.include('declares agent');
    });

    it('waits for a factory that starts asynchronously', async () => {
        const slow = agentType('slow', { create: async ({ name }) => ({ name, kind: 'agent', model: 'described-1', extract: async () => ({}) }) });
        const [loaded] = await loadEngines(parseInstances('slow'), { types: { slow } });
        expect(loaded.engine.model).to.equal('described-1');
    });
});
