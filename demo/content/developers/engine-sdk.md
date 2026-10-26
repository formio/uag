---
title: Engine SDK
description: Write an engine package with @formio/uag-sdk, the complete engine contract, settings, errors, packaging and the conformance check.
section: Extend
order: 40
---

An engine connects the UAG to a model. The official engines (`jev`, `claude`, `openai`, `grok`, `gemini`) are ordinary npm packages built with `@formio/uag-sdk`, and yours is built the same way. An engine package depends on the SDK only: it never needs `@formio/uag` or `@formio/appserver-core`, and the same package runs inside the UAG, on an engine server, and in `uag-eval`.

This page is the complete reference for the contract, then two full example engines with their tests. For how instances are enabled and routed, see [Engines and routing](/developers/engines).

## What the SDK contains

| Import | Contents |
|---|---|
| `@formio/uag-sdk` | The contract's types, `ENGINE_API_VERSION`, `defineEngine`, `EngineError`, `EngineConfigError`, settings and instance helpers, and the structured-output helpers. |
| `@formio/uag-sdk/conformance` | `checkEngine`, the conformance check. |
| `@formio/uag-sdk/loader` | `loadEngines`, `createEngine`, `resolveType`, `enginePaths`: how hosts find and create engines. |
| `@formio/uag-sdk/protocol` | The remote engine protocol's checks, used by the `remote` type and the engine server. See [Engine server](/developers/engine-server). |

```bash
npm install @formio/uag-sdk
```

The SDK requires Node.js 22 or later and has no dependencies.

## An engine package

A package exports one engine type definition, made with `defineEngine`:

```js
const { defineEngine, EngineError, ENGINE_API_VERSION, requiredSchema } = require('@formio/uag-sdk');

module.exports = defineEngine({
    type: 'acme',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    description: 'Acme models: structured extraction.',
    settings: {
        apiKey: { env: 'ACME_API_KEY', required: true, secret: true },
        model: { env: 'ACME_MODEL', default: 'acme-large-2026-09-01' },
        maxTokens: { env: 'ACME_MAX_TOKENS', type: 'number', default: 4000 },
    },
    create({ name, settings, options }) {
        const client = options.client || new AcmeClient({ apiKey: settings.apiKey });
        return {
            name,
            kind: 'agent',
            apiVersion: ENGINE_API_VERSION,
            model: settings.model,
            async extract(request) {
                request.signal?.throwIfAborted();
                const { schema, decode } = requiredSchema(request.schema);
                const answer = await client.complete({ schema, signal: request.signal /* ... */ });
                if (answer.quotaExceeded) throw new EngineError('Quota exceeded for this API key.');
                return { model: answer.model, values: decode(answer.json) };
            },
        };
    },
});
```

### Naming

| Package name | Who | Enabled as |
|---|---|---|
| `@formio/uag-<type>` | Official engines | `UAG_ENGINES=<type>` |
| `uag-engine-<type>` | Anyone | `UAG_ENGINES=<type>` |
| Any other name, such as `@acme/uag-engine-x` | Anyone | `UAG_ENGINES=<name>:@acme/uag-engine-x`, or the bare package name |

A type name is looked up as `@formio/uag-<type>`, then `uag-engine-<type>`. Name an unscoped package `uag-engine-<type>` so users can enable it by its type name alone. The package's `type` must match: `uag-engine-keywords` exports `type: 'keywords'`.

The package's `main` exports the definition (`module.exports = defineEngine(...)`). A transpiled module whose `default` export is the definition, with `__esModule` set, also loads.

## defineEngine(definition)

```ts
function defineEngine<T extends EngineTypeDefinition<any>>(definition: T): Readonly<T>;

interface EngineTypeDefinition<Settings = Record<string, any>> {
    /** The type name, as in UAG_ENGINES=<type> and <name>:<type>. */
    type: string;
    kinds: readonly ('decision' | 'agent')[];
    /** The engine contract version the type was built for: ENGINE_API_VERSION. */
    apiVersion: number;
    description?: string;
    settings?: Record<string, SettingSpec>;
    create(context: EngineCreateContext<Settings>): Engine | Promise<Engine>;
}
```

`defineEngine` validates the definition and returns it frozen, so a mistake fails when the package loads, not when the UAG starts. It throws a `TypeError` naming every problem:

| Rule | |
|---|---|
| `type` | Lowercase letters, digits and `-`, starting with a letter, at most 63 characters (`ENGINE_NAME`). |
| `kinds` | `['decision']`, `['agent']`, or both. |
| `apiVersion` | A whole number. The loader refuses a type whose version is not the host's, naming both versions. Use `ENGINE_API_VERSION` (currently `1`). |
| `create` | A function. |
| `settings` | An object of camelCase names to setting specs, with only the keys below. A `default` must have the setting's type. |

