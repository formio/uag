#!/usr/bin/env node
/**
 * Probe the provider APIs the engines call, with your own keys, to settle the
 * defaults that providers do not document: which structured-output mode each
 * accepts, whether research (function calling) works, and how many options an
 * OpenAI decision choice question accepts.
 *
 *   node scripts/probe-engines.mjs
 *
 * Each provider is probed only when its variables are set (in the environment
 * or .env):
 *
 *   openai    OPENAI_API_KEY, OPENAI_MODEL
 *   decisions OPENAI_API_KEY, and OPENAI_DECISION_MODEL (default gpt-6-luna)
 *   grok      XAI_API_KEY, XAI_MODEL
 *   gemini    GEMINI_API_KEY (or GOOGLE_API_KEY), GEMINI_MODEL
 *   mai       MAI_ENDPOINT, MAI_API_KEY, MAI_DEPLOYMENT (not released yet)
 *
 * PROBE_TIMEOUT sets each request's limit in milliseconds (default 180000:
 * reasoning models can take a minute to research). PROBE_ONLY limits it to
 * some of them, for example PROBE_ONLY=gemini or
 * PROBE_ONLY=openai,decisions.
 *
 * It makes a handful of small requests per provider, and prints what each
 * accepted. Keys never appear in the output. Never run it in CI.
 */
import 'dotenv/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createEngine } = require('@formio/uag-sdk/loader');

const env = process.env;
const TIMEOUT = Number(env.PROBE_TIMEOUT || 180000);
const secrets = Object.entries(env).filter(([key, value]) => /KEY|SECRET|TOKEN|LICENSE/.test(key) && value && value.length >= 8).map(([, value]) => value);
const redact = (text) => secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), String(text));
const say = (line) => console.log(redact(line));

const state = { input: { Notes: 'Ada Lovelace lives in London and was born on 10 December 1815.' }, today: '2026-10-22' };
const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { name: { type: 'string' }, city: { type: 'string' }, born: { type: 'string', format: 'date' } },
};
const fields = Object.keys(schema.properties).map((path) => ({ path, label: path, type: 'textfield', description: '', rule: 'Plain text.' }));
const extractRequest = (extra = {}) => ({ instructions: 'Fill in the fields from the notes.', state, fields, schema, signal: AbortSignal.timeout(TIMEOUT), ...extra });

async function attempt(label, fn) {
    try {
        const detail = await fn();
        say(`  ok    ${label}${detail ? `: ${detail}` : ''}`);
        return true;
    }
    catch (err) {
        say(`  fail  ${label}: ${err && err.message ? err.message : err}`);
        return false;
    }
}

async function probeAgent(type, definition, name, instanceEnv) {
    say(`\n${type}`);
    for (const mode of ['json_schema', 'json_object', 'prompt']) {
        await attempt(`extraction, structuredOutput ${mode}`, async () => {
            const engine = await createEngine(definition, { name, options: { structuredOutput: mode }, env: instanceEnv, config: {} });
            const { values, model } = await engine.extract(extractRequest());
            return `${model} answered ${JSON.stringify(values)}`;
        });
    }
    await attempt('research (function calling), then the answer', async () => {
        const engine = await createEngine(definition, { name, options: {}, env: instanceEnv, config: {} });
        const calls = [];
        const lookup = { name: 'lookup_person', description: 'Look up where a person was born.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } };
        const { values, toolCalls } = await engine.extract(extractRequest({
            instructions: 'Fill in the fields. Use lookup_person to check where the person was born before answering.',
            tools: [lookup],
            maxIterations: 3,
            callTool: async (tool, args) => { calls.push({ tool, args }); return { content: [{ type: 'text', text: 'Born in London, England.' }] }; },
        }));
        return `${(toolCalls || []).length} tool call(s), answered ${JSON.stringify(values)}`;
    });
}

async function probeDecisions(definition) {
    say('\nopenai decisions');
    const instanceEnv = { ...env, UAG_ENGINE_DECIDE_KIND: 'decision', UAG_ENGINE_DECIDE_MODEL: env.OPENAI_DECISION_MODEL || 'gpt-6-luna', UAG_ENGINE_DECIDE_MAX_OPTIONS: '1000' };
    const engine = await createEngine(definition, { name: 'decide', options: {}, env: instanceEnv, config: {} });
    await attempt('choice, score and yes/no questions', async () => {
        const { answers, model } = await engine.decide({
            state,
            signal: AbortSignal.timeout(TIMEOUT),
            questions: {
                city: { type: 'choice', instructions: 'Which city does the person live in?', options: { London: null, Paris: null, Rome: 'The Italian capital.' } },
                certainty: { type: 'score', instructions: 'How specific are the notes?', levels: ['Vague', 'Somewhat specific', 'Very specific'] },
                born: { type: 'noul', instructions: 'Do the notes give a date of birth?', criteria: { true: 'A full date is given.' } },
            },
        });
        return `${model}: ${JSON.stringify(answers)}`;
    });
    let accepted = 0;
    for (const count of [50, 100, 255, 500, 1000]) {
        const ok = await attempt(`a choice question with ${count} options`, async () => {
            const options = Object.fromEntries(Array.from({ length: count }, (_, i) => [`Option ${i + 1}`, null]));
            const { answers } = await engine.decide({ state, signal: AbortSignal.timeout(TIMEOUT), questions: { pick: { type: 'choice', instructions: 'Pick any option.', options } } });
            if (!answers.pick) throw new Error('no answer');
        });
        if (!ok) break;
        accepted = count;
    }
    say(`  =>    largest accepted option count: ${accepted || 'none'} (set as the maxOptions default)`);
}

const engines = {
    openai: require('@formio/uag-openai'),
    grok: require('@formio/uag-grok'),
    gemini: require('@formio/uag-gemini'),
    mai: require('@formio/uag-mai'),
};

const only = env.PROBE_ONLY ? new Set(env.PROBE_ONLY.split(',').map((name) => name.trim())) : null;
const wanted = (name) => !only || only.has(name);

let probed = 0;
if (wanted('openai') && env.OPENAI_API_KEY && env.OPENAI_MODEL) { probed++; await probeAgent('openai', engines.openai, 'openai', env); }
if (wanted('decisions') && env.OPENAI_API_KEY) { probed++; await probeDecisions(engines.openai); }
if (wanted('grok') && env.XAI_API_KEY && env.XAI_MODEL) { probed++; await probeAgent('grok', engines.grok, 'grok', env); }
if (wanted('gemini') && (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) && env.GEMINI_MODEL) { probed++; await probeAgent('gemini', engines.gemini, 'gemini', env); }
if (wanted('mai') && env.MAI_ENDPOINT && env.MAI_API_KEY && env.MAI_DEPLOYMENT) { probed++; await probeAgent('mai', engines.mai, 'mai', env); }
if (!probed) {
    say('Nothing to probe: set the variables for at least one provider (see the top of this file).');
    process.exitCode = 1;
}
