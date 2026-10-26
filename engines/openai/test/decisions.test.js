'use strict';
const { expect } = require('chai');
const { createEngine } = require('@formio/uag-sdk/loader');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const openai = require('..');

const ENV = { OPENAI_API_KEY: 'sk-test', UAG_ENGINE_DECIDE_KIND: 'decision', UAG_ENGINE_DECIDE_MODEL: 'gpt-6-luna' };
const state = { input: { 'What happened?': 'My car was stolen. Nobody was hurt.' }, today: 'Thursday, October 22, 2026 (2026-10-22)' };

/**
 * A fake Decisions API: answers every question the way the real one would,
 * unless `reply(body)` is given. Records each request.
 */
function fakeDecisions(reply) {
    const calls = [];
    const answer = (question) => {
        if (question.type === 'predicate') return { type: 'predicate', name: question.name, probability: 0.9 };
        if (question.type === 'choice') {
            const values = question.choices.map((c) => c.value);
            return { type: 'choice', name: question.name, choice: values[0], confidence: 0.7, probabilities: values.map((value, i) => ({ value, probability: i === 0 ? 0.85 : 0.15 / (values.length - 1) })) };
        }
        return { type: 'score', name: question.name, score: 1.2, confidence: 0.6, probabilities: question.levels.map((level, value) => ({ label: level.label, value, probability: value === 1 ? 0.7 : 0.3 / (question.levels.length - 1) })) };
    };
    return {
        calls,
        client: {
            decisions: {
                async create(body, opts) {
                    calls.push({ body, opts });
                    opts?.signal?.throwIfAborted();
                    if (reply) return reply(body);
                    return { model: 'gpt-6-luna-2026-09-29', answers: body.questions.map(answer), usage: { input_tokens: 40, output_tokens: 0 } };
                },
            },
        },
    };
}

const create = (options, env = ENV, name = 'decide') => createEngine(openai, { name, options, env, config: {} });