Definitions are checked structurally, so a package built with another copy of the SDK, or written without it, loads too. `isEngineType(value)` tells you whether a value passes.

### create(context)

`create` is called once per instance, at startup. It may be async.

```ts
type EngineCreateContext<Settings = Record<string, any>> = {
    /** The instance name. The engine must use it as its `name`. */
    name: string;
    /** The instance's value for each declared setting that has one. */
    settings: Settings;
    /** The instance's options as given in configuration, including ones that are not settings. */
    options: Record<string, any>;
    /** The host's configuration, read-only (for example routing.timeouts). */
    config: Record<string, any>;
    /** A setting's value, or the standard "needs its setting" error. */
    requireSetting(key: string): any;
};
```

- **`name`.** Return it as the engine's `name`. An engine named anything else is refused.
- **`settings`.** Resolved values, converted to each setting's type. A setting with no value and no default is absent.
- **`options`.** Everything the instance was configured with, settings or not. Accept test doubles here (`options.client`, `options.fetch`) so tests never need the network.
- **`config`.** In the UAG, its configuration: read `config.routing.timeouts[name]` and `config.agentApi.timeout` to keep your client's own timeouts inside the UAG's. On an engine server, `config` is `{}`.
- **`requireSetting(key)`.** For settings required only in some cases, such as an API key that a local server does not need.

The engine returned must have a `kind` the type declares. If `create` throws, startup stops: an `EngineConfigError` keeps its message, any other error becomes `The "<name>" engine (type "<type>") failed to start: <message>`, and the values of secret settings are replaced with `[redacted]` in either.

## Settings

```ts
type SettingSpec = {
    /** The type's own environment variables, read after UAG_ENGINE_<NAME>_<SETTING>. */
    env?: string | readonly string[];
    /** Startup fails, naming the instance and the variables, when no value is set. */
    required?: boolean;
    /** Kept out of logs, error messages and capability discovery. */
    secret?: boolean;
    default?: string | number | boolean;
    /** Values from the environment are converted to this type. Default: "string". */
    type?: 'string' | 'number' | 'boolean';
    description?: string;
};
```

Each setting is resolved from the first of these that is set: the instance's options, `UAG_ENGINE_<NAME>_<SETTING>`, the variables in `env` in order, then `default`. `''`, `null` and `undefined` count as not set.

| Key | Meaning |
|---|---|
| `env` | The type's own variables, such as `ACME_API_KEY`. Upper-case names. Shared by every instance of the type. |
| `required` | Startup fails without a value: `The "fast" engine (type "acme") needs its apiKey setting: set UAG_ENGINE_FAST_API_KEY or ACME_API_KEY.` |
| `secret` | The value is redacted from errors and never reported. Use it for keys and tokens. |
| `type` | `number` accepts any finite number; `boolean` accepts `true`/`false`, `1`/`0`, `yes`/`no`. Anything else stops startup, quoting the value unless the setting is secret. |
| `default` | Used when nothing else is set. |
| `description` | Documentation for operators. |

The instance variable comes from the instance name and setting name in upper snake case: `settingVariable('fast', 'apiKey')` is `UAG_ENGINE_FAST_API_KEY`, `settingVariable('local', 'baseURL')` is `UAG_ENGINE_LOCAL_BASE_URL`. Validate values your type accepts from a fixed set in `create`, throwing an `EngineConfigError` that names the instance and the allowed values.

## The contract

```ts
type Engine = DecisionEngine | AgentEngine;
```

### Decision engines

```ts
interface DecisionEngine {
    name: string;
    kind: 'decision';
    apiVersion?: number;
    model: string;
    /** The most options a single choice or score question may carry. */
    maxOptions: number;
    decide(request: DecisionRequest): Promise<DecisionResponse>;
}

type DecisionRequest = {
    state: DecisionState;
    questions: Record<string, DecisionQuestion>;
    signal?: AbortSignal;
};

/** What every engine reads. Questions refer to its fields by name ("Based on `input`, ..."). */
type DecisionState = {
    /** The task's criteria. */
    instructions?: string;
    /** The task's input values keyed by field label (the whole submission when it has no input). */
    input: Record<string, any>;
    /** Values at the paths the task lists in uagContext, keyed by field label. */
    context?: Record<string, any>;
    /** Today's date, e.g. "Tuesday, October 20, 2026 (2026-10-20)". */
    today: string;
};
```

