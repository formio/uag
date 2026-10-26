'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const openai = require('..');

// These tests cover the Chat Completions API (compatible servers); see responses.test.js for OpenAI's own.
const ENV = { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-test-2026-09-01', OPENAI_API: 'chat' };
const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { name: { type: 'string' }, age: { type: 'number' }, insured: { type: 'boolean' } },
};

/** A completion whose message is `message`, as the chat completions API returns it. */
function completion(message, extra = {}) {
    return { model: 'gpt-test-2026-09-01', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: null, ...message } }], usage: { prompt_tokens: 10, completion_tokens: 2 }, ...extra };
}
const answer = (values, extra) => completion({ content: typeof values === 'string' ? values : JSON.stringify(values) }, extra);
const toolTurn = (calls) => completion({ tool_calls: calls.map(([name, args], i) => ({ id: `call_${i}`, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })) });

/** A fake OpenAI client recording requests and replying from a script, or from `reply(body)`. */
function fakeOpenAI(replies) {
    const calls = [];
    return {
        calls,
        client: {
            chat: {
                completions: {
                    async create(body, opts) {
                        calls.push({ body: structuredClone(body), opts });
                        return typeof replies === 'function' ? replies(body) : replies.shift();
                    },
                },
            },
        },
    };
}

/** Script: a tool call whenever tools are on, then the fields. */
function researcher(body) {
    if (body.tools && body.tool_choice !== 'none') {
        return completion({ tool_calls: [{ id: `call_${body.messages.length}`, type: 'function', function: { name: 'lookup', arguments: JSON.stringify({ page: body.messages.length }) } }] });
    }
    return answer({ name: 'Ada Lovelace', city: 'London' });
}

const create = (options, env = ENV, name = 'openai') => createEngine(openai, { name, options, env, config: {} });
const request = (extra = {}) => ({ instructions: 'Fill fields', state: { input: { Notes: 'Ada, 36, insured' }, today: 'x' }, fields: [], schema: SCHEMA, ...extra });

async function failure(promise) {
    try {
        await promise;
    }
    catch (err) {
        return err;
    }
    throw new Error('expected a failure');
}

