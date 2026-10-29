'use strict';
const { ENGINE_API_VERSION, definitionProblems } = require('./define');
const { createEngine } = require('./loader');

/**
 * A conformance check for engine types, usable from any test runner:
 *
 *   const { checkEngine } = require('@formio/uag-sdk/conformance');
 *   const report = await checkEngine(MyEngine, { options: { client: fakeClient } });
 *   assert.deepEqual(report.failures, []);
 *
 * It creates an instance and calls it, so pass options (a fake client, say) or
 * environment variables that let the engine answer. With a real model the
 * answers vary, so the checks test the contract, not the content.
 */

const STATE = {
    instructions: 'Fill in the fields from the notes.',
    input: { Notes: 'My name is Ada Lovelace and I live in London.' },
    today: 'Thursday, October 22, 2026 (2026-10-22)',
};

const FIELDS = [
    { path: 'name', label: 'Name', type: 'textfield', description: 'The person\'s full name.', rule: 'Plain text.' },
    { path: 'city', label: 'City', type: 'textfield', description: 'Where the person lives.', rule: 'Plain text.' },
];

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, city: { type: 'string' } } };

const LOOKUP = {
    name: 'lookup',
    description: 'Look up more notes about the person. Results come in pages.',
    inputSchema: { type: 'object', properties: { page: { type: 'number' } } },
};

const QUESTIONS = {
    colour: { type: 'choice', instructions: 'Which colour does the input mention?', options: { Red: 'The colour red.', Blue: null } },
    size: { type: 'score', instructions: 'How large is the request?', levels: ['Small', 'Medium', 'Large'] },
    urgent: { type: 'noul', instructions: 'Is the request urgent?' },
};

function extractRequest(extra = {}) {
    return { instructions: STATE.instructions, state: STATE, fields: FIELDS, schema: SCHEMA, ...extra };
}

function fail(message) {
    throw new Error(message);
}

function isProbability(value) {
    return typeof value === 'number' && value >= 0 && value <= 1;
}

/** Settle within `ms`, or fail saying what did not finish. */
function within(ms, promise, what) {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
        }),
    ]);
}

async function rejects(promise, what) {
    try {
        await promise;
    }
    catch {
        return;
    }
    fail(`${what} resolved instead of rejecting`);
}

function checkUsage(response) {
    if (response.usage === undefined) return;
    for (const key of ['inputTokens', 'outputTokens']) {
        const value = response.usage[key];
        if (value !== undefined && value !== null && !(Number.isInteger(value) && value >= 0)) {
            fail(`usage.${key} must be a whole number, null or absent, not ${JSON.stringify(value)}`);
        }
    }
}

function checkExtractResponse(response, asked) {
    if (!response || typeof response !== 'object') fail('extract did not return an object');
    if (typeof response.model !== 'string' || !response.model) fail('the response does not name its model');
    if (!response.values || typeof response.values !== 'object' || Array.isArray(response.values)) fail('"values" must be an object');
    const extra = Object.keys(response.values).filter((path) => !asked.includes(path));
    if (extra.length) fail(`returned values for fields it was not asked about: ${extra.join(', ')}`);
    checkUsage(response);
}

function checkAnswer(id, answer, question) {
    if (!answer || answer.type !== question.type) fail(`the answer to "${id}" must have type "${question.type}"`);
    if (question.type === 'noul') {
        if (!isProbability(answer.probability)) fail(`the answer to "${id}" needs a probability from 0 to 1`);
        return;
    }
    if (!answer.probabilities || !Object.values(answer.probabilities).every(isProbability)) {
        fail(`the answer to "${id}" needs probabilities from 0 to 1`);
    }
    if (!isProbability(answer.confidence)) fail(`the answer to "${id}" needs a confidence from 0 to 1`);
    if (question.type === 'choice' && !Object.keys(question.options).includes(answer.choice)) {
        fail(`the answer to "${id}" chose ${JSON.stringify(answer.choice)}, which is not one of its options`);
    }
    if (question.type === 'score' && !(Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= question.levels.length - 1)) {
        fail(`the answer to "${id}" needs a score between 0 and ${question.levels.length - 1}`);
    }
}

/**
 * Tools that count research rounds: a call made while no other call is pending,
 * after one has finished, starts a round. Calls one turn makes together count
 * once; a turn's calls made one after another count as separate rounds.
 */
function lookupTool({ onCall } = {}) {
    const state = { calls: [], rounds: 0, pending: 0, settled: true };
    async function callTool(name, args) {
        if (state.pending === 0 && state.settled) {
            state.rounds++;
            state.settled = false;
        }
        state.pending++;
        state.calls.push(name);
        try {
            if (onCall) onCall(state);
            await new Promise((resolve) => setImmediate(resolve));
            if (name !== LOOKUP.name) {
                return { content: [{ type: 'text', text: `The tool "${name}" is not available.` }], isError: true };
            }
            const page = Number(args && args.page) || 1;
            return { content: [{ type: 'text', text: `Page ${page} of 9: Ada was born in 1815. Call lookup with page ${page + 1} for more.` }] };
        }
        finally {
            state.pending--;
            state.settled = true;
        }
    }
    return { state, callTool };
}

/**
 * Check an engine type against the engine contract. Resolves to
 * `{ ok, failures, results }`; `failures` names each failed check and why.
 */
