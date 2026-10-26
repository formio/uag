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

    it('defaults to a dated model version, never an alias', () => {
        expect(jev.settings.model.default).to.match(/^jev-\d+\.\d+\.\d+$/);
    });
});
