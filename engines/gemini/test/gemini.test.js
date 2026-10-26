'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const gemini = require('..');

const ENV = { GEMINI_API_KEY: 'gemini-secret-key', GEMINI_MODEL: 'gemini-test-2026-10-01' };
const request = { instructions: 'Fill fields', state: { input: { Notes: 'Ada' }, today: 'x' }, fields: [], schema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false } };

/** A fetch that records each request and answers with one chat completion. */
function capture(content = '{"name":"Ada"}') {
    const sent = [];
    const fetch = async (url, init) => {
        sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ id: 'c', object: 'chat.completion', model: 'gemini-test-2026-10-01', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { sent, fetch };
}

/** A fake client that researches whenever it may, for the conformance check. */
function researcher() {
    const reply = (message) => ({ model: 'gemini-test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, ...message } }] });
    return { chat: { completions: { create: async (body) => (body.tools && body.tool_choice !== 'none'
        ? reply({ tool_calls: [{ id: `c${body.messages.length}`, type: 'function', function: { name: 'lookup', arguments: '{}' } }] })
        : reply({ content: '{"name":"Ada Lovelace","city":"London"}' })) } } };
}

const create = (options, env = ENV, name = 'gemini') => createEngine(gemini, { name, options, env, config: {} });

describe('Gemini engine', () => {
    it('meets the engine contract', async () => {
        const report = await checkEngine(gemini, { name: 'gemini', options: { client: researcher() }, env: ENV });
        expect(report.failures).to.deep.equal([]);
        expect(gemini.kinds).to.deep.equal(['agent']);
    });

    it('calls Google\'s endpoint with the key as a bearer token and a strict JSON schema', async () => {
        const { sent, fetch } = capture();
        const engine = await create({ fetch });
        const result = await engine.extract(request);
        expect(result.values).to.deep.equal({ name: 'Ada' });
        const [call] = sent;
        expect(call.url).to.equal('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
        expect(call.headers.get('authorization')).to.equal('Bearer gemini-secret-key');
        expect(call.body.model).to.equal('gemini-test-2026-10-01');
        expect(call.body.response_format.type).to.equal('json_schema');
        expect(call.body).to.not.have.property('max_tokens');
    });

    it('takes per-instance settings and a base URL override', async () => {
        const { sent, fetch } = capture();
        const engine = await create({ fetch }, { GEMINI_API_KEY: 'k', UAG_ENGINE_FAST_MODEL: 'gemini-fast', UAG_ENGINE_FAST_BASE_URL: 'https://proxy.example/gemini/v1' }, 'fast');
        expect(engine.model).to.equal('gemini-fast');
        await engine.extract(request);
        expect(sent[0].url).to.equal('https://proxy.example/gemini/v1/chat/completions');
    });

    it('also reads GOOGLE_API_KEY, and sends reasoning_effort when set', async () => {
        const { sent, fetch } = capture();
        const engine = await create({ fetch }, { GOOGLE_API_KEY: 'google-key', GEMINI_MODEL: 'm', GEMINI_REASONING_EFFORT: 'low' });
        await engine.extract(request);
        expect(sent[0].headers.get('authorization')).to.equal('Bearer google-key');
        expect(sent[0].body.reasoning_effort).to.equal('low');
    });

    it('needs a model and a key, naming their variables', async () => {
        for (const [env, text] of [[{ GEMINI_API_KEY: 'k' }, 'needs its model setting: set UAG_ENGINE_GEMINI_MODEL or GEMINI_MODEL'], [{ GEMINI_MODEL: 'm' }, 'needs its apiKey setting: set UAG_ENGINE_GEMINI_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY']]) {
            const err = await create({}, env).then(() => null, (e) => e);
            expect(err.message).to.include(text);
        }
    });
});
