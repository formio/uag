'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const mai = require('..');

const ENV = { MAI_ENDPOINT: 'https://contoso.services.ai.azure.com/', MAI_API_KEY: 'mai-secret-key', MAI_DEPLOYMENT: 'mai-thinking' };
const schema = { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false };
const request = { instructions: 'Fill fields', state: { input: { Notes: 'Ada' }, today: 'x' }, fields: [], schema };

function capture(content = 'Here it is:\n{"name":"Ada"}') {
    const sent = [];
    const fetch = async (url, init) => {
        sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ id: 'mai-api-1', object: 'chat.completion', model: 'mai-thinking', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { sent, fetch };
}

function researcher() {
    const reply = (message) => ({ model: 'mai-thinking', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, ...message } }] });
    return { chat: { completions: { create: async (body) => (body.tools && body.tool_choice !== 'none'
        ? reply({ tool_calls: [{ id: `c${body.messages.length}`, type: 'function', function: { name: 'lookup', arguments: '{}' } }] })
        : reply({ content: '{"name":"Ada Lovelace","city":"London"}' })) } } };
}

const create = (options, env = ENV, name = 'mai') => createEngine(mai, { name, options, env, config: {} });

describe('MAI engine', () => {
    it('meets the engine contract', async () => {
        const report = await checkEngine(mai, { name: 'mai', options: { client: researcher() }, env: ENV });
        expect(report.failures).to.deep.equal([]);
        expect(mai.kinds).to.deep.equal(['agent']);
    });

    it('calls the Foundry MAI endpoint with the key in an api-key header, naming the deployment, with the schema in the prompt', async () => {
        const { sent, fetch } = capture();
        const engine = await create({ fetch });
        expect(engine.model).to.equal('mai-thinking');
        const result = await engine.extract(request);
        expect(result.values).to.deep.equal({ name: 'Ada' });
        const [call] = sent;
        expect(call.url).to.equal('https://contoso.services.ai.azure.com/mai/v1/chat/completions');
        expect(call.headers.get('api-key')).to.equal('mai-secret-key');
        expect(String(call.headers.get('authorization'))).to.not.include('mai-secret-key');
        expect(call.body.model).to.equal('mai-thinking');
        expect(call.body).to.not.have.property('response_format');
        expect(call.body).to.not.have.property('max_tokens');
        expect(call.body.messages[1].content).to.include(JSON.stringify(schema));
    });

    it('fails as an engine error when the answer is prose', async () => {
        const engine = await create({ fetch: capture('I could not find a name.').fetch });
        const err = await engine.extract(request).then(() => null, (e) => e);
        expect(err.message).to.equal('The engine did not return a JSON object.');
    });

    it('needs an endpoint (or a base URL), a key and a deployment, naming their variables', async () => {
        const cases = [
            [{ MAI_API_KEY: 'k', MAI_DEPLOYMENT: 'd' }, 'needs its endpoint setting: set UAG_ENGINE_MAI_ENDPOINT or MAI_ENDPOINT'],
            [{ MAI_ENDPOINT: 'https://x', MAI_DEPLOYMENT: 'd' }, 'needs its apiKey setting: set UAG_ENGINE_MAI_API_KEY or MAI_API_KEY'],
            [{ MAI_ENDPOINT: 'https://x', MAI_API_KEY: 'k' }, 'needs its model setting: set UAG_ENGINE_MAI_MODEL or MAI_DEPLOYMENT'],
        ];
        for (const [env, text] of cases) {
            const err = await create({}, env).then(() => null, (e) => e);
            expect(err.message).to.include(text);
        }
        const { sent, fetch } = capture();
        const proxied = await create({ fetch }, { MAI_API_KEY: 'k', MAI_DEPLOYMENT: 'd', UAG_ENGINE_MAI_BASE_URL: 'https://gateway.example/mai/v1' });
        await proxied.extract(request);
        expect(sent[0].url).to.equal('https://gateway.example/mai/v1/chat/completions');
    });
});