describe('OpenAI engine, on Chat Completions', () => {
    it('meets the engine contract in every structured-output mode', async () => {
        for (const mode of ['json_schema', 'json_object', 'prompt']) {
            const report = await checkEngine(openai, { options: { client: fakeOpenAI(researcher).client, structuredOutput: mode }, env: ENV });
            expect(report.failures, mode).to.deep.equal([]);
            expect(report.results.filter((r) => r.skipped), mode).to.deep.equal([]);
        }
    });

    describe('settings', () => {
        it('needs a model, with no default', async () => {
            const err = await failure(create({ client: {} }, { OPENAI_API_KEY: 'sk' }));
            expect(err.message).to.equal('The "openai" engine (type "openai") needs its model setting: set UAG_ENGINE_OPENAI_MODEL or OPENAI_MODEL.');
        });

        it('needs an API key for OpenAI itself', async () => {
            const err = await failure(create({ client: {} }, { OPENAI_MODEL: 'm' }));
            expect(err.message).to.equal('The "openai" engine (type "openai") needs its apiKey setting: set UAG_ENGINE_OPENAI_API_KEY or OPENAI_API_KEY.');
        });

        it('starts against a local server without an API key, using the real SDK', async () => {
            const engine = await create({}, { UAG_ENGINE_LOCAL_BASE_URL: 'http://ollama:11434/v1', UAG_ENGINE_LOCAL_MODEL: 'llama4:16x17b' }, 'local');
            expect(engine).to.include({ name: 'local', model: 'llama4:16x17b', toolUse: true });
        });

        it('refuses an unknown structured-output mode', async () => {
            const err = await failure(create({ client: {}, structuredOutput: 'xml' }));
            expect(err.message).to.include('structuredOutput setting must be one of json_schema, json_object, prompt');
        });

        it('keeps the key out of a failing start', async () => {
            const err = await failure(create({ client: {}, structuredOutput: 'sk-live-secret-key' }, { ...ENV, OPENAI_API_KEY: 'sk-live-secret-key' }));
            expect(err.message).to.not.include('sk-live-secret-key');
        });
    });

    describe('extraction', () => {
        it('makes one call with a strict JSON schema, and decodes the answer', async () => {
            const { calls, client } = fakeOpenAI([answer({ name: 'Ada', age: '36', insured: 'true', extra: 'x' })]);
            const engine = await create({ client, reasoningEffort: 'low' });
            const controller = new AbortController();
            const result = await engine.extract(request({ signal: controller.signal }));
            expect(result).to.deep.equal({ model: 'gpt-test-2026-09-01', values: { name: 'Ada', age: 36, insured: true }, usage: { inputTokens: 10, outputTokens: 2 } });
            expect(calls).to.have.length(1);
            const { body, opts } = calls[0];
            expect(body).to.include({ model: 'gpt-test-2026-09-01', reasoning_effort: 'low' });
            expect(body.messages.map((m) => m.role)).to.deep.equal(['system', 'user']);
            expect(body.messages[0].content).to.equal('Fill fields');
            expect(body.response_format.type).to.equal('json_schema');
            expect(body.response_format.json_schema).to.include({ name: 'fields', strict: true });
            expect(body.response_format.json_schema.schema.required).to.deep.equal(['name', 'age', 'insured']);
            expect(body.response_format.json_schema.schema.properties.age).to.deep.equal({ type: 'string' });
            expect(body).to.not.have.property('tools');
            expect(opts.signal).to.equal(controller.signal);
        });

        it('asks for a JSON object with the schema in the prompt, for servers without JSON schemas', async () => {
            const { calls, client } = fakeOpenAI([answer({ name: 'Ada', age: 36, insured: '' })]);
            const engine = await create({ client, structuredOutput: 'json_object' });
            const result = await engine.extract(request());
            expect(result.values).to.deep.equal({ name: 'Ada', age: 36 });
            expect(calls[0].body.response_format).to.deep.equal({ type: 'json_object' });
            expect(calls[0].body.messages[1].content).to.include(JSON.stringify(SCHEMA));
        });

        it('reads a prompted answer from fenced text, with no response format', async () => {
            const { calls, client } = fakeOpenAI([answer('Here you go:\n```json\n{"name": "Ada"}\n```')]);
            const engine = await create({ client, structuredOutput: 'prompt' });
            expect((await engine.extract(request())).values).to.deep.equal({ name: 'Ada' });
            expect(calls[0].body).to.not.have.property('response_format');
        });

        it('fails as an engine error, safe to show, when the answer is prose', async () => {
            const engine = await create({ client: fakeOpenAI([answer('I could not find a name in the notes.')]).client, structuredOutput: 'prompt' });
            const err = await failure(engine.extract(request()));
            expect(err.message).to.equal('The engine did not return a JSON object.');
            expect(err.expose).to.equal(true);
        });

        it('fails as an engine error on a refusal, a truncated answer, a content filter or no answer', async () => {
            const cases = [
                [completion({ content: null, refusal: 'I cannot help with that.' }), 'declined'],
                [answer('{"name":', { choices: [{ finish_reason: 'length', message: { content: '{"name":' } }] }), 'token limit'],
                [answer('', { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }), 'content filter'],
                [{ model: 'm', choices: [] }, 'no answer'],
            ];
            for (const [reply, text] of cases) {
                const engine = await create({ client: fakeOpenAI([reply]).client });
                const err = await failure(engine.extract(request()));
                expect(err.message, text).to.include(text);
                expect(err.expose).to.equal(true);
            }
        });

        it('reports no usage when the server reports none', async () => {
            const engine = await create({ client: fakeOpenAI([answer({ name: 'Ada' }, { usage: undefined })]).client });
            expect(await engine.extract(request())).to.not.have.property('usage');
        });
    });

    describe('research', () => {
        const lookup = { name: 'lookup', description: 'Look up', inputSchema: { type: 'object', properties: { page: { type: 'number' } } } };

        it('calls tools through callTool, returns every result, then answers with tools turned off', async () => {
            const { calls, client } = fakeOpenAI([
                toolTurn([['get_forms', {}], ['find_submissions', { form_name: 'claim' }]]),
                completion({ content: 'I have what I need.' }),
                answer({ name: 'Ada' }),
            ]);
            const engine = await create({ client });
            const called = [];
            const result = await engine.extract(request({
                tools: [lookup],
                callTool: async (name, args) => {
                    called.push([name, args]);
                    return name === 'get_forms' ? { content: [{ type: 'text', text: '["claim"]' }] } : { content: [{ type: 'text', text: 'Not permitted.' }], isError: true };
                },
                maxIterations: 5,
            }));
            expect(called).to.deep.equal([['get_forms', {}], ['find_submissions', { form_name: 'claim' }]]);
            expect(result.toolCalls).to.deep.equal([{ name: 'get_forms', isError: false }, { name: 'find_submissions', isError: true }]);
            expect(result.values).to.deep.equal({ name: 'Ada' });
            expect(result.usage).to.deep.equal({ inputTokens: 30, outputTokens: 6 });
            expect(calls[0].body.tools).to.deep.equal([{ type: 'function', function: { name: 'lookup', description: 'Look up', parameters: lookup.inputSchema } }]);
            expect(calls[0].body).to.not.have.property('response_format');
            const history = calls[1].body.messages;
            expect(history[2].tool_calls).to.have.length(2);
            // A tool error goes back to the model, marked as an error.
            expect(history.slice(3, 5)).to.deep.equal([
                { role: 'tool', tool_call_id: 'call_0', content: '["claim"]' },
                { role: 'tool', tool_call_id: 'call_1', content: 'Error: Not permitted.' },
            ]);
            const final = calls[2].body;
            expect(final.tool_choice).to.equal('none');
            expect(final.response_format.type).to.equal('json_schema');
            expect(final.messages.slice(0, history.length)).to.deep.equal(history);
            expect(final.messages[final.messages.length - 1]).to.deep.include({ role: 'user' });
        });

        it('tells the model when its arguments are not a JSON object, without calling the tool', async () => {
            const { calls, client } = fakeOpenAI([toolTurn([['lookup', '{not json']]), completion({ content: 'done' }), answer({ name: 'Ada' })]);
            const engine = await create({ client });
            let called = 0;
            const result = await engine.extract(request({ tools: [lookup], callTool: async () => { called++; return { content: [] }; }, maxIterations: 3 }));
            expect(called).to.equal(0);
            expect(result.toolCalls).to.deep.equal([]);
            expect(calls[1].body.messages[3].content).to.include('not a JSON object');
        });

        it('stops at the iteration limit and answers with what it has', async () => {
            const { calls, client } = fakeOpenAI(researcher);
            const engine = await create({ client });
            let called = 0;
            const result = await engine.extract(request({ tools: [lookup], callTool: async () => { called++; return { content: [] }; }, maxIterations: 2 }));
            expect(called).to.equal(2);
            expect(calls).to.have.length(3);
            expect(calls[2].body.tool_choice).to.equal('none');
            expect(result.values).to.deep.equal({ name: 'Ada Lovelace' });
        });

        it('stops when its signal is aborted, making no further calls', async () => {
            const { calls, client } = fakeOpenAI(researcher);
            const engine = await create({ client });
            const controller = new AbortController();
            let called = 0;
            const err = await failure(engine.extract(request({
                tools: [lookup],
                callTool: async () => { called++; controller.abort(); return { content: [] }; },
                maxIterations: 5,
                signal: controller.signal,
            })));
            expect(err.name).to.equal('AbortError');
            expect(called).to.equal(1);
            expect(calls).to.have.length(1);
        });
    });
});
