# @formio/uag-grok

<sub>[Form.io UAG](../../README.md) &rsaquo; [Engines](../../README.md#engines-and-routing) &rsaquo; this page</sub>

The **Grok** agent engine for the [UAG Agent API](../../README.md#agent-api): xAI's models, through xAI's OpenAI-compatible API. It extracts and generates open values (dates, amounts, names, free text) with structured outputs. When a task lists read-only tools in `uagTools`, it researches with them first.

It is included in the `formio/uag` Docker image. Enable it by naming it, and set its key and model:

```
UAG_ENGINES=grok
XAI_API_KEY=...
XAI_MODEL=<a Grok model ID>
```

Its tasks are Agentic Formflow, so the UAG also needs a `LICENSE_KEY` that includes the UAG (see [License](../../README.md#license)).

## Settings

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `XAI_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `XAI_MODEL` | required; there is no default |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL` | `https://api.x.ai/v1` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT` | `json_schema`; `json_object` or `prompt` if a model refuses strict schemas |

`<NAME>` is the instance name, upper-cased with `-` as `_`. An instance's own variable wins over the shared one.

## Instances

A fast Grok model for routine values next to Claude for the rest:

```
UAG_ENGINES=jev,fast:grok,claude
XAI_API_KEY=...
UAG_ENGINE_FAST_MODEL=<a fast Grok model ID>
CLAUDE_API_KEY=...
```

Routing lists, and a field's `uagEngine` property, name the instances, for example `routing.value: ["fast", "claude"]`.

## Choosing a model

There is no default model: set `model` to a specific model ID from xAI's documentation, not an alias that moves. Answers differ between models, so run `uag-eval` on your own labeled examples before switching.

## How it works

It is the [OpenAI engine](../openai)'s agent kind with xAI's endpoint and key built in: one chat completion with a strict JSON schema per extraction, and a function-calling loop over the task's read-only tools for research, ending in the same structured answer. A refusal, a truncated answer or an answer that is not JSON is an engine failure, and the UAG falls back to the next engine.

Grok has no decision API, and current Grok models return no token probabilities, so this is an agent engine only. Decision fields routed to it are answered as extraction and reported `calibrated: false`.

**Data residency:** each request sends xAI the task's criteria, its input (or, without an input, the whole submission except the fields being answered), its `uagContext` values and today's date, and, for a task that researches, what its tools return.

## Using it in your own server

```js
const server = new UAGServer({ engines: [{ name: 'grok', type: 'grok', options: { model: '<a Grok model ID>' } }] });
```

License: MIT.