The UAG compiles a task's decision fields into questions and sends them all in one call. One field can become several questions: ids look like `choice:<path>`, `choice-reversed:<path>` (the same choice with the options reversed, to check the answer does not depend on their order), `mention:<path>` (does the input address the field at all) and `affirm:<path>` and `deny:<path>` (a yes/no field). Treat ids as opaque: answer each id you were asked, with the same id.

```ts
type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

/** Pick one option from a set with no order. */
type ChoiceQuestion = {
    type: 'choice';
    instructions: string;
    /** Option label -> optional description. The labels are what the model chooses between. */
    options: Record<string, string | null>;
};

/** Place the state on an ordered list of levels, lowest first. */
type ScoreQuestion = { type: 'score'; instructions: string; levels: string[] };

/** A yes/no question where the probability of "yes" is the useful signal. */
type NoulQuestion = { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } };
```

```ts
type DecisionResponse = {
    model: string;
    answers: Record<string, DecisionAnswer>;
    usage?: EngineUsage;
};

type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

type ChoiceAnswer = {
    type: 'choice';
    choice: string;                          // one of the option labels
    probabilities: Record<string, number>;   // option label -> probability
    /** Normalized for the number of options: (p_max − 1/n) / (1 − 1/n). */
    confidence: number;
};

type ScoreAnswer = {
    type: 'score';
    /** Position along the levels, 0 to levels.length − 1; may fall between two. */
    score: number;
    probabilities: Record<string, number>;   // level index (as a string) -> probability
    confidence: number;
};

type NoulAnswer = { type: 'noul'; probability: number };   // P("yes"), 0 to 1

type EngineUsage = { inputTokens?: number | null; outputTokens?: number | null };
```

- Probabilities and confidences are from 0 to 1. The UAG compares `confidence` (or, for `noul`, `probability` against the uncertain band) with the field's threshold; see [Form properties](/developers/form-properties).
- An answer you leave out leaves its field undecided: the UAG reports it `missing`, or tries the next engine in the routing list.
- `maxOptions` must be at least 2. Fields whose closed set is larger go to an agent engine instead.
- A decision engine's answers are reported `calibrated: true`. Only build one when its probabilities mean something; measure them with [`uag-eval`](/developers/evaluation).

### Agent engines

```ts
interface AgentEngine {
    name: string;
    kind: 'agent';
    apiVersion?: number;
    model: string;
    /** Whether extract accepts read-only tools for research. Engines without it are passed over for tasks that research. */
    toolUse?: boolean;
    /** Structured extraction that returns values for the requested fields only. */
    extract(request: ExtractRequest): Promise<ExtractResponse>;
}

type ExtractRequest = {
    instructions: string;
    state: DecisionState;
    fields: FieldSpec[];
    /** JSON schema of the object to return, keyed by field path. */
    schema: Record<string, any>;
    signal?: AbortSignal;
    /** Read-only tools the engine may call before answering. Only engines with toolUse receive them. */
    tools?: ToolDefinition[];
    /** Call one of `tools`: in process, with the caller's identity; names outside `tools` are refused. */
    callTool?(name: string, args: Record<string, any>): Promise<ToolCallResult>;
    /** The most tool-use rounds before the engine must answer. Set with `tools`. */
    maxIterations?: number;
    /** For engines that run the model outside the UAG and call the tools back over /mcp. */
    scopedToken?: string;
};

/** One field to produce a value for. */
type FieldSpec = {
    path: string;
    label: string;
    type: string;
    description: string;
    /** How the value must be written, from the same rules get_field_info gives agents. */
    rule: string;
    format?: string;
    /** For closed-set fields routed to an agent engine: the allowed values. */
    options?: { label: string; value: any }[];
    multiple?: boolean;
};

type ExtractResponse = {
    model: string;
    /** Field path -> value. Paths that were not asked for are discarded. */
    values: Record<string, any>;
    /** Tools the engine called while researching, in order. */
    toolCalls?: { name: string; isError: boolean }[];
    usage?: EngineUsage;
};

/** A tool as an agent engine sees it: plain JSON, ready for any model API. */
type ToolDefinition = { name: string; description: string; inputSchema: Record<string, any> };

/** A tool call's outcome, in MCP content form. */
type ToolCallResult = { content: { type: string; text?: string; [key: string]: any }[]; isError?: boolean };
```

