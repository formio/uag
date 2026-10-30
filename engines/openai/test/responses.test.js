'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const openai = require('..');

const ENV = { OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-6.1-sol' };
const SCHEMA = { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, age: { type: 'number' } } };
const request = (extra = {}) => ({ instructions: 'Fill fields', state: { input: { Notes: 'Ada, 36' }, today: 'x' }, fields: [], schema: SCHEMA, ...extra });

/** A Responses API answer. */
function response(output, extra = {}) {
    return { id: 'resp_1', object: 'response', status: 'completed', model: 'gpt-6.1-sol-2026-10-01', output, usage: { input_tokens: 10, output_tokens: 4 }, ...extra };
}
const reasoning = (id) => ({ type: 'reasoning', id, encrypted_content: `enc-${id}`, summary: [] });
const text = (value) => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const call = (id, name, args) => ({ type: 'function_call', call_id: id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });

/** A fake Responses client recording requests and replying from a script, or from `reply(body)`. */
function fakeResponses(replies) {
    const calls = [];
    return {
        calls,
        client: {
            responses: {
                async create(body, opts) {
                    calls.push({ body: structuredClone(body), opts });
                    return typeof replies === 'function' ? replies(body) : replies.shift();
                },
            },
        },
    };
}

/** Researches whenever tools are on, then answers. */
function researcher(body) {
    if (body.tools && body.tool_choice !== 'none') {
        return response([reasoning(`r${body.input.length}`), call(`c${body.input.length}`, 'lookup', { page: body.input.length })]);
    }
    return response([reasoning('final'), text({ name: 'Ada Lovelace', city: 'London' })]);
}

const create = (options, env = ENV, name = 'openai') => createEngine(openai, { name, options, env, config: {} });

async function failure(promise) {
    try {
        await promise;
    }
    catch (err) {
        return err;
    }
    throw new Error('expected a failure');
}