async function checkEngine(definition, { name = 'conformance', options = {}, env = process.env, config = {}, timeout = 10000 } = {}) {
    const results = [];
    async function check(label, fn) {
        try {
            const outcome = await fn();
            results.push({ check: label, ok: true, ...(outcome === 'skipped' && { skipped: true }) });
            return true;
        }
        catch (err) {
            results.push({ check: label, ok: false, message: err && err.message });
            return false;
        }
    }
    const report = () => ({
        ok: results.every((result) => result.ok),
        failures: results.filter((result) => !result.ok).map((result) => `${result.check}: ${result.message}`),
        results,
    });

    const valid = await check('is a valid engine type definition', () => {
        const problems = definitionProblems(definition);
        if (problems.length) fail(problems.join('; '));
        if (definition.apiVersion !== ENGINE_API_VERSION) {
            fail(`it was built for engine API version ${definition.apiVersion}; this SDK checks version ${ENGINE_API_VERSION}`);
        }
    });
    if (!valid) return report();

    let engine;
    const created = await check('creates an engine with the instance name and the contract\'s shape', async () => {
        engine = await createEngine(definition, { name, options, env, config });
        if (typeof engine.model !== 'string' || !engine.model) fail('the engine does not name its model');
        if (engine.apiVersion !== undefined && engine.apiVersion !== ENGINE_API_VERSION) fail(`the engine declares apiVersion ${engine.apiVersion}`);
        if (engine.kind === 'decision') {
            if (typeof engine.decide !== 'function') fail('a decision engine needs a decide function');
            if (!Number.isInteger(engine.maxOptions) || engine.maxOptions < 2) fail('a decision engine needs maxOptions of at least 2');
        }
        else if (typeof engine.extract !== 'function') {
            fail('an agent engine needs an extract function');
        }
    });
    if (!created) return report();

    await check('respects the instance\'s options', async () => {
        // A definition made without defineEngine may have no settings.
        const hasModel = !!(definition.settings && definition.settings.model);
        const other = await createEngine(definition, { name: `${name}-other`, options: { ...options, ...(hasModel && { model: 'conformance-model-1' }) }, env, config });
        if (hasModel && other.model !== 'conformance-model-1') {
            fail(`the model option was set to "conformance-model-1" but the engine reports "${other.model}"`);
        }
    });

    if (engine.kind === 'agent') {
        await check('extract answers only the fields it was asked about', async () => {
            const response = await within(timeout, engine.extract(extractRequest()), 'extract');
            checkExtractResponse(response, FIELDS.map((field) => field.path));
        });
        await check('extract stops when its signal is aborted', async () => {
            const controller = new AbortController();
            controller.abort();
            await within(timeout, rejects(engine.extract(extractRequest({ signal: controller.signal })), 'extract with an aborted signal'), 'extract with an aborted signal');
        });
        if (engine.toolUse) {
            await check('research reports its tool calls and stops at maxIterations', async () => {
                const { state, callTool } = lookupTool();
                const response = await within(timeout, engine.extract(extractRequest({ tools: [LOOKUP], callTool, maxIterations: 2 })), 'extract with tools');
                checkExtractResponse(response, FIELDS.map((field) => field.path));
                if (!state.calls.length) return 'skipped';
                if (state.rounds > 2) fail(`it made ${state.rounds} rounds of tool calls with maxIterations 2`);
                const reported = (response.toolCalls || []).map((call) => call.name);
                if (reported.length !== state.calls.length || reported.some((call, i) => call !== state.calls[i])) {
                    fail(`it reported tool calls ${JSON.stringify(reported)} but made ${JSON.stringify(state.calls)}`);
                }
            });
            await check('research stops calling tools when its signal is aborted', async () => {
                const controller = new AbortController();
                let callsAtAbort;
                const { state, callTool } = lookupTool({
                    onCall: (current) => {
                        if (callsAtAbort === undefined) {
                            callsAtAbort = current.calls.length;
                            controller.abort();
                        }
                    },
                });
                const outcome = await within(timeout, engine.extract(extractRequest({ tools: [LOOKUP], callTool, maxIterations: 5, signal: controller.signal }))
                    .then(() => 'resolved', () => 'rejected'), 'extract aborted during research');
                if (callsAtAbort === undefined) return 'skipped';
                if (outcome !== 'rejected') fail('extract resolved after its signal was aborted');
                await new Promise((resolve) => setTimeout(resolve, 50));
                // Calls started in the same turn as the aborting one may still run.
                if (state.rounds > 1) fail(`it started ${state.rounds - 1} more round(s) of tool calls after the abort`);
            });
        }
    }
    else {
        await check('decide answers only the questions it was asked, in the contract\'s shapes', async () => {
            const response = await within(timeout, engine.decide({ state: STATE, questions: QUESTIONS }), 'decide');
            if (!response || typeof response !== 'object') fail('decide did not return an object');
            if (typeof response.model !== 'string' || !response.model) fail('the response does not name its model');
            const answers = response.answers || {};
            const extra = Object.keys(answers).filter((id) => !QUESTIONS[id]);
            if (extra.length) fail(`answered questions it was not asked: ${extra.join(', ')}`);
            for (const [id, answer] of Object.entries(answers)) checkAnswer(id, answer, QUESTIONS[id]);
            checkUsage(response);
        });
        await check('decide stops when its signal is aborted', async () => {
            const controller = new AbortController();
            controller.abort();
            await within(timeout, rejects(engine.decide({ state: STATE, questions: QUESTIONS, signal: controller.signal }), 'decide with an aborted signal'), 'decide with an aborted signal');
        });
    }
    return report();
}

module.exports = { checkEngine, STATE, FIELDS, SCHEMA, QUESTIONS, LOOKUP };