- `instructions` is the task's criteria; use it as the system prompt. `state` is the same object decision engines read. `fields` describes each field, and `schema` is the JSON schema of the answer, keyed by field path.
- Return values only for the fields asked. Leave out a field the information does not support; do not invent a value. The UAG validates every value against the form.
- Values from an agent engine are always reported `suggested`.

### Research

When a task lists read-only tools in `uagTools`, `generate` and `provide` give the value fields' engine `tools`, `callTool` and `maxIterations`. Only engines that set `toolUse: true` are chosen for those fields.

- Offer `tools` to the model in your API's function-calling format. `inputSchema` is a JSON schema.
- Run each call the model makes through `request.callTool(name, args)`. It runs in the UAG with the caller's identity, so Form.io permissions apply, and it refuses any tool the task did not allow with an `isError` result.
- Give the model each result: `toolResultText(result)` turns one into text.
- A **round** is the calls the model makes together in one turn. Run them concurrently and return all their results in one message. Calls made one after another are separate rounds. Stop after `maxIterations` rounds and ask for the answer with tools turned off.
- Report every call you made in `toolCalls`, in order, with `isError` from the result.
- Tools never write, so research can only read.

`scopedToken` is for engines whose model runs outside the UAG and calls tools back over `/mcp`; in-process engines ignore it. The engine server uses it for you (see [Engine server](/developers/engine-server)).

### Signals and timeouts

Every request carries a `signal`. The UAG aborts it when the engine's routing timeout (`routing.timeouts[name]`, else `agentApi.timeout`, 30 s by default; `agentApi.research.timeout`, 120 s, for research) passes, and tries the next engine.

- Check `signal.throwIfAborted()` before you start and between research rounds.
- Pass `signal` to every HTTP call, so an abort cancels the request in flight.
- After an abort, reject. Do not start another round of tool calls.
- Keep your client's own timeout and retries inside the routing timeout. The official engines read `config.routing.timeouts[name]` in `create` for this.

### Errors

| Error | When | What callers see |
|---|---|---|
| `EngineError` | A failure whose message is safe to show: "Quota exceeded for this API key.", "The model returned no message." | The message, in the field group's `error` and `attempts`. |
| Any other error | Anything from a provider SDK or the network, which can carry URLs, account ids or keys. | `the engine failed (see the logs for request <id>)`. The full error is logged in the UAG under the request id. |
| A timeout | The routing timeout passed and the signal fired. | The timeout's message, naming the engine and the milliseconds. |
| `EngineConfigError` | In `create`: the instance cannot be enabled. | Startup stops with the message. |

```ts
class EngineError extends Error {
    readonly expose: true;
    constructor(message: string);
}
class EngineConfigError extends Error {
    constructor(message: string);
}
```

Code that cannot import the SDK can mark its own error safe by setting `expose: true` on it. Either way, the routing moves on to the next engine.

`redact(text, secrets)` replaces each secret value (four characters or longer) in a text with `[redacted]`, for messages you build from provider errors.

## Helpers

| Helper | Use |
|---|---|
| `requiredSchema(schema)` | `{ schema, decode }`: the extraction schema with every field required, for strict structured outputs. Empty values stand for "not stated" (`''` for text and options, `[]` for lists); numbers and booleans travel as strings. `decode(answer)` maps the answer back to the UAG's types and drops the "not stated" fields. |
| `decodeValues(values, decoders)` | The decoding step on its own. |
| `parseJsonObject(text)` | The first JSON object in a text answer, tolerating code fences and prose around it. Throws an `EngineError` when there is none. |
| `toolResultText(result)` | A tool result as text: its text blocks, other blocks as JSON, `(no output)` when empty. |
| `settingVariable(instance, setting)` | `UAG_ENGINE_<NAME>_<SETTING>`. |
| `resolveSettings(definition, name, options?, env?)` | An instance's settings, as the loader resolves them. |
| `parseInstances(source)`, `engineInstances(config?, env?)` | Parse a `UAG_ENGINES` string or a configuration list into `{ name, type, options }` entries. |

For hosts and tests, `@formio/uag-sdk/loader` has `createEngine(definition, { name, options, env, config })`, which resolves settings and creates one instance exactly as the UAG does, and `loadEngines(instances, { types, paths, env, config })`.

## The conformance check

`checkEngine` creates an instance and calls it, then reports which parts of the contract hold. Run it from any test runner.

