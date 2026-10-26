# @formio/uag-claude

<sub>[Form.io UAG](../../README.md) &rsaquo; [Engines](../../README.md#engines-and-routing) &rsaquo; this page</sub>

The **Claude** agent engine for the [UAG Agent API](../../README.md#agent-api). It extracts and generates open values (dates, amounts, names, free text) with structured outputs. When a task lists read-only tools in `uagTools`, it researches with them first.

It is included in the `formio/uag` Docker image. Enable it by naming it, and set its key:

```
UAG_ENGINES=claude          # or jev,claude
CLAUDE_API_KEY=...
```

Its tasks are Agentic Formflow, so the UAG also needs a `LICENSE_KEY` that includes the UAG (see [License](../../README.md#license)).

## Settings

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `CLAUDE_API_KEY`, `ANTHROPIC_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `CLAUDE_MODEL` | `claude-opus-5-5` |
| `effort` | `UAG_ENGINE_<NAME>_EFFORT`, `CLAUDE_EFFORT` | `low`, for extraction |
| `researchEffort` | `UAG_ENGINE_<NAME>_RESEARCH_EFFORT`, `CLAUDE_RESEARCH_EFFORT` | `medium`, for research with tools |
| `fallbacks` | `UAG_ENGINE_<NAME>_FALLBACKS`, `CLAUDE_FALLBACKS` | `default`; `off` disables |

`<NAME>` is the instance name, upper-cased with `-` as `_`. An instance's own variable wins over the shared one. `effort` and `researchEffort` take `low`, `medium`, `high`, `xhigh` or `max`.

## Instances

Run a fast model for simple fields and a deeper one for the rest, sharing one key:

```
UAG_ENGINES=jev,fast:claude,deep:claude
CLAUDE_API_KEY=...
UAG_ENGINE_FAST_MODEL=claude-haiku-5-5
UAG_ENGINE_DEEP_MODEL=claude-opus-5-5
UAG_ENGINE_DEEP_RESEARCH_EFFORT=high
```

Routing lists, and a field's `uagEngine` property, name the instances, for example `routing.value: ["fast", "deep"]`.

## Choosing a model

Set `model` to a specific model ID rather than relying on the default. A new UAG release may change the default, and answers can differ between models. Run `uag-eval` on your own labeled examples before changing it.

## How it works

- **Extraction** uses structured outputs (`output_config.format`) with a JSON schema the UAG derives from the form. Answers are valid JSON for exactly the requested fields. Values from this engine are always reported as `suggested`.
- **Research:** when a task lists read-only tools, Claude may call them first, up to `agentApi.research.maxIterations` turns. Every call goes back through the UAG with the caller's identity. Claude then answers with the same structured output, with tools turned off. It never writes: the UAG validates the values and saves them itself.
- **Refusals:** with `fallbacks` at `default`, the API re-runs a refused request on a fallback model server-side. A refusal that still stands is reported as an engine failure, and the UAG falls back to the next engine.
- **Aborts:** the routing timeout aborts the request, and research stops before its next call.

## Using it in your own server

Name it in configuration instead of `UAG_ENGINES`, with options that take precedence over the environment:

```js
const server = new UAGServer({
    engines: [{ name: 'deep', type: 'claude', options: { model: 'claude-opus-5-5', researchEffort: 'high' } }],
});
```

License: MIT.
