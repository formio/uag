'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const jev = require('..');

/** A fake TypeSafe client: records requests, honours the signal, and answers every question it is sent. */
function fakeClient(answers) {
    const calls = [];
    return {
        calls,
        async systemOne(request, options) {
            calls.push({ request, options });
            options.signal?.throwIfAborted();
            return {
                model: request.model,
                usage: { input_tokens: 100, output_tokens: 3 },
                answers: answers || Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [id,
                    q.type === 'choice' ? { type: 'choice', choice: Object.keys(q.criteria)[0], probabilities: { [Object.keys(q.criteria)[0]]: 0.9 }, confidence: 0.8 }
                        : q.type === 'score' ? { type: 'score', score: 1, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 }, confidence: 0.7 }
                            : { type: 'noul', noul: 0.3 }])),
            };
        },
    };
}

const create = (options = {}, env = { TYPESAFE_API_KEY: 'ts-test' }, config = {}, name = 'jev') =>
    createEngine(jev, { name, options, env, config });

describe('Jev engine', () => {
    it('meets the engine contract', async () => {
        const report = await checkEngine(jev, { options: { client: fakeClient() }, env: { TYPESAFE_API_KEY: 'ts-test' } });
        expect(report.failures).to.deep.equal([]);
    });

    it('needs an API key, naming the instance and the variables that set it', async () => {
        try {
            await create({}, {}, {}, 'next');
            expect.fail('expected an error');
        }
        catch (err) {
            expect(err.message).to.equal('The "next" engine (type "jev") needs its apiKey setting: set UAG_ENGINE_NEXT_API_KEY or TYPESAFE_API_KEY.');
        }
    });

    it('maps questions to the SDK and answers back, sending the pinned model, the signal and its own routing timeout', async () => {
        const client = fakeClient({
            'choice:a': { type: 'choice', choice: 'X', probabilities: { X: 0.9, Y: 0.1 }, confidence: 0.8 },
            'score:b': { type: 'score', score: 1.2, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 }, confidence: 0.7, legend: {} },
            'affirm:c': { type: 'noul', noul: 0.95 },
            'unasked': { type: 'noul', noul: 0.5 },
        });
        const engine = await create({ client }, { TYPESAFE_API_KEY: 'ts-test', UAG_ENGINE_NEXT_MODEL: 'jev-1.14.0' }, { routing: { timeouts: { next: 1500, jev: 9000 } } }, 'next');
        expect(engine).to.include({ name: 'next', model: 'jev-1.14.0', maxOptions: 255 });
        const controller = new AbortController();
        const result = await engine.decide({
            state: { input: { Description: 'x' }, today: 't' },
            questions: {
                'choice:a': { type: 'choice', instructions: 'Which?', options: { X: 'the x one', Y: null } },
                'score:b': { type: 'score', instructions: 'How much?', levels: ['low: a', 'mid: b', 'high: c'] },
                'affirm:c': { type: 'noul', instructions: 'Is it?', criteria: { true: 'yes', false: 'no' } },
            },
            signal: controller.signal,
        });
        const [{ request, options }] = client.calls;
        expect(request.model).to.equal('jev-1.14.0');
        expect(request.questions['choice:a']).to.deep.equal({ type: 'choice', instructions: 'Which?', criteria: { X: 'the x one', Y: null } });
        expect(request.questions['score:b'].criteria).to.deep.equal(['low: a', 'mid: b', 'high: c']);
        expect(options).to.deep.equal({ signal: controller.signal, timeout: 1500 });
        expect(result.answers).to.deep.equal({
            'choice:a': { type: 'choice', choice: 'X', probabilities: { X: 0.9, Y: 0.1 }, confidence: 0.8 },
            'score:b': { type: 'score', score: 1.2, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 }, confidence: 0.7 },
            'affirm:c': { type: 'noul', probability: 0.95 },
        });
        expect(result.usage).to.deep.equal({ inputTokens: 100, outputTokens: 3 });
    });

    it('falls back to the default timeout without a routing timeout', async () => {
        const client = fakeClient();
        const engine = await create({ client });
        await engine.decide({ state: { input: {}, today: 't' }, questions: { q: { type: 'noul', instructions: 'x' } } });
        expect(client.calls[0].options.timeout).to.equal(30000);
    });

    it('makes no call once its signal is aborted', async () => {
        let called = 0;
        const engine = await create({ client: { systemOne: async () => { called++; return { answers: {} }; } } });
        const controller = new AbortController();
        controller.abort();
        try {
            await engine.decide({ state: { input: {}, today: 't' }, questions: { q: { type: 'noul', instructions: 'x' } }, signal: controller.signal });
            expect.fail('expected an abort');
        }
        catch (err) {
            expect(err.name).to.equal('AbortError');
        }
        expect(called).to.equal(0);
    });

    it('keeps only the options asked, and scores within the levels', async () => {
        const client = fakeClient({
            pick: { type: 'choice', choice: 'constructor', probabilities: { X: 0.5 }, confidence: 0.1 },
            other: { type: 'choice', choice: 'Z', probabilities: { Z: 1 }, confidence: 1 },
            size: { type: 'score', score: 7, probabilities: { 0: 0, 1: 0, 2: 1 }, confidence: 0.9 },
            low: { type: 'score', score: -1, probabilities: { 0: 1 }, confidence: 0.9 },
            wrong: { type: 'noul', noul: 0.4 },
        });
        const engine = await create({ client });
        const { answers } = await engine.decide({
            state: { input: {}, today: 't' },
            questions: {
                pick: { type: 'choice', instructions: 'Which?', options: { X: null, Y: null } },
                other: { type: 'choice', instructions: 'Which?', options: { X: null, Y: null } },
                size: { type: 'score', instructions: 'How big?', levels: ['S', 'M', 'L'] },
                low: { type: 'score', instructions: 'How big?', levels: ['S', 'M', 'L'] },
                wrong: { type: 'choice', instructions: 'Which?', options: { X: null } },
            },
        });
        expect(Object.keys(answers)).to.deep.equal(['size', 'low']);
        expect(answers.size.score).to.equal(2);
        expect(answers.low.score).to.equal(0);
    });

    it('reports a refused key, rate limits and server failures as safe engine errors, without the response', async () => {
        const failing = (status) => ({ systemOne: async () => { throw Object.assign(new Error(`${status} {"echo":"submission data"}`), { status }); } });
        for (const [status, text] of [[401, 'API key'], [403, 'API key'], [429, 'rate-limiting'], [503, 'HTTP 503']]) {
            const engine = await create({ client: failing(status) });
            const err = await engine.decide({ state: { input: {}, today: 't' }, questions: { q: { type: 'noul', instructions: 'x' } } }).catch((e) => e);
            expect(err.name, String(status)).to.equal('EngineError');
            expect(err.expose).to.equal(true);
            expect(err.message).to.include(text).and.not.include('submission data');
        }
        const engine = await create({ client: failing(422) });
        const err = await engine.decide({ state: { input: {}, today: 't' }, questions: { q: { type: 'noul', instructions: 'x' } } }).catch((e) => e);
        expect(err.expose).to.equal(undefined);
    });

    it('waits no longer than its timeout for a Retry-After, with the real client', async () => {
        const saved = globalThis.fetch;
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            return new Response(JSON.stringify({ error: 'slow down' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3' } });
        };
        try {
            const engine = await create({}, { TYPESAFE_API_KEY: 'ts-test' }, { agentApi: { timeout: 400 } });
            const started = Date.now();
            const err = await engine.decide({ state: { input: {}, today: 't' }, questions: { q: { type: 'noul', instructions: 'x' } } }).catch((e) => e);
            expect(err.name).to.equal('EngineError');
            expect(err.message).to.include('rate-limiting');
            expect(calls).to.equal(3);
            expect(Date.now() - started).to.be.below(2000);
        }
        finally {
            globalThis.fetch = saved;
        }
    });

    it('defaults to a dated model version, never an alias', () => {
        expect(jev.settings.model.default).to.match(/^jev-\d+\.\d+\.\d+$/);
    });
});