```ts
function checkEngine(definition: EngineTypeDefinition, options?: {
    /** The instance name to create. Default: "conformance". */
    name?: string;
    /** The instance's options, such as a fake client. */
    options?: Record<string, any>;
    env?: Record<string, string | undefined>;
    config?: Record<string, any>;
    /** How long each call may take, in milliseconds. Default: 10000. */
    timeout?: number;
}): Promise<ConformanceReport>;

type ConformanceReport = {
    ok: boolean;
    /** "<check>: <why>" for each failed check. */
    failures: string[];
    results: { check: string; ok: boolean; skipped?: boolean; message?: string }[];
};
```

| Check | Kinds |
|---|---|
| is a valid engine type definition, for this SDK's contract version | both |
| creates an engine with the instance name and the contract's shape (`model`, `decide` and `maxOptions` ≥ 2, or `extract`) | both |
| respects the instance's options: with a `model` setting, `model: "conformance-model-1"` is the model the engine reports | both |
| decide answers only the questions it was asked, in the contract's shapes | decision |
| decide stops when its signal is aborted | decision |
| extract answers only the fields it was asked about | agent |
| extract stops when its signal is aborted | agent |
| research reports its tool calls and stops at `maxIterations` | agent with `toolUse` |
| research stops calling tools when its signal is aborted | agent with `toolUse` |

