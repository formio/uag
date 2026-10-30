'use strict';
const { expect } = require('chai');
const { defineEngine, EngineError } = require('..');
const { checkEngine } = require('../conformance');

/** A well-behaved scripted agent: researches until told to stop, honours its signal and its limits. */
function agentType(overrides = {}) {
    return defineEngine({
        type: 'scripted',
        kinds: ['agent'],
        apiVersion: 1,
        settings: { model: { default: 'scripted-1' } },
        create: ({ name, settings }) => ({
            name,
            kind: 'agent',
            apiVersion: 1,
            model: settings.model,
            toolUse: true,
            async extract(request) {
                request.signal?.throwIfAborted();
                const toolCalls = [];
                for (let round = 0; request.tools && round < (overrides.rounds ?? request.maxIterations); round++) {
                    const calls = await Promise.all([1, 2].map(async (page) => {
                        const result = await request.callTool('lookup', { page });
                        return { name: 'lookup', isError: !!result.isError };
                    }));
                    toolCalls.push(...calls);
                    if (!overrides.ignoreAbort) request.signal?.throwIfAborted();
                }
                if (overrides.lateAbort) request.signal?.throwIfAborted();
                const values = { name: 'Ada Lovelace', city: 'London', ...overrides.extra };
                return { model: settings.model, values, ...(toolCalls.length && { toolCalls: overrides.reported ? overrides.reported(toolCalls) : toolCalls }) };
            },
        }),
        ...overrides.definition,
    });
}

const decisionType = (overrides = {}) => defineEngine({
    type: 'fixed',
    kinds: ['decision'],
    apiVersion: 1,
    create: ({ name }) => ({
        name,
        kind: 'decision',
        model: 'fixed-1',
        maxOptions: 255,
        async decide({ questions, signal }) {
            if (!overrides.ignoreAbort) signal?.throwIfAborted();
            const answers = {
                colour: { type: 'choice', choice: 'Red', probabilities: { Red: 0.9, Blue: 0.1 }, confidence: 0.8 },
                size: { type: 'score', score: 1.2, probabilities: { 0: 0.1, 1: 0.6, 2: 0.3 }, confidence: 0.4 },
                urgent: { type: 'noul', probability: 0.2 },
                ...overrides.answers,
            };
            return { model: 'fixed-1', answers: Object.fromEntries(Object.entries(answers).filter(([id]) => overrides.answers?.[id] || questions[id])) };
        },
    }),
});

describe('conformance check', () => {
    it('checks a definition made without defineEngine that has no settings', async () => {
        const plain = {
            type: 'plain',
            kinds: ['decision'],
            apiVersion: 1,
            create: (context) => decisionType().create(context),
        };
        const report = await checkEngine(plain);
        expect(report.failures).to.deep.equal([]);
        expect(report.ok).to.equal(true);
    });

    it('passes a conforming agent engine', async () => {
        const report = await checkEngine(agentType());
        expect(report.failures).to.deep.equal([]);
        expect(report.results.map((r) => r.check)).to.include('research reports its tool calls and stops at maxIterations');
    });

    it('fails an engine that returns fields it was not asked about, naming them', async () => {
        const report = await checkEngine(agentType({ extra: { gpa: 4, admitted: true } }));
        expect(report.ok).to.equal(false);
        expect(report.failures).to.include('extract answers only the fields it was asked about: returned values for fields it was not asked about: gpa, admitted');
    });

    it('fails an engine that keeps researching past maxIterations', async () => {
        const report = await checkEngine(agentType({ rounds: 3 }));
        expect(report.failures.join('\n')).to.include('made 3 rounds of tool calls with maxIterations 2');
    });

    it('fails an engine that under-reports its tool calls', async () => {
        const report = await checkEngine(agentType({ reported: (calls) => calls.slice(1) }));
        expect(report.failures.join('\n')).to.include('reported tool calls');
    });

    it('fails an engine that keeps calling tools after an abort', async () => {
        const report = await checkEngine(agentType({ ignoreAbort: true }));
        expect(report.failures.join('\n')).to.include('research stops calling tools when its signal is aborted');
    });

    it('fails an engine that stops only after researching on past an abort', async () => {
        const report = await checkEngine(agentType({ ignoreAbort: true, lateAbort: true }));
        expect(report.failures.join('\n')).to.include('more round(s) of tool calls after the abort');
    });

    it('fails an engine that ignores its model option', async () => {
        const report = await checkEngine(agentType({ definition: { create: ({ name }) => ({ name, kind: 'agent', model: 'fixed', extract: async () => ({ model: 'fixed', values: {} }) }) } }));
        expect(report.failures.join('\n')).to.include('the model option was set');
    });

    it('fails a definition built for another contract version, and checks nothing else', async () => {
        const report = await checkEngine({ ...agentType(), apiVersion: 2 });
        expect(report.results).to.have.length(1);
        expect(report.failures[0]).to.include('version 2');
    });

    it('passes a conforming decision engine, and fails one that answers outside the contract', async () => {
        expect((await checkEngine(decisionType())).failures).to.deep.equal([]);
        const bad = await checkEngine(decisionType({ answers: { colour: { type: 'choice', choice: 'Green', probabilities: { Green: 1 }, confidence: 1 }, extra: { type: 'noul', probability: 2 } } }));
        expect(bad.failures.join('\n')).to.include('answered questions it was not asked: extra');
        const off = await checkEngine(decisionType({ answers: { colour: { type: 'choice', choice: 'Green', probabilities: { Green: 1 }, confidence: 1 } } }));
        expect(off.failures.join('\n')).to.include('"Green", which is not one of its options');
    });

    it('fails a decision engine that ignores an aborted signal', async () => {
        expect((await checkEngine(decisionType({ ignoreAbort: true }))).failures.join('\n')).to.include('decide stops when its signal is aborted');
    });

    it('reports an engine that fails to start, without running its calls', async () => {
        const broken = agentType({ definition: { create: () => { throw new EngineError('no key'); } } });
        const report = await checkEngine(broken);
        expect(report.failures).to.have.length(1);
        expect(report.failures[0]).to.include('failed to start: no key');
    });
});
