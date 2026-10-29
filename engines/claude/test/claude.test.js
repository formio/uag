'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const claude = require('..');

const ENV = { CLAUDE_API_KEY: 'sk-ant-test' };

/** A fake Anthropic client recording requests and replying from a script, or from `reply(body)`. */
function fakeAnthropic(replies) {
    const calls = [];
    const respond = async (body, opts) => {
        calls.push({ body, opts });
        return typeof replies === 'function' ? replies(body) : replies.shift();
    };
    return { calls, client: { messages: { create: respond }, beta: { messages: { create: respond } } } };
}

/** Answers like a model that researches whenever it may: a tool call while tools are on, then the fields. */
function researcher(body) {
    if (body.tools && !body.tool_choice) {
        const page = body.messages.length;
        return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${page}`, name: 'lookup', input: { page } }] };
    }
    return { model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: '{"name":"Ada Lovelace","city":"London"}' }], usage: { input_tokens: 5, output_tokens: 5 } };
}

const create = (options, env = ENV, name = 'claude') => createEngine(claude, { name, options, env, config: {} });
const request = (extra = {}) => ({ instructions: 'Fill fields', state: { input: { a: 1 }, today: 'x' }, fields: [], schema: { type: 'object', properties: {}, additionalProperties: false }, ...extra });

describe('Claude engine', () => {
    it('meets the engine contract', async () => {
        const report = await checkEngine(claude, { options: { client: fakeAnthropic(researcher).client }, env: ENV });
        expect(report.failures).to.deep.equal([]);
        expect(report.results.filter((r) => r.skipped)).to.deep.equal([]);
    });

    it('needs an API key, naming the instance and the variables that set it', async () => {
        try {
            await create({}, {}, 'deep');
            expect.fail('expected an error');
        }
        catch (err) {
            expect(err.message).to.equal('The "deep" engine (type "claude") needs its apiKey setting: set UAG_ENGINE_DEEP_API_KEY, CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
        }
    });

    it('runs two instances with their own models and efforts', async () => {
        const env = { ...ENV, UAG_ENGINE_FAST_MODEL: 'claude-haiku-5-5', UAG_ENGINE_DEEP_EFFORT: 'high' };
        const fast = fakeAnthropic(researcher);
        const deep = fakeAnthropic(researcher);
        const engines = [await create({ client: fast.client }, env, 'fast'), await create({ client: deep.client }, env, 'deep')];
        expect(engines.map((e) => [e.name, e.model])).to.deep.equal([['fast', 'claude-haiku-5-5'], ['deep', 'claude-opus-5-5']]);
        await Promise.all(engines.map((engine) => engine.extract(request())));
        expect(fast.calls[0].body.output_config.effort).to.equal('low');
        expect(deep.calls[0].body.output_config.effort).to.equal('high');
    });

    it('refuses an unknown effort or fallbacks value at startup', async () => {
        for (const [env, text] of [[{ UAG_ENGINE_CLAUDE_EFFORT: 'extreme' }, 'effort setting must be one of'], [{ CLAUDE_FALLBACKS: 'sometimes' }, 'fallbacks setting must be']]) {
            try {
                await create({ client: {} }, { ...ENV, ...env });
                expect.fail('expected an error');
            }
            catch (err) {
                expect(err.message).to.include(text);
            }
        }
    });

    it('extracts with one structured-output call and the refusal fallback', async () => {
        const { calls, client } = fakeAnthropic([{ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"lossDate":"2026-10-19"}' }], usage: { input_tokens: 9, output_tokens: 4 } }]);
        const engine = await create({ client });
        const controller = new AbortController();
        const result = await engine.extract(request({ schema: { type: 'object', properties: { lossDate: { type: 'string' } }, additionalProperties: false }, signal: controller.signal }));
        expect(result).to.deep.equal({ model: 'claude-opus-5-5', values: { lossDate: '2026-10-19' }, usage: { inputTokens: 9, outputTokens: 4 } });
        expect(calls).to.have.length(1);
        const { body, opts } = calls[0];
        expect(body.model).to.equal('claude-opus-5-5');
        expect(body.output_config.format).to.deep.equal({ type: 'json_schema', schema: { type: 'object', properties: { lossDate: { type: 'string' } }, additionalProperties: false, required: ['lossDate'] } });
        expect(body.output_config.effort).to.equal('low');
        expect(body.fallbacks).to.equal('default');
        expect(body.betas).to.deep.equal(['server-side-fallback-2026-07-01']);
        expect(body).to.not.have.property('tool_choice');
        expect(opts.signal).to.equal(controller.signal);
    });

    it('asks for every field as required, and decodes the answer back to the UAG\'s types', async () => {
        const answer = { notes: 'Rear-ended', plate: '', count: '3', towed: 'false', kind: 'road', level: '2', areas: { rear: true, front: false }, tags: [], survey: { q1: '', q2: 'yes' }, extra: 'ignored' };
        const { calls, client } = fakeAnthropic([{ model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }]);
        const engine = await create({ client });
        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                notes: { type: 'string' },
                plate: { type: 'string' },
                count: { type: 'number' },
                towed: { type: 'boolean' },
                kind: { enum: ['road', 'home'] },
                level: { enum: [1, 2] },
                areas: { type: 'object', properties: { rear: { type: 'boolean' }, front: { type: 'boolean' } }, additionalProperties: false },
                tags: { type: 'array', items: { type: 'string' } },
                survey: { type: 'object', properties: { q1: { enum: ['yes', 'no'] }, q2: { enum: ['yes', 'no'] } }, additionalProperties: false },
            },
        };
        const result = await engine.extract(request({ schema }));
        expect(calls[0].body.output_config.format.schema.required).to.deep.equal(Object.keys(schema.properties));
        expect(result.values).to.deep.equal({ notes: 'Rear-ended', count: 3, towed: false, kind: 'road', level: 2, areas: { rear: true, front: false }, survey: { q2: 'yes' } });
        expect(result).to.not.have.property('usage');
    });

    it('turns a refusal, a truncated answer or invalid JSON into an engine failure safe to show', async () => {
        const replies = [
            [{ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }, 'declined the request (cyber)'],
            [{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }] }, 'token limit'],
            [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure! Here it is.' }] }, 'valid JSON'],
        ];
        for (const [reply, text] of replies) {
            const engine = await create({ client: fakeAnthropic([reply]).client });
            try {
                await engine.extract(request());
                expect.fail('expected an error');
            }
            catch (err) {
                expect(err.message).to.include(text);
                expect(err.expose).to.equal(true);
            }
        }
    });

    it('researches with the given tools through callTool, then answers with structured output', async () => {
        const { calls, client } = fakeAnthropic([
            { stop_reason: 'tool_use', content: [
                { type: 'tool_use', id: 't1', name: 'get_forms', input: {} },
                { type: 'tool_use', id: 't2', name: 'find_submissions', input: {} },
            ] },
            { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I have what I need.' }] },
            { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"notes":"Second claim this year"}' }] },
        ]);
        const engine = await create({ client, fallbacks: 'off' });
        expect(engine.toolUse).to.equal(true);
        const called = [];
        const result = await engine.extract(request({
            schema: { type: 'object', properties: { notes: { type: 'string' } }, additionalProperties: false },
            tools: [{ name: 'get_forms', description: 'List forms', inputSchema: { type: 'object' } }],
            callTool: async (name) => { called.push(name); return { content: [{ type: 'text', text: 'ok' }], isError: name !== 'get_forms' }; },
            maxIterations: 5,
        }));
        expect(result.values).to.deep.equal({ notes: 'Second claim this year' });
        expect(called).to.deep.equal(['get_forms', 'find_submissions']);
        expect(result.toolCalls).to.deep.equal([{ name: 'get_forms', isError: false }, { name: 'find_submissions', isError: true }]);
        // Every result of a turn goes back in one message.
        const second = calls[1].body.messages;
        expect(second[2].role).to.equal('user');
        expect(second[2].content).to.have.length(2);
        expect(second[2].content[1]).to.include({ tool_use_id: 't2', is_error: true, content: 'ok' });
        expect(calls[0].body.tools).to.deep.equal([{ name: 'get_forms', description: 'List forms', input_schema: { type: 'object' } }]);
        expect(calls[0].body.output_config).to.deep.equal({ effort: 'medium' });
        // The answer: the same history, tools turned off, structured output on.
        const final = calls[2].body;
        expect(final.tool_choice).to.deep.equal({ type: 'none' });
        expect(final.output_config.format.type).to.equal('json_schema');
        expect(final.messages.slice(0, second.length)).to.deep.equal(second);
        expect(final).to.not.have.property('fallbacks');
    });

    it('fails as an engine error when a research turn stops at the token limit, sending no unanswered tool call', async () => {
        const { calls, client } = fakeAnthropic([{ stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't1', name: 'lookup', input: {} }] }]);
        const engine = await create({ client });
        let called = 0;
        const err = await engine.extract(request({ tools: [{ name: 'lookup', description: 'd', inputSchema: { type: 'object' } }], maxIterations: 3, callTool: async () => { called++; return { content: [] }; } }))
            .then(() => null, (e) => e);
        expect(err && err.name).to.equal('EngineError');
        expect(err.message).to.equal('Claude stopped at the token limit while researching.');
        expect(called).to.equal(0);
        expect(calls).to.have.length(1);
    });

    it('records tool calls in the order Claude made them, and returns a call that throws as a tool error', async () => {
        const { calls, client } = fakeAnthropic([
            { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'slow', input: {} }, { type: 'tool_use', id: 't2', name: 'fast', input: {} }, { type: 'tool_use', id: 't3', name: 'broken', input: {} }] },
            { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
            { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] },
        ]);
        const engine = await create({ client });
        const finished = [];
        const result = await engine.extract(request({
            tools: [{ name: 'slow', description: 'd', inputSchema: { type: 'object' } }],
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
        expect(calls[1].body.messages[2].content.map((block) => block.content)).to.deep.equal(['slow', 'fast', 'The tool call failed.']);
    });

    it('answers when research reaches the iteration limit', async () => {
        const { calls, client } = fakeAnthropic(researcher);
        const engine = await create({ client });
        let called = 0;
        await engine.extract(request({
            tools: [{ name: 'lookup', description: 'Look up', inputSchema: { type: 'object' } }],
            callTool: async () => { called++; return { content: [] }; },
            maxIterations: 2,
        }));
        expect(called).to.equal(2);
        expect(calls).to.have.length(3);
        expect(calls[2].body.tool_choice).to.deep.equal({ type: 'none' });
    });

    it('stops researching when its signal is aborted, making no further calls', async () => {
        const { calls, client } = fakeAnthropic(researcher);
        const engine = await create({ client });
        const controller = new AbortController();
        let called = 0;
        try {
            await engine.extract(request({
                tools: [{ name: 'lookup', description: 'Look up', inputSchema: { type: 'object' } }],
                callTool: async () => { called++; controller.abort(); return { content: [] }; },
                maxIterations: 5,
                signal: controller.signal,
            }));
            expect.fail('expected an abort');
        }
        catch (err) {
            expect(err.name).to.equal('AbortError');
        }
        expect(called).to.equal(1);
        expect(calls).to.have.length(1);
    });

    it('defaults to the latest Opus model', () => {
        expect(claude.settings.model.default).to.equal('claude-opus-5-5');
    });
});