The check sends fixed requests (Ada Lovelace's name and city; colour, size and urgency questions; a paged `lookup` tool), so give the engine a fake client that answers them, or real credentials in `env`. With a real model the answers vary, so the check tests the contract, not the content. A research check is marked `skipped` when the engine made no tool calls.

## Example: a keyword decision engine

`uag-engine-keywords` scores each option by how many of its words appear in the task's input. It is not a model, but it shows every part of a decision engine, and it is deterministic, which makes it useful in tests.

```text
uag-engine-keywords/
├── package.json
├── index.js
└── test/
    └── engine.test.js
```

```json
{
  "name": "uag-engine-keywords",
  "version": "1.0.0",
  "description": "A toy keyword decision engine for the Form.io UAG.",
  "main": "index.js",
  "files": ["index.js"],
  "engines": { "node": ">=22.0.0" },
  "scripts": { "test": "node --test" },
  "dependencies": { "@formio/uag-sdk": "^2.0.0" }
}
```

```js
'use strict';
/**
 * uag-engine-keywords: a toy decision engine. It scores each option by how many
 * of its words appear in the task's input. Useful as a template, and as a
 * deterministic engine for tests. Not a model: do not route real work to it.
 *
 *   UAG_ENGINES=keywords
 *   UAG_ENGINES=kw:keywords   UAG_ENGINE_KW_MAX_OPTIONS=20
 */
const { defineEngine, ENGINE_API_VERSION } = require('@formio/uag-sdk');

/** Lower-case words of three letters or more. */
function words(text) {
    return new Set((String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []));
}

/** Every string in the input and context, as one text. */
function stateText(state) {
    const parts = [];
    const walk = (value) => {
        if (typeof value === 'string') parts.push(value);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(state.input);
    walk(state.context);
    return parts.join(' ');
}

/** One probability per candidate: 1 + the candidate's words found in the text, normalized. */
function distribution(candidates, seen) {
    const hits = candidates.map((candidate) => 1 + [...words(candidate)].filter((word) => seen.has(word)).length);
    const total = hits.reduce((sum, hit) => sum + hit, 0);
    return hits.map((hit) => hit / total);
}

/** The contract's normalized confidence: (p_max − 1/n) / (1 − 1/n). */
function confidence(probabilities) {
    const n = probabilities.length;
    const max = Math.max(...probabilities);
    return n > 1 ? Math.max(0, (max - 1 / n) / (1 - 1 / n)) : 1;
}

function answer(question, seen) {
    if (question.type === 'choice') {
        const labels = Object.keys(question.options);
        const p = distribution(labels.map((label) => `${label} ${question.options[label] || ''}`), seen);
        const best = p.indexOf(Math.max(...p));
        return {
            type: 'choice',
            choice: labels[best],
            probabilities: Object.fromEntries(labels.map((label, i) => [label, p[i]])),
            confidence: confidence(p),
        };
    }
    if (question.type === 'score') {
        const p = distribution(question.levels, seen);
        return {
            type: 'score',
            // The expected position along the levels, so it may fall between two.
            score: p.reduce((sum, probability, i) => sum + probability * i, 0),
            probabilities: Object.fromEntries(p.map((probability, i) => [String(i), probability])),
            confidence: confidence(p),
        };
    }
    // noul: weigh the words of the "true" criteria against the "false" ones.
    const [yes, no] = distribution([question.criteria?.true || '', question.criteria?.false || ''], seen);
    return { type: 'noul', probability: yes / (yes + no) };
}

module.exports = defineEngine({
    type: 'keywords',
    kinds: ['decision'],
    apiVersion: ENGINE_API_VERSION,
    description: 'A toy decision engine that matches option words against the input.',
    settings: {
        model: { env: 'KEYWORDS_MODEL', default: 'keywords-1', description: 'Reported as the model.' },
        maxOptions: { type: 'number', default: 50, description: 'The most options one question may carry.' },
    },
    create({ name, settings }) {
        return {
            name,
            kind: 'decision',
            apiVersion: ENGINE_API_VERSION,
            model: settings.model,
            maxOptions: settings.maxOptions,
            async decide({ state, questions, signal }) {
                signal?.throwIfAborted();
                const seen = words(stateText(state));
                const answers = {};
                for (const [id, question] of Object.entries(questions)) {
                    answers[id] = answer(question, seen);
                }
                return { model: settings.model, answers };
            },
        };
    },
});
```

```js
// test/engine.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const { createEngine } = require('@formio/uag-sdk/loader');
const keywords = require('..');

test('meets the engine contract', async () => {
    const report = await checkEngine(keywords, { env: {} });
    assert.deepEqual(report.failures, []);
});

test('picks the option whose words the input uses', async () => {
    const engine = await createEngine(keywords, { name: 'keywords', env: {} });
    const { answers } = await engine.decide({
        state: { input: { Description: 'Someone broke into the garage and the bike was stolen.' }, today: 'Friday, October 23, 2026 (2026-10-23)' },
        questions: {
            'choice:claimType': { type: 'choice', instructions: 'What kind of claim is it?', options: { Collision: 'A vehicle hit something.', Theft: 'Something was stolen.' } },
        },
    });
    assert.equal(answers['choice:claimType'].choice, 'Theft');
});

test('reads its settings from the instance variables', async () => {
    const engine = await createEngine(keywords, { name: 'kw', env: { UAG_ENGINE_KW_MAX_OPTIONS: '20' } });
    assert.equal(engine.maxOptions, 20);
});
```

```bash
npm install && npm test
```

```text
✔ meets the engine contract
✔ picks the option whose words the input uses
✔ reads its settings from the instance variables
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

## Example: a minimal agent engine

`uag-engine-mini-chat` calls any server with an OpenAI-style chat completions endpoint (`POST <baseURL>/chat/completions`) over plain `fetch`. It asks for the answer in JSON mode with the schema in the prompt, and researches with function calling. It shows each obligation of an agent engine: settings, the abort signal, research rounds, safe errors, and returning only the fields asked.

> **Tip:** For a provider with an OpenAI-compatible API, you do not need to write this yourself. `@formio/uag-openai/compatible` exports `openAICompatible({ type, description, baseURL, apiKey: { env }, model: { env }, apiKeyHeader?, settings?, structuredOutput?, reasoningEffort? })`, which the `grok` and `gemini` packages are built on. It adds strict JSON schema support and the other structured-output modes.

```js
'use strict';
/**
 * uag-engine-mini-chat: a minimal agent engine over a chat completions API
 * (POST <baseURL>/chat/completions), with JSON mode for the answer and
 * function calling for research.
 *
 *   UAG_ENGINES=mini-chat
 *   MINI_CHAT_BASE_URL=http://ollama:11434/v1   MINI_CHAT_MODEL=<a model ID>
 */
const { defineEngine, EngineError, ENGINE_API_VERSION, parseJsonObject, toolResultText } = require('@formio/uag-sdk');

/** The prompt: what the engine knows, the fields to fill, and the answer's schema. */
function prompt(request) {
    return [
        'Information:',
        JSON.stringify(request.state, null, 2),
        '',
        'Fields to fill in (path, label, rule, format and allowed options):',
        JSON.stringify(request.fields, null, 2),
        '',
        'Respond with only one JSON object keyed by field path, matching this JSON schema.',
        'Leave out any field the information does not support.',
        JSON.stringify(request.schema),
    ].join('\n');
}

module.exports = defineEngine({
    type: 'mini-chat',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    description: 'A minimal agent engine over a chat completions API.',
    settings: {
        baseURL: { env: 'MINI_CHAT_BASE_URL', required: true, description: 'The API, such as http://ollama:11434/v1.' },
        model: { env: 'MINI_CHAT_MODEL', required: true, description: 'A model ID. There is no default.' },
        apiKey: { env: 'MINI_CHAT_API_KEY', secret: true, description: 'Sent as a bearer token, when set.' },
    },
    create({ name, settings, options }) {
        // Tests pass a fake `fetch` as an option; it is not a setting.
        const fetchImpl = options.fetch || fetch;
        const url = `${settings.baseURL.replace(/\/+$/, '')}/chat/completions`;

        /** One chat completion. Failures the caller may see are EngineErrors. */
        async function complete(body, signal, usage) {
            signal?.throwIfAborted();
            const response = await fetchImpl(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(settings.apiKey && { Authorization: `Bearer ${settings.apiKey}` }),
                },
                body: JSON.stringify({ model: settings.model, ...body }),
                signal,
            });
            if (response.status === 429) throw new EngineError('The model API is over its rate limit.');
            // Other HTTP errors are not exposed: their bodies can carry account details.
            if (!response.ok) throw new Error(`The model API answered HTTP ${response.status}: ${await response.text()}`);
            const completion = await response.json();
            usage.inputTokens += completion.usage?.prompt_tokens || 0;
            usage.outputTokens += completion.usage?.completion_tokens || 0;
            const message = completion.choices?.[0]?.message;
            if (!message) throw new EngineError('The model returned no message.');
            return { completion, message };
        }

        /** Let the model call the read-only tools, up to maxIterations rounds. */
        async function research(request, tools, messages, usage) {
            const toolCalls = [];
            for (let round = 0; round < (request.maxIterations || 10); round++) {
                const { message } = await complete({ messages, tools }, request.signal, usage);
                const calls = message.tool_calls || [];
                messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length && { tool_calls: calls }) });
                if (!calls.length) break;
                // One round: the calls the model made together, run concurrently.
                const results = await Promise.all(calls.map(async (call) => {
                    let args;
                    try {
                        args = JSON.parse(call.function.arguments || '{}');
                    }
                    catch {
                        return { role: 'tool', tool_call_id: call.id, content: 'Error: the arguments were not JSON.' };
                    }
                    // callTool runs in the UAG with the caller's identity, and refuses
                    // any tool the task did not allow.
                    const result = await request.callTool(call.function.name, args);
                    toolCalls.push({ name: call.function.name, isError: !!result.isError });
                    return { role: 'tool', tool_call_id: call.id, content: toolResultText(result) };
                }));
                messages.push(...results);
            }
            messages.push({ role: 'user', content: 'Now give the answer: one JSON object keyed by field path.' });
            return toolCalls;
        }

        return {
            name,
            kind: 'agent',
            apiVersion: ENGINE_API_VERSION,
            model: settings.model,
            toolUse: true,
            async extract(request) {
                const usage = { inputTokens: 0, outputTokens: 0 };
                const messages = [
                    { role: 'system', content: request.instructions },
                    { role: 'user', content: prompt(request) },
                ];
                const tools = (request.tools || []).map((tool) => ({
                    type: 'function',
                    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
                }));
                const toolCalls = tools.length ? await research(request, tools, messages, usage) : undefined;
                const { completion, message } = await complete({
                    messages,
                    // Declared but not callable: the history may hold tool calls.
                    ...(tools.length && { tools, tool_choice: 'none' }),
                    response_format: { type: 'json_object' },
                }, request.signal, usage);
                const answer = parseJsonObject(message.content || '');
                // Return only the fields that were asked for.
                const asked = new Set(Object.keys(request.schema.properties || {}));
                const values = Object.fromEntries(Object.entries(answer).filter(([path, value]) => asked.has(path) && value !== '' && value !== null));
                return {
                    model: completion.model || settings.model,
                    values,
                    usage,
                    ...(toolCalls && { toolCalls }),
                };
            },
        };
    },
});
```

The tests use a fake chat completions API, so they never touch the network. It calls the first tool while it has rounds left, then answers every field in the schema with `"x"`, and honours the abort signal as `fetch` does.

```js
// test/engine.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEngine } = require('@formio/uag-sdk/conformance');
const { createEngine } = require('@formio/uag-sdk/loader');
const miniChat = require('..');

