# Sample: engine setups

<sub>[Form.io UAG](../../../README.md) &rsaquo; [Demo](../../README.md) &rsaquo; this page</sub>

Compose overrides, each showing another way to run the [Agent API](https://ai.form.io/developers/engines)'s engines. Each one changes only the engines of a stack whose UAG service is named `formio-uag`, such as the [custom module sample](../custom-module) or your own. The [demo site](../../docker-compose.yml) itself runs JEV and Claude on an engine server, behind its flow proxy.

Run one by adding it to the compose command, from your stack's folder:

```sh
docker compose -f docker-compose.yml -f ../engines/<file>.yml up -d
```

| File | Shows | Adds to `.env` |
|---|---|---|
| [`engine-server.yml`](./engine-server.yml) | Claude running on an engine server (`formio/uag-engines`), so its key and traffic stay out of the UAG. The UAG sends it only the engine server key, never a Form.io credential. | `ENGINE_SERVER_KEY`: 32+ random characters (`openssl rand -hex 32`), `CLAUDE_API_KEY` |
| [`instances.yml`](./instances.yml) | Two instances of one engine type, `fast:claude` and `deep:claude`, with their own models and settings, sharing one key. | `CLAUDE_API_KEY` |
| [`ollama.yml`](./ollama.yml) | A local model through Ollama, with the `openai` engine pointed at it: no API key, and no data leaving the network. | `OLLAMA_MODEL`: a model that supports structured outputs (and tool calling, for tasks that research). Pull it once with `docker compose exec ollama ollama pull "$OLLAMA_MODEL"`. |
| [`providers.yml`](./providers.yml) | Grok or Gemini in place of Claude, each through its own engine package. | `PROVIDER_ENGINE` (`grok` or `gemini`), and that provider's variables (see the file) |
| [`openai-decisions.yml`](./openai-decisions.yml) | OpenAI's Decisions API deciding the closed-set fields (`decide:openai` with `kind: decision`), with Claude writing the open values. | `OPENAI_API_KEY`, `CLAUDE_API_KEY` |

Real engines are Agentic Formflow: a self-hosted UAG needs a `LICENSE_KEY` that includes the UAG for them, unless `PROJECT` is on Form.io's hosted service (see [License](../../../README.md#license)). Every file passes `LICENSE_KEY` through from `.env`.

Check what a stack enabled at `GET /agent/capabilities` on the UAG: it lists each engine instance with its type, model, package and version.

## Mixing them

`UAG_ENGINES` names any mix of instances, each in the UAG or on an engine server. For example, JEV decisions with OpenAI's Decisions API as a fallback (`UAG_ENGINE_DECIDE_KIND=decision`), a local model for routine values, and Claude on an engine server for tasks that need it:

```yaml
UAG_ENGINES: jev,decide:openai,local:openai,claude:remote
```

Each instance takes its settings from `UAG_ENGINE_<NAME>_<SETTING>`, then the type's own variables (`TYPESAFE_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_BASE_URL`, …). See each engine's README: [jev](../../../engines/jev), [claude](../../../engines/claude), [openai](../../../engines/openai), [grok](../../../engines/grok), [gemini](../../../engines/gemini), and the [engine server](../../../packages/engine-server).
