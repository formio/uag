# @formio/uag-claude

<sub>[Form.io UAG](https://github.com/formio/uag/blob/main/README.md) &rsaquo; [Engines](https://github.com/formio/uag/blob/main/README.md#engines-and-routing) &rsaquo; this page</sub>

The **Claude** agent engine for the [UAG Agent API](https://github.com/formio/uag/blob/main/README.md#agent-api). It extracts and generates open values (dates, amounts, names, free text) with structured outputs. When a task lists read-only tools in `uagTools`, it researches with them first.

It is included in the `formio/uag` Docker image. Enable it by naming it, and set its key:

```
UAG_ENGINES=claude          # or jev,claude
CLAUDE_API_KEY=...
```

Its tasks are Agentic Formflow, so the UAG also needs a `LICENSE_KEY` that includes the UAG (see [License](https://github.com/formio/uag/blob/main/README.md#license)).

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

Set `model` to a specific model ID rather than relying on the default. A new UAG release may change the default, and answers can differ between models, so compare them on your own labeled examples before changing it (`uag-eval` measures decision engines only).

Every request sends `effort` (or `researchEffort`), so the model must accept it:

- The current models take all five levels: Claude Opus 5.5, Opus 5, Sonnet 5.5, Sonnet 5, Haiku 5.5, Opus 4.8 and Opus 4.7.
- Claude Opus 4.6 and Sonnet 4.6 take every level except `xhigh`.
- Claude Haiku 4.5 and Sonnet 4.5 refuse `effort`, so every request to them fails. Use a current model.

## How it works

- **Extraction** uses structured outputs (`output_config.format`) with a JSON schema the UAG derives from the form. Answers are valid JSON for exactly the requested fields. Values from this engine are always reported as `suggested`.
- **Research:** when a task lists read-only tools, Claude may call them first, up to `agentApi.research.maxIterations` turns. Every call goes back through the UAG with the caller's identity. Claude then answers with the same structured output, with tools turned off. It never writes: the UAG validates the values and saves them itself.
- **Refusals:** with `fallbacks` at `default`, the API re-runs a refused request on a fallback model server-side, for the models that have one (such as Claude Opus 5.5 and Sonnet 5.5). Claude Haiku 5.5 has none, so its refusals stand. A refusal that stands is reported as an engine failure, and the UAG falls back to the next engine.
- **Token limit:** each answer may use up to 16,000 tokens. A research turn or an answer cut off at that limit is an engine failure, and the UAG falls back to the next engine.
- **Aborts:** the routing timeout (for research, `agentApi.research.timeout`) aborts the request, and research stops before its next call.

## Upgrading from 1.x

`@formio/uag-claude` 1.x was a different program: the Claude integration, a standalone server (`uag-claude`, the `formio/uag-claude` image) that ran its own MCP client against the UAG. 2.0 is an engine: a library the UAG loads, with no server and no command to run. Installing 2.0 where 1.x ran gives a package that does nothing on its own.

- **To keep the 1.x integration,** pin `@formio/uag-claude@^1` (or the `formio/uag-claude:1.3` image). 1.3.x keeps working against UAG 2.0, and gets security fixes only.
- **To move to 2.0,** turn the engine on in the UAG (`UAG_ENGINES=claude`, `CLAUDE_API_KEY`), or in a `formio/uag-engines` container next to it, and remove the integration container. See [Migrating to 2.0](https://github.com/formio/uag/blob/main/MIGRATING-2.0.md#the-claude-integration-is-retired) for what replaces its webhooks and commands.

| 1.x setting | 2.0 |
|---|---|
| `CLAUDE_API_KEY` | Unchanged; `ANTHROPIC_API_KEY` also works. |
| `CLAUDE_MODEL` | Unchanged, but the model must accept `effort` (see [Choosing a model](#choosing-a-model)). |
| `CLAUDE_MAX_TOKENS` | Gone: each answer may use up to 16,000 tokens. Use `CLAUDE_EFFORT` and `CLAUDE_RESEARCH_EFFORT` to trade depth for cost. |
| `CLAUDE_MAX_ITERATIONS` | The UAG's `agentApi.research.maxIterations`. |
| `PROJECT`, `PROJECT_KEY`, `ADMIN_KEY`, `BASE_URL`, `PORT` | Not engine settings: the engine runs inside the UAG (or on the engine server), and the UAG calls it. |
| `UAG_SERVER` | Not an engine setting either. On the engine server it is the UAG's URL, which research calls back into (`/mcp`); inside the UAG it is not needed. |
| A webhook to `/agent/claude/agent_provide_data` | An "Agent: Run task" action on the form. |
| `POST /agent/claude/collect_field_data` | `POST {form}/agent/extract` on the UAG. |
| `POST /agent/claude` (a free-form command) | No Agent API equivalent: an engine answers a form's task. Connect an MCP client to the UAG's `/mcp` instead, where Form.io permissions apply to every tool call. |

## Using it in your own server

Name it in configuration instead of `UAG_ENGINES`, with options that take precedence over the environment:

```js
const server = new UAGServer({
    engines: [{ name: 'deep', type: 'claude', options: { model: 'claude-opus-5-5', researchEffort: 'high' } }],
});
```

License: MIT.
