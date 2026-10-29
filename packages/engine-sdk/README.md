# @formio/uag-sdk

<sub>[Form.io UAG](https://github.com/formio/uag/blob/main/README.md) &rsaquo; [Engines](https://github.com/formio/uag/blob/main/README.md#engines-and-routing) &rsaquo; this page</sub>

Build engine packages for the Form.io Universal Agent Gateway (UAG). This package contains:

- the engine contract's types, and `ENGINE_API_VERSION`;
- `defineEngine`, to declare an engine type and its settings;
- `EngineError`, for messages that are safe to show to API callers;
- the loader, which the UAG, `uag-eval` and the engine server use to find, configure and create engines;
- shared helpers for model APIs with structured outputs;
- a conformance check that runs from any test runner.

An engine package depends on this package only. It never needs `@formio/uag`.

## An engine package

Name the package `@formio/uag-<type>` (official engines) or `uag-engine-<type>` (anyone's). Export one engine type definition:

```js
const { defineEngine, EngineError, ENGINE_API_VERSION, requiredSchema } = require('@formio/uag-sdk');

module.exports = defineEngine({
    type: 'acme',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    settings: {
        apiKey: { env: 'ACME_API_KEY', required: true, secret: true },
        model: { env: 'ACME_MODEL', default: 'acme-large-2026-09-01' },
        maxTokens: { env: 'ACME_MAX_TOKENS', type: 'number', default: 4000 },
    },
    create({ name, settings }) {
        const client = new AcmeClient({ apiKey: settings.apiKey });
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

The engine must use the instance `name` it is given, and one of the `kinds` it declares. A decision engine has `decide` and `maxOptions`; an agent engine has `extract`, and sets `toolUse: true` when `extract` accepts read-only research tools. See `contract.d.ts` for every request and response.

`create` receives `{ name, settings, options, config, requireSetting }`:

- `settings`: the instance's value for each declared setting that has one.
- `options`: the instance's options as given in configuration, including ones that are not settings, such as a fake client in tests.
- `config`: the host's configuration, read-only, for example `routing.timeouts[name]`.
- `requireSetting(key)`: a setting's value, or the standard "needs its setting" error, for a setting that is required only sometimes.

`create` may be async.

## Settings

Each setting is resolved from the first of these that is set:

1. the instance's options in configuration;
2. `UAG_ENGINE_<NAME>_<SETTING>`, from the instance name and the setting name (`fast` and `apiKey` give `UAG_ENGINE_FAST_API_KEY`);
3. the variables the setting lists in `env`, in order;
4. its `default`.

| Key | Meaning |
|---|---|
| `env` | The type's own variables, as a name or a list. |
| `required` | Startup fails without a value. The error names the instance, the type, the setting and every variable that sets it. |
| `secret` | The value is kept out of startup errors and capability discovery. Errors an engine throws while it runs are logged as they are, so never put a setting's value in one. |
| `type` | `string` (the default), `number` or `boolean`. Values from the environment are converted. |
| `default` | Used when nothing else is set. |

## Instances

Hosts enable engines as named instances of a type:

```
UAG_ENGINES=jev,fast:claude,deep:claude,x:@acme/uag-engine-x
```

- A bare entry (`jev`) names an instance after its type.
- `<name>:<type>` names it yourself, so one type can run as several instances with different settings.
- A type starting with `@` or `uag-engine-`, or containing `/`, is a package name. A bare package entry takes the package's type name.
- Names use lowercase letters, digits and `-`, start with a letter, and are at most 63 characters. Anything else, including any path, is refused before anything is loaded.

In configuration, an entry is such a string, or `{ name, type, options }`, where `type` may also be an engine type definition.

## Loading

```js
const { engineInstances } = require('@formio/uag-sdk');
const { enginePaths, loadEngines } = require('@formio/uag-sdk/loader');

const engines = await loadEngines(engineInstances(config, process.env), {
    types: { remote: RemoteEngine },        // built-in and embedded types, tried first
    paths: enginePaths(__dirname, process.env),
    env: process.env,
    config,
});
```

A type name is looked up in `types`, then as `@formio/uag-<type>`, then as `uag-engine-<type>`. Packages are looked up in the `node_modules` of the host's installation and of the directories above it (where Node finds the host's own dependencies), then in `<dir>/node_modules` of each absolute directory in `UAG_ENGINE_PATH`. Never in the working directory, `NODE_PATH` or Node's global folders, and a package whose entry point resolves outside its own directory is refused. Nothing is ever installed. Engine packages are loaded with `require()`: CommonJS, or ES modules on Node 22.12 or later. Each result is `{ engine, type, package, version }`, which is what `Formflow.engineRegistry` takes.

Every definition is checked structurally, so a package built with another copy of this SDK, or with none, loads too. A package built for another engine contract version is refused, and the error names both versions.

## Errors

Throw `EngineError` for a failure whose message the caller may see, such as "Quota exceeded for this API key." Any other error is reported to API callers only as "the engine failed (see the logs for request X)", because provider SDK errors can carry URLs and account details.

## Helpers

- `requiredSchema(schema)`: the extraction schema with every field required, for strict structured outputs, and `decode(answer)` to map the answer back. An empty value stands for "not stated" and is left out. Numbers and yes/no fields travel as strings, keeping the field's title and description; a number written as an amount (`$4,250`) decodes to 4250, and anything else that is not a number is left out. A typed enum keeps its values, and an answer outside them is dropped.
- `parseJsonObject(text)`: the first JSON object in a text answer, or an `EngineError`.
- `toolResultText(result)`: a tool call's result as text for a model.

## Conformance

```js
const { checkEngine } = require('@formio/uag-sdk/conformance');

it('meets the engine contract', async () => {
    const report = await checkEngine(require('..'), { options: { client: fakeClient } });
    assert.deepStrictEqual(report.failures, []);
});
```

The check creates an instance and calls it. Pass options, such as a fake client, or the environment variables that let it answer. It checks that:

- the definition and the engine have the contract's shape;
- the engine uses the instance name and the `model` option;
- `extract` returns only the fields it was asked about, or `decide` only the questions it was asked;
- research stops at `maxIterations`, and reports every tool call it made;
- an aborted signal stops the engine, including during research.

A research round is the calls a model makes together; calls made one after another count as separate rounds.

License: MIT.
