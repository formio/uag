'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const grok = require('..');

const ENV = { XAI_API_KEY: 'xai-secret-key', XAI_MODEL: 'grok-test-2026-10-01' };
const request = { instructions: 'Fill fields', state: { input: { Notes: 'Ada' }, today: 'x' }, fields: [], schema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false } };

/** A fetch that records each request and answers with one chat completion. */
function capture(content = '{"name":"Ada"}') {
    const sent = [];
    const fetch = async (url, init) => {
        sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ id: 'c', object: 'chat.completion', model: 'grok-test-2026-10-01', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { sent, fetch };
}

/** A fake client that researches whenever it may, for the conformance check. */
function researcher() {
    const reply = (message) => ({ model: 'grok-test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, ...message } }] });
    return { chat: { completions: { create: async (body) => (body.tools && body.tool_choice !== 'none'
        ? reply({ tool_calls: [{ id: `c${body.messages.length}`, type: 'function', function: { name: 'lookup', arguments: '{}' } }] })
        : reply({ content: '{"name":"Ada Lovelace","city":"London"}' })) } } };
}

const create = (options, env = ENV, name = 'grok') => createEngine(grok, { name, options, env, config: {} });

describe('Grok engine', () => {
    it('meets the engine contract', async () => {
        const report = await checkEngine(grok, { name: 'grok', options: { client: researcher() }, env: ENV });
        expect(report.failures).to.deep.equal([]);
        expect(grok.kinds).to.deep.equal(['agent']);
    });

    it('calls xAI\'s API with the key as a bearer token and a strict JSON schema', async () => {
        const { sent, fetch } = capture();
        const engine = await create({ fetch });
        const result = await engine.extract(request);
        expect(result.values).to.deep.equal({ name: 'Ada' });
        const [call] = sent;
        expect(call.url).to.equal('https://api.x.ai/v1/chat/completions');
        expect(call.headers.get('authorization')).to.equal('Bearer xai-secret-key');
        expect(call.body.model).to.equal('grok-test-2026-10-01');
        expect(call.body.response_format.type).to.equal('json_schema');
        expect(call.body).to.not.have.property('max_tokens');
    });

    it('asks for formats and patterns in words, so a field the information does not state can stay empty', async () => {
        const { sent, fetch } = capture('{"policyNumber":"","incidentDate":"2026-10-20"}');
        const engine = await create({ fetch });
        const result = await engine.extract({ ...request, schema: { type: 'object', additionalProperties: false, properties: {
            policyNumber: { type: 'string', pattern: '^POL-[0-9]{6}$', description: 'The policy number.' },
            incidentDate: { type: 'string', format: 'date' },
        } } });
        expect(result.values).to.deep.equal({ incidentDate: '2026-10-20' });
        const { properties } = sent[0].body.response_format.json_schema.schema;
        expect(properties.policyNumber).to.deep.equal({ type: 'string', description: 'The policy number. It must match the regular expression ^POL-[0-9]{6}$.' });
        expect(properties.incidentDate).to.deep.equal({ type: 'string', description: 'Write it as a date, YYYY-MM-DD.' });
    });

    it('takes per-instance settings and a base URL override', async () => {
        const { sent, fetch } = capture();
        const engine = await create({ fetch }, { XAI_API_KEY: 'k', UAG_ENGINE_FAST_MODEL: 'grok-fast', UAG_ENGINE_FAST_BASE_URL: 'https://proxy.example/xai/v1' }, 'fast');
        expect(engine.model).to.equal('grok-fast');
        await engine.extract(request);
        expect(sent[0].url).to.equal('https://proxy.example/xai/v1/chat/completions');
    });

    it('needs a model and a key, naming their variables', async () => {
        for (const [env, text] of [[{ XAI_API_KEY: 'k' }, 'needs its model setting: set UAG_ENGINE_GROK_MODEL or XAI_MODEL'], [{ XAI_MODEL: 'm' }, 'needs its apiKey setting: set UAG_ENGINE_GROK_API_KEY or XAI_API_KEY']]) {
            const err = await create({}, env).then(() => null, (e) => e);
            expect(err.message).to.include(text);
        }
    });
});