describe('OpenAI engine, on the Responses API', () => {
    it('meets the engine contract in every structured-output mode', async () => {
        for (const mode of ['json_schema', 'json_object', 'prompt']) {
            const report = await checkEngine(openai, { options: { client: fakeResponses(researcher).client, structuredOutput: mode }, env: ENV });
            expect(report.failures, mode).to.deep.equal([]);
            expect(report.results.filter((r) => r.skipped), mode).to.deep.equal([]);
        }
    });

    it('is the default for OpenAI itself, and Chat Completions for any other server', async () => {
        const own = fakeResponses([response([text({ name: 'Ada' })])]);
        await (await create({ client: own.client })).extract(request());
        expect(own.calls).to.have.length(1);
        const chat = { chat: { completions: { create: async () => ({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: '{"name":"Ada"}' } }] }) } } };
        const local = await create({ client: chat }, { OPENAI_MODEL: 'llama', OPENAI_BASE_URL: 'http://ollama:11434/v1' });
        expect((await local.extract(request())).values).to.deep.equal({ name: 'Ada' });
        const forced = fakeResponses([response([text({ name: 'Ada' })])]);
        await (await create({ client: forced.client }, { OPENAI_MODEL: 'm', OPENAI_BASE_URL: 'https://gateway.example/v1', OPENAI_API: 'responses' })).extract(request());
        expect(forced.calls).to.have.length(1);
        // OpenAI named explicitly is still OpenAI.
        const named = fakeResponses([response([text({ name: 'Ada' })])]);
        await (await create({ client: named.client }, { ...ENV, OPENAI_BASE_URL: 'https://api.openai.com/v1' })).extract(request());
        expect(named.calls).to.have.length(1);
        const err = await failure(create({ client: {} }, { ...ENV, OPENAI_API: 'assistants' }));
        expect(err.message).to.include('api setting must be one of responses, chat');
    });

    it('stores nothing at OpenAI, and asks for a strict JSON schema with instructions apart from the input', async () => {
        const { calls, client } = fakeResponses([response([reasoning('a'), text({ name: 'Ada', age: '36', extra: 'x' })])]);
        const engine = await create({ client, reasoningEffort: 'medium' });
        const controller = new AbortController();
        const result = await engine.extract(request({ signal: controller.signal }));
        expect(result).to.deep.equal({ model: 'gpt-6.1-sol-2026-10-01', values: { name: 'Ada', age: 36 }, usage: { inputTokens: 10, outputTokens: 4 } });
        const [{ body, opts }] = calls;
        expect(body).to.include({ model: 'gpt-6.1-sol', store: false, instructions: 'Fill fields' });
        expect(body.include).to.deep.equal(['reasoning.encrypted_content']);
        expect(body.reasoning).to.deep.equal({ effort: 'medium' });
        expect(body.input).to.have.length(1);
        expect(body.input[0].role).to.equal('user');
        expect(body.text.format).to.include({ type: 'json_schema', name: 'fields', strict: true });
        expect(body.text.format.schema.required).to.deep.equal(['name', 'age']);
        expect(body).to.not.have.property('tools');
        expect(body).to.not.have.property('max_output_tokens');
        expect(opts.signal).to.equal(controller.signal);
    });

    it('asks for a JSON object, or nothing, in the other modes', async () => {
        const object = fakeResponses([response([text({ name: 'Ada', age: 36 })])]);
        expect((await (await create({ client: object.client, structuredOutput: 'json_object' })).extract(request())).values).to.deep.equal({ name: 'Ada', age: 36 });
        expect(object.calls[0].body.text).to.deep.equal({ format: { type: 'json_object' } });
        expect(object.calls[0].body.input[0].content).to.include(JSON.stringify(SCHEMA));
        const prompted = fakeResponses([response([text('Here:\n```json\n{"name":"Ada"}\n```')])]);
        expect((await (await create({ client: prompted.client, structuredOutput: 'prompt' })).extract(request())).values).to.deep.equal({ name: 'Ada' });
        expect(prompted.calls[0].body).to.not.have.property('text');
    });

    it('researches with function tools while reasoning, passing back the reasoning and every result', async () => {
        const { calls, client } = fakeResponses([
            response([reasoning('r1'), call('c1', 'get_forms', {}), call('c2', 'find_submissions', { form_name: 'claim' })]),
            response([reasoning('r2'), text('I have what I need.')]),
            response([reasoning('r3'), text({ name: 'Ada' })]),
        ]);
        const engine = await create({ client });
        const called = [];
        const lookup = { name: 'get_forms', description: 'List forms', inputSchema: { type: 'object' } };
        const result = await engine.extract(request({
            tools: [lookup],
            maxIterations: 5,
            callTool: async (name, args) => {
                called.push([name, args]);
                return name === 'get_forms' ? { content: [{ type: 'text', text: '["claim"]' }] } : { content: [{ type: 'text', text: 'Not permitted.' }], isError: true };
            },
        }));
        expect(called).to.deep.equal([['get_forms', {}], ['find_submissions', { form_name: 'claim' }]]);
        expect(result.toolCalls).to.deep.equal([{ name: 'get_forms', isError: false }, { name: 'find_submissions', isError: true }]);
        expect(result.values).to.deep.equal({ name: 'Ada' });
        expect(result.usage).to.deep.equal({ inputTokens: 30, outputTokens: 12 });
        expect(calls[0].body.tools).to.deep.equal([{ type: 'function', name: 'get_forms', description: 'List forms', parameters: { type: 'object' }, strict: false }]);
        expect(calls[0].body).to.not.have.property('text');
        expect(calls[0].body).to.not.have.property('tool_choice');
        // The second turn carries the first turn's reasoning, calls and their results.
        const second = calls[1].body.input;
        expect(second.slice(1)).to.deep.equal([
            reasoning('r1'), call('c1', 'get_forms', {}), call('c2', 'find_submissions', { form_name: 'claim' }),
            { type: 'function_call_output', call_id: 'c1', output: '["claim"]' },
            { type: 'function_call_output', call_id: 'c2', output: 'Error: Not permitted.' },
        ]);
        // The answer: the same history, tools turned off, the structured format on.
        const final = calls[2].body;
        expect(final.tool_choice).to.equal('none');
        expect(final.text.format.type).to.equal('json_schema');
        expect(final.input.slice(0, second.length)).to.deep.equal(second);
        expect(final.input[final.input.length - 1]).to.deep.include({ role: 'user' });
        for (const { body } of calls) expect(body.store).to.equal(false);
    });

    it('tells the model when its arguments are not a JSON object, without calling the tool', async () => {
        const { calls, client } = fakeResponses([response([call('c1', 'get_forms', '{not json')]), response([text('ok')]), response([text({ name: 'Ada' })])]);
        let called = 0;
        const result = await (await create({ client })).extract(request({ tools: [{ name: 'get_forms', description: 'd', inputSchema: {} }], maxIterations: 3, callTool: async () => { called++; return { content: [] }; } }));
        expect(called).to.equal(0);
        expect(result.toolCalls).to.deep.equal([]);
        expect(calls[1].body.input[2].output).to.include('not a JSON object');
    });

    it('records tool calls in the order the model made them, and returns a call that throws as a tool error', async () => {
        const { calls, client } = fakeResponses([response([call('c1', 'slow', {}), call('c2', 'fast', {}), call('c3', 'broken', {})]), response([text('ok')]), response([text({ name: 'Ada' })])]);
        const finished = [];
        const result = await (await create({ client })).extract(request({
            tools: [{ name: 'slow', description: 'd', inputSchema: {} }],
            maxIterations: 3,
            callTool: async (name) => {
                if (name === 'broken') throw new Error('internal detail');
                await new Promise((resolve) => setTimeout(resolve, name === 'slow' ? 30 : 0));
                finished.push(name);
                return { content: [{ type: 'text', text: name }] };
            },
        }));
        expect(finished).to.deep.equal(['fast', 'slow']);
        expect(result.toolCalls).to.deep.equal([{ name: 'slow', isError: false }, { name: 'fast', isError: false }, { name: 'broken', isError: true }]);
        expect(calls[1].body.input.slice(4)).to.deep.equal([
            { type: 'function_call_output', call_id: 'c1', output: 'slow' },
            { type: 'function_call_output', call_id: 'c2', output: 'fast' },
            { type: 'function_call_output', call_id: 'c3', output: 'Error: The tool call failed.' },
        ]);
    });

    it('stops at the iteration limit, and when its signal is aborted', async () => {
        const limited = fakeResponses(researcher);
        let called = 0;
        await (await create({ client: limited.client })).extract(request({ tools: [{ name: 'lookup', description: 'd', inputSchema: {} }], maxIterations: 2, callTool: async () => { called++; return { content: [] }; } }));
        expect(called).to.equal(2);
        expect(limited.calls).to.have.length(3);

        const aborting = fakeResponses(researcher);
        const controller = new AbortController();
        let calledBeforeAbort = 0;
        const err = await failure((await create({ client: aborting.client })).extract(request({
            tools: [{ name: 'lookup', description: 'd', inputSchema: {} }],
            maxIterations: 5,
            signal: controller.signal,
            callTool: async () => { calledBeforeAbort++; controller.abort(); return { content: [] }; },
        })));
        expect(err.name).to.equal('AbortError');
        expect(calledBeforeAbort).to.equal(1);
        expect(aborting.calls).to.have.length(1);
    });

    it('fails as an engine error, safe to show, on a refusal, an incomplete answer, or no JSON', async () => {
        const cases = [
            [response([{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot.' }] }]), 'declined'],
            [response([text('{"name":')], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'token limit'],
            [response([], { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }), 'content filter'],
            [response([text('I could not find a name.')]), 'did not return a JSON object'],
        ];
        for (const [reply, message] of cases) {
            const err = await failure((await create({ client: fakeResponses([reply]).client })).extract(request()));
            expect(err.message, message).to.include(message);
            expect(err.expose).to.equal(true);
        }
    });

    it('reports no usage when the API reports none', async () => {
        const engine = await create({ client: fakeResponses([response([text({ name: 'Ada' })], { usage: undefined })]).client });
        expect(await engine.extract(request())).to.not.have.property('usage');
    });
});

describe('OpenAI strict schemas and string formats', () => {
    const dated = {
        type: 'object',
        additionalProperties: false,
        properties: {
            born: { type: 'string', format: 'date', description: 'Date of birth.' },
            at: { type: 'string', format: 'date-time' },
            code: { type: 'string', pattern: '^[A-Z]{3}$' },
            grid: { type: 'array', items: { type: 'object', properties: { when: { type: 'string', format: 'date' } } } },
        },
    };

    it('writes formats and patterns into the descriptions when talking to OpenAI itself', async () => {
        for (const api of ['responses', 'chat']) {
            const sent = [];
            const client = {
                responses: { create: async (body) => { sent.push(body.text.format.schema); return response([text({ born: '1815-12-10' })]); } },
                chat: { completions: { create: async (body) => { sent.push(body.response_format.json_schema.schema); return { model: 'm', choices: [{ finish_reason: 'stop', message: { content: '{"born":"1815-12-10"}' } }] }; } } },
            };
            const engine = await create({ client, api });
            expect((await engine.extract(request({ schema: dated }))).values).to.deep.equal({ born: '1815-12-10' });
            const { properties } = sent[0];
            expect(properties.born).to.deep.equal({ type: 'string', description: 'Date of birth. Write it as a date, YYYY-MM-DD.' });
            expect(properties.at).to.deep.equal({ type: 'string', description: 'Write it as an ISO 8601 date and time, such as 2026-10-22T14:30:00Z.' });
            expect(properties.code).to.deep.equal({ type: 'string', description: 'It must match the regular expression ^[A-Z]{3}$.' });
            expect(properties.grid.items.properties.when).to.deep.equal({ type: 'string', description: 'Write it as a date, YYYY-MM-DD.' });
            expect(JSON.stringify(sent[0])).to.not.include('"format"').and.not.include('"pattern"');
        }
    });

    it('keeps them as constraints for any other server', async () => {
        const sent = [];
        const client = { chat: { completions: { create: async (body) => { sent.push(body.response_format.json_schema.schema); return { model: 'm', choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }; } } } };
        const engine = await create({ client }, { OPENAI_MODEL: 'llama', OPENAI_BASE_URL: 'http://ollama:11434/v1' });
        await engine.extract(request({ schema: dated }));
        expect(sent[0].properties.born).to.include({ format: 'date' });
        expect(sent[0].properties.code).to.include({ pattern: '^[A-Z]{3}$' });
    });
});