const ENV = { MINI_CHAT_BASE_URL: 'http://model.test/v1', MINI_CHAT_MODEL: 'test-model-1' };

/**
 * A fake chat completions API. While tools are offered and `toolRounds` is
 * left, it calls the first tool; otherwise it answers every field in the
 * prompt's schema with "x". It honours the abort signal like real fetch.
 */
function fakeFetch({ toolRounds = 1 } = {}) {
    const requests = [];
    let rounds = 0;
    const fetchImpl = async (url, init) => {
        init.signal?.throwIfAborted();
        const body = JSON.parse(init.body);
        requests.push({ url, body });
        await new Promise((resolve) => setImmediate(resolve));
        init.signal?.throwIfAborted();
        let message;
        if (body.tools && body.tool_choice !== 'none' && rounds < toolRounds) {
            rounds++;
            message = { role: 'assistant', content: null, tool_calls: [{ id: `call_${rounds}`, type: 'function', function: { name: body.tools[0].function.name, arguments: JSON.stringify({ page: rounds }) } }] };
        }
        else if (body.tools && body.tool_choice !== 'none') {
            message = { role: 'assistant', content: 'Done researching.' };
        }
        else {
            const schema = JSON.parse(body.messages[1].content.split('\n').pop());
            message = { role: 'assistant', content: JSON.stringify(Object.fromEntries(Object.keys(schema.properties).map((path) => [path, 'x']))) };
        }
        return new Response(JSON.stringify({ model: body.model, choices: [{ message }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 });
    };
    return { fetchImpl, requests };
}

test('meets the engine contract', async () => {
    const report = await checkEngine(miniChat, { env: ENV, options: { fetch: fakeFetch({ toolRounds: 5 }).fetchImpl } });
    assert.deepEqual(report.failures, []);
});

test('needs a base URL and a model, naming the variables', async () => {
    await assert.rejects(createEngine(miniChat, { name: 'local', env: {} }), {
        message: 'The "local" engine (type "mini-chat") needs its baseURL setting: set UAG_ENGINE_LOCAL_BASE_URL or MINI_CHAT_BASE_URL.',
    });
});

test('asks for JSON and returns only the fields it was asked about', async () => {
    const { fetchImpl, requests } = fakeFetch();
    const engine = await createEngine(miniChat, { name: 'mini-chat', env: ENV, options: { fetch: fetchImpl } });
    const response = await engine.extract({
        instructions: 'Fill in the claim.',
        state: { input: { Description: 'A tree fell on my garage.' }, today: 'Friday, October 23, 2026 (2026-10-23)' },
        fields: [{ path: 'cause', label: 'Cause', type: 'textfield', description: '', rule: 'Plain text.' }],
        schema: { type: 'object', properties: { cause: { type: 'string' } } },
    });
    assert.equal(requests[0].url, 'http://model.test/v1/chat/completions');
    assert.deepEqual(requests[0].body.response_format, { type: 'json_object' });
    assert.deepEqual(response.values, { cause: 'x' });
});

test('hides an HTTP error body from API callers', async () => {
    const engine = await createEngine(miniChat, {
        name: 'mini-chat', env: ENV,
        options: { fetch: async () => new Response('account 1234 is suspended', { status: 403 }) },
    });
    await assert.rejects(engine.extract({ instructions: '', state: { input: {}, today: '' }, fields: [], schema: { type: 'object', properties: {} } }), (err) => err.expose !== true);
});
```

With `toolRounds: 5` and the conformance check's `maxIterations: 2`, the two research checks run (they are not skipped) and pass: the engine stops after two rounds, and reports both calls.

## Installing an engine

| Where | How |
|---|---|
| A UAG you run with npm | `npm install uag-engine-keywords` next to `@formio/uag`, then `UAG_ENGINES=keywords`. |
| A derived image | `RUN npm install --prefix /engines uag-engine-keywords` and `ENV UAG_ENGINE_PATH=/engines`. |
| A mounted volume | A directory holding `node_modules/uag-engine-keywords` (with its dependencies), listed in `UAG_ENGINE_PATH`. Paths must be absolute; separate several with `:`. |
| Your own server, without publishing | Pass the definition: `new UAGServer({ engineTypes: { keywords: require('./keywords') }, engines: ['keywords'] })`, or `engines: [{ name: 'kw', type: require('./keywords') }]`. |
| An engine server | Install it there the same ways; the UAG reaches it with `UAG_ENGINES=keywords:remote`. See [Engine server](/developers/engine-server). |

```dockerfile
FROM formio/uag
RUN npm install --prefix /engines uag-engine-keywords
ENV UAG_ENGINE_PATH=/engines
```

`GET /agent/capabilities` then lists the instance with `"type": "keywords", "package": "uag-engine-keywords"` and the package's version.

## Versions

`ENGINE_API_VERSION` is `1` in `@formio/uag-sdk` 2.x, and every UAG 2.x supports it. Depend on `@formio/uag-sdk@^2`. A future contract version will be refused by older hosts with an error that names both versions, rather than failing at the first request.

## Next steps

- [Engines and routing](/developers/engines): enable and route your engine.
- [Engine server](/developers/engine-server): run it in its own container.
- [Evaluation](/developers/evaluation): measure a decision engine's calibration.
