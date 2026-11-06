'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { openAICompatible } = require('../compatible');
const openai = require('..');

const SCHEMA = { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } };
const request = { instructions: 'Fill fields', state: { input: { Notes: 'Ada' }, today: 'x' }, fields: [], schema: SCHEMA };

/** A fetch that records each request and answers with one chat completion or response. */
function capture() {
    const sent = [];
    const fetch = async (url, init) => {
        sent.push({ url: String(url), headers: new Headers(init.headers) });
        const body = String(url).endsWith('/responses')
            ? { id: 'r', object: 'response', status: 'completed', model: 'm', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"name":"Ada"}' }] }] }
            : { id: 'c', object: 'chat.completion', model: 'm', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"name":"Ada"}' } }] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { sent, fetch };
}

/** Run `fn` with these environment variables set, as the SDK reads them from `process.env`. */
async function withEnv(vars, fn) {
    const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
    Object.assign(process.env, vars);
    try {
        return await fn();
    }
    finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

const acme = openAICompatible({ type: 'acme', description: 'Acme', baseURL: 'https://api.acme.example/v1', apiKey: { env: 'ACME_API_KEY' }, model: { env: 'ACME_MODEL' } });
const acmeHeader = openAICompatible({ type: 'acme-header', description: 'Acme', baseURL: 'https://api.acme.example/v1', apiKey: { env: 'ACME_API_KEY' }, apiKeyHeader: 'api-key', model: { env: 'ACME_MODEL' } });

describe('What the OpenAI-compatible clients send', () => {
    it('sends OPENAI_API_KEY only to OpenAI itself, never to a baseURL server', async () => {
        const env = { OPENAI_API_KEY: 'sk-real-openai-key', OPENAI_MODEL: 'gpt-test', UAG_ENGINE_ROUTER_BASE_URL: 'https://openrouter.ai/api/v1', UAG_ENGINE_ROUTER_MODEL: 'r' };
        const own = capture();
        await (await createEngine(openai, { name: 'openai', options: { fetch: own.fetch }, env, config: {} })).extract(request);
        expect(own.sent[0].url).to.equal('https://api.openai.com/v1/responses');
        expect(own.sent[0].headers.get('authorization')).to.equal('Bearer sk-real-openai-key');

        const router = capture();
        await (await createEngine(openai, { name: 'router', options: { fetch: router.fetch }, env, config: {} })).extract(request);
        expect(router.sent[0].url).to.equal('https://openrouter.ai/api/v1/chat/completions');
        expect(router.sent[0].headers.get('authorization')).to.equal(null);

        const keyed = capture();
        await (await createEngine(openai, { name: 'router', options: { fetch: keyed.fetch }, env: { ...env, UAG_ENGINE_ROUTER_API_KEY: 'or-key' }, config: {} })).extract(request);
        expect(keyed.sent[0].headers.get('authorization')).to.equal('Bearer or-key');
    });

    it('sends OpenAI\'s organization, project and custom headers from the environment to OpenAI only', async () => {
        const ambient = { OPENAI_ORG_ID: 'org-acme', OPENAI_PROJECT_ID: 'proj_1', OPENAI_CUSTOM_HEADERS: 'X-Gateway-Token: gw-secret\nX-Other: o' };
        await withEnv(ambient, async () => {
            const other = capture();
            await (await createEngine(acme, { name: 'acme', options: { fetch: other.fetch }, env: { ACME_API_KEY: 'acme-key', ACME_MODEL: 'a' }, config: {} })).extract(request);
            const headers = other.sent[0].headers;
            expect(headers.get('authorization')).to.equal('Bearer acme-key');
            for (const name of ['openai-organization', 'openai-project', 'x-gateway-token', 'x-other']) {
                expect(headers.get(name), name).to.equal(null);
            }

            const own = capture();
            await (await createEngine(openai, { name: 'openai', options: { fetch: own.fetch }, env: { OPENAI_API_KEY: 'sk', OPENAI_MODEL: 'm' }, config: {} })).extract(request);
            expect(own.sent[0].headers.get('openai-organization')).to.equal('org-acme');
            expect(own.sent[0].headers.get('x-gateway-token')).to.equal('gw-secret');
        });
    });

    it('sends a key in its own header with no bearer token beside it', async () => {
        const { sent, fetch } = capture();
        await (await createEngine(acmeHeader, { name: 'acme-header', options: { fetch }, env: { ACME_API_KEY: 'acme-key', ACME_MODEL: 'a' }, config: {} })).extract(request);
        expect(sent[0].headers.get('api-key')).to.equal('acme-key');
        expect(sent[0].headers.get('authorization')).to.equal(null);
    });
});
