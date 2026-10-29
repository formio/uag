# @formio/uag-gemini

<sub>[Form.io UAG](https://github.com/formio/uag/blob/main/README.md) &rsaquo; [Engines](https://github.com/formio/uag/blob/main/README.md#engines-and-routing) &rsaquo; this page</sub>

The **Gemini** agent engine for the [UAG Agent API](https://github.com/formio/uag/blob/main/README.md#agent-api): Google's Gemini models, through Google's OpenAI-compatible endpoint. It extracts and generates open values (dates, amounts, names, free text) with structured outputs. When a task lists read-only tools in `uagTools`, it researches with them first.

It is included in the `formio/uag` Docker image. Enable it by naming it, and set its key and model:

```
UAG_ENGINES=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=<a Gemini model ID>
```

Its tasks are Agentic Formflow, so the UAG also needs a `LICENSE_KEY` that includes the UAG (see [License](https://github.com/formio/uag/blob/main/README.md#license)).

## Settings

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `GEMINI_MODEL` | required; there is no default |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT` | `json_schema`; `json_object` or `prompt` if a model refuses strict schemas |
| `reasoningEffort` | `UAG_ENGINE_<NAME>_REASONING_EFFORT`, `GEMINI_REASONING_EFFORT` | not sent |

`<NAME>` is the instance name, upper-cased with `-` as `_`. An instance's own variable wins over the shared one.

## Instances

A Flash model for routine values and a Pro model for tasks that need more, sharing one key:

```
UAG_ENGINES=jev,flash:gemini,pro:gemini
GEMINI_API_KEY=...
UAG_ENGINE_FLASH_MODEL=<a Gemini Flash model ID>
UAG_ENGINE_PRO_MODEL=<a Gemini Pro model ID>
```

Routing lists, and a field's `uagEngine` property, name the instances, for example `routing.value: ["flash", "pro"]`.

## Choosing a model

There is no default model: set `model` to a specific model ID from Google's documentation, not an alias that moves. Answers differ between models, so compare them on your own labeled examples before switching (`uag-eval` measures decision engines only).

## How it works

It is the [OpenAI engine](https://github.com/formio/uag/tree/main/engines/openai)'s agent kind with Google's endpoint and key built in: one chat completion with a strict JSON schema per extraction, and a function-calling loop over the task's read-only tools for research, ending in the same structured answer. A refusal, a truncated answer or an answer that is not JSON is an engine failure, and the UAG falls back to the next engine.

Each field's format (such as `date`) and pattern are written into its description, not sent as schema constraints, so a field the input does not state stays empty instead of being invented to fit a pattern. The UAG validates every value either way.

Gemini has no decision API, and current Gemini models do not reliably return token probabilities, so this is an agent engine only. Decision fields routed to it are answered as extraction and reported `calibrated: false`.

**Data residency:** each request sends Google the task's criteria, its input (or, without an input, the whole submission except the fields being answered), its `uagContext` values and today's date, and, for a task that researches, what its tools return.

## Using it in your own server

```js
const server = new UAGServer({ engines: [{ name: 'gemini', type: 'gemini', options: { model: '<a Gemini model ID>' } }] });
```

License: MIT.
