'use strict';
const { expect } = require('chai');
const { parseInstances, engineInstances, settingVariable, resolveSettings, defineEngine, EngineConfigError } = require('..');

const claude = defineEngine({
    type: 'claude',
    kinds: ['agent'],
    apiVersion: 1,
    settings: {
        apiKey: { env: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'], required: true, secret: true },
        model: { env: 'CLAUDE_MODEL', default: 'claude-opus-5-5' },
        baseURL: {},
        maxTokens: { type: 'number', default: 16000 },
        fallbacks: { type: 'boolean' },
    },
    create: () => ({}),
});

function refusal(fn) {
    try {
        fn();
    }
    catch (err) {
        expect(err).to.be.instanceOf(EngineConfigError);
        return err.message;
    }
    throw new Error('expected an EngineConfigError');
}

describe('parseInstances', () => {
    it('reads bare types and name:type entries', () => {
        expect(parseInstances(' jev, fast:claude ,deep:claude,,')).to.deep.equal([
            { name: 'jev', type: 'jev', options: {} },
            { name: 'fast', type: 'claude', options: {} },
            { name: 'deep', type: 'claude', options: {} },
        ]);
    });

    it('takes a package name as the type, leaving a bare package entry unnamed until it loads', () => {
        expect(parseInstances('x:@acme/uag-engine-x,uag-engine-y')).to.deep.equal([
            { name: 'x', type: '@acme/uag-engine-x', options: {} },
            { name: undefined, type: 'uag-engine-y', options: {} },
        ]);
    });

    it('enables nothing when nothing is named', () => {
        expect(parseInstances(undefined)).to.deep.equal([]);
        expect(parseInstances('')).to.deep.equal([]);
        expect(parseInstances([])).to.deep.equal([]);
    });

    it('reads configuration entries, with options and embedded types', () => {
        const mine = { type: 'mine' };
        expect(parseInstances(['jev', { name: 'deep', type: 'claude', options: { model: 'claude-opus-5-5' } }, { name: 'own', type: mine }])).to.deep.equal([
            { name: 'jev', type: 'jev', options: {} },
            { name: 'deep', type: 'claude', options: { model: 'claude-opus-5-5' } },
            { name: 'own', type: mine, options: {} },
        ]);
    });

    it('refuses a duplicate name, naming it', () => {
        expect(refusal(() => parseInstances('claude,claude:openai'))).to.include('"claude"').and.include('unique');
    });

    it('refuses a path, or any name that is not a type or package name, before looking anything up', () => {
        for (const entry of ['x:../../tmp/evil', 'x:./local', 'x:/abs/path', 'x:@acme/../evil', 'x:@acme/.hidden', 'x:Claude', 'x:a b', 'x:C:\\engines']) {
            expect(refusal(() => parseInstances(entry)), entry).to.include('is not valid');
        }
        expect(refusal(() => parseInstances('Fast:claude'))).to.include('engine name "Fast"');
        expect(refusal(() => parseInstances([{ name: 'x', type: 42 }]))).to.include('needs a type');
        expect(refusal(() => parseInstances([{ name: 'x', type: 'jev', options: [] }]))).to.include('options');
        expect(refusal(() => parseInstances({}))).to.include('string or an array');
    });
});

describe('engineInstances', () => {
    it('takes configuration over UAG_ENGINES', () => {
        expect(engineInstances({ engines: ['claude'] }, { UAG_ENGINES: 'jev' }).map((i) => i.name)).to.deep.equal(['claude']);
        expect(engineInstances({}, { UAG_ENGINES: 'jev' }).map((i) => i.name)).to.deep.equal(['jev']);
        expect(engineInstances({}, {})).to.deep.equal([]);
    });
});

describe('settings', () => {
    it('names an instance\'s own variables', () => {
        expect(settingVariable('fast', 'apiKey')).to.equal('UAG_ENGINE_FAST_API_KEY');
        expect(settingVariable('local-llm', 'baseURL')).to.equal('UAG_ENGINE_LOCAL_LLM_BASE_URL');
        expect(settingVariable('deep', 'structuredOutput')).to.equal('UAG_ENGINE_DEEP_STRUCTURED_OUTPUT');
    });

    it('lets two instances share a key while each has its own model', () => {
        const env = { CLAUDE_API_KEY: 'sk-shared', UAG_ENGINE_FAST_MODEL: 'claude-haiku-5-5', UAG_ENGINE_DEEP_MODEL: 'claude-opus-5-5' };
        expect(resolveSettings(claude, 'fast', {}, env)).to.include({ apiKey: 'sk-shared', model: 'claude-haiku-5-5' });
        expect(resolveSettings(claude, 'deep', {}, env)).to.include({ apiKey: 'sk-shared', model: 'claude-opus-5-5' });
    });

    it('takes an instance\'s own variable over the type\'s, and options over both', () => {
        const env = { CLAUDE_API_KEY: 'sk-shared', UAG_ENGINE_DEEP_API_KEY: 'sk-deep' };
        expect(resolveSettings(claude, 'deep', {}, env).apiKey).to.equal('sk-deep');
        expect(resolveSettings(claude, 'fast', {}, env).apiKey).to.equal('sk-shared');
        expect(resolveSettings(claude, 'deep', { apiKey: 'sk-option' }, env).apiKey).to.equal('sk-option');
        expect(resolveSettings(claude, 'deep', { apiKey: '' }, env).apiKey).to.equal('sk-deep');
    });

    it('reads the type\'s variables in order, then the default', () => {
        expect(resolveSettings(claude, 'claude', {}, { ANTHROPIC_API_KEY: 'sk-a' })).to.deep.equal({ apiKey: 'sk-a', model: 'claude-opus-5-5', maxTokens: 16000 });
        expect(resolveSettings(claude, 'claude', {}, { ANTHROPIC_API_KEY: 'sk-a', CLAUDE_API_KEY: 'sk-c' }).apiKey).to.equal('sk-c');
    });

    it('reads a single variable from a definition not made with defineEngine', () => {
        const plain = { type: 'plain', kinds: ['agent'], apiVersion: 1, settings: { delayMs: { env: 'PLAIN_DELAY_MS', type: 'number', default: 5 } }, create: () => ({}) };
        expect(resolveSettings(plain, 'plain', {}, { PLAIN_DELAY_MS: '20', _: '/usr/bin/mocha', P: 'x' })).to.deep.equal({ delayMs: 20 });
        expect(resolveSettings(plain, 'plain', {}, { _: '/usr/bin/mocha' })).to.deep.equal({ delayMs: 5 });
    });

    it('converts numbers and booleans from the environment', () => {
        const settings = resolveSettings(claude, 'fast', {}, { CLAUDE_API_KEY: 'k', UAG_ENGINE_FAST_MAX_TOKENS: ' 2048 ', UAG_ENGINE_FAST_FALLBACKS: 'false' });
        expect(settings).to.include({ maxTokens: 2048, fallbacks: false });
        expect(refusal(() => resolveSettings(claude, 'fast', {}, { CLAUDE_API_KEY: 'k', UAG_ENGINE_FAST_MAX_TOKENS: 'lots' }))).to.include('maxTokens setting must be a number');
    });

    it('names the instance, type, setting and every variable when a required setting is missing', () => {
        expect(refusal(() => resolveSettings(claude, 'fast', {}, {})))
            .to.equal('The "fast" engine (type "claude") needs its apiKey setting: set UAG_ENGINE_FAST_API_KEY, CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
    });

    it('never quotes a secret value it refuses', () => {
        const secret = defineEngine({ type: 'x', kinds: ['agent'], apiVersion: 1, settings: { pin: { type: 'number', secret: true } }, create: () => ({}) });
        expect(refusal(() => resolveSettings(secret, 'x', {}, { UAG_ENGINE_X_PIN: 'sk-not-a-number' }))).to.not.include('sk-not-a-number');
    });
});