describe('OpenAI decision kind', () => {
    it('meets the engine contract as a decision engine', async () => {
        const report = await checkEngine(openai, { name: 'decide', options: { client: fakeDecisions().client }, env: ENV });
        expect(report.failures).to.deep.equal([]);
    });

    it('is an agent engine unless told otherwise', async () => {
        const agent = await create({ client: {} }, { OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' }, 'openai');
        expect(agent.kind).to.equal('agent');
        const decision = await create({ client: {} });
        expect(decision).to.include({ kind: 'decision', name: 'decide', model: 'gpt-6-luna', maxOptions: 255 });
        expect((await create({ client: {} }, { ...ENV, UAG_ENGINE_DECIDE_MAX_OPTIONS: '100' })).maxOptions).to.equal(100);
    });

    it('refuses an unknown kind or option limit, naming the instance', async () => {
        for (const [env, text] of [[{ UAG_ENGINE_DECIDE_KIND: 'classifier' }, 'kind setting must be one of agent, decision'], [{ UAG_ENGINE_DECIDE_MAX_OPTIONS: '1' }, 'maxOptions']]) {
            try {
                await create({ client: {} }, { ...ENV, ...env });
                expect.fail('expected an error');
            }
            catch (err) {
                expect(err.message).to.include('"decide"').and.include(text);
            }
        }
    });

    it('maps each question type to the Decisions API and the answers back', async () => {
        const { calls, client } = fakeDecisions();
        const engine = await create({ client });
        const controller = new AbortController();
        const result = await engine.decide({
            state,
            signal: controller.signal,
            questions: {
                'choice:triage.claimType': { type: 'choice', instructions: 'What kind of claim is this?', options: { Theft: 'Something was stolen.', Collision: null } },
                'score:triage.severity': { type: 'score', instructions: 'How severe is the loss?', levels: ['Minor', 'Moderate', 'Severe'] },
                'affirm:triage.injury': { type: 'noul', instructions: 'Does the input say someone was hurt?', criteria: { true: 'An injury is described.', false: 'It says nobody was hurt.' } },
            },
        });
        const [{ body, opts }] = calls;
        expect(body.model).to.equal('gpt-6-luna');
        expect(JSON.parse(body.input)).to.deep.equal(state);
        expect(opts.signal).to.equal(controller.signal);
        expect(body.questions).to.deep.equal([
            { type: 'choice', name: 'q0', instructions: 'What kind of claim is this?', choices: [{ value: 'Theft', description: 'Something was stolen.' }, { value: 'Collision' }] },
            { type: 'score', name: 'q1', instructions: 'How severe is the loss?', levels: [{ label: 'Minor' }, { label: 'Moderate' }, { label: 'Severe' }] },
            { type: 'predicate', name: 'q2', instructions: 'Does the input say someone was hurt?\nIt holds when: An injury is described.\nIt does not hold when: It says nobody was hurt.' },
        ]);
        expect(result).to.deep.equal({
            model: 'gpt-6-luna-2026-09-29',
            answers: {
                'choice:triage.claimType': { type: 'choice', choice: 'Theft', probabilities: { Theft: 0.85, Collision: 0.15 }, confidence: 0.7 },
                'score:triage.severity': { type: 'score', score: 1.2, probabilities: { 0: 0.15, 1: 0.7, 2: 0.15 }, confidence: 0.6 },
                'affirm:triage.injury': { type: 'noul', probability: 0.9 },
            },
            usage: { inputTokens: 40, outputTokens: 0 },
        });
    });

    it('leaves a declined question unanswered, and drops answers to questions it did not ask or that do not fit', async () => {
        const { client } = fakeDecisions((body) => ({
            model: 'gpt-6-luna',
            answers: [
                { type: 'refusal', name: 'q0' },
                { type: 'choice', name: 'q1', choice: 'Fire', confidence: 1, probabilities: [{ value: 'Fire', probability: 1 }] },
                { type: 'predicate', name: 'q2', probability: 0.4 },
                { type: 'predicate', name: 'q9', probability: 1 },
                { type: 'score', name: 'q2', score: 1, confidence: 1, probabilities: [] },
                { type: 'score', name: 'q3', score: 1, confidence: 0.5, probabilities: [{ label: 'Low', value: 0, probability: 0.2 }, { label: 'High', value: 1, probability: 0.7 }, { label: '?', value: 7, probability: 0.1 }] },
            ],
        }));
        const engine = await create({ client });
        const { answers } = await engine.decide({
            state,
            questions: {
                a: { type: 'noul', instructions: 'Declined?' },
                b: { type: 'choice', instructions: 'Which?', options: { Theft: null, Collision: null } },
                c: { type: 'noul', instructions: 'Answered?' },
                d: { type: 'score', instructions: 'How much?', levels: ['Low', 'High'] },
            },
        });
        expect(answers).to.deep.equal({
            c: { type: 'noul', probability: 0.4 },
            // Only levels the question has.
            d: { type: 'score', score: 1, probabilities: { 0: 0.2, 1: 0.7 }, confidence: 0.5 },
        });
    });

    it('splits more than 400 questions across calls, and combines the answers', async () => {
        const { calls, client } = fakeDecisions();
        const engine = await create({ client });
        const questions = Object.fromEntries(Array.from({ length: 950 }, (_, i) => [`mention:field${i}`, { type: 'noul', instructions: `Is field ${i} mentioned?` }]));
        const { answers, usage } = await engine.decide({ state, questions });
        expect(calls.map((call) => call.body.questions.length)).to.deep.equal([400, 400, 150]);
        expect(calls[2].body.questions[0].name).to.equal('q800');
        expect(Object.keys(answers)).to.have.length(950);
        expect(answers['mention:field949']).to.deep.equal({ type: 'noul', probability: 0.9 });
        expect(usage).to.deep.equal({ inputTokens: 120, outputTokens: 0 });
    });

    it('fails as an engine error when the API answers nothing usable, and stops when aborted', async () => {
        const engine = await create({ client: fakeDecisions(() => ({ model: 'm' })).client });
        const err = await engine.decide({ state, questions: { a: { type: 'noul', instructions: 'x' } } }).then(() => null, (e) => e);
        expect(err.message).to.equal('The Decisions API returned no answers.');
        expect(err.expose).to.equal(true);

        const { calls, client } = fakeDecisions();
        const aborted = new AbortController();
        aborted.abort();
        const abortErr = await (await create({ client })).decide({ state, questions: { a: { type: 'noul', instructions: 'x' } }, signal: aborted.signal }).then(() => null, (e) => e);
        expect(abortErr.name).to.equal('AbortError');
        expect(calls).to.have.length(0);
        const empty = await (await create({ client })).decide({ state, questions: {}, signal: aborted.signal }).then(() => null, (e) => e);
        expect(empty.name).to.equal('AbortError');
    });
});
