---
title: Engines and routing
description: Enable decision and agent engines as named instances, configure each one, and control which engine answers which field.
section: Extend
order: 30
---

The Agent API does not call a model directly. It sorts a task's fields, sends each group to an **engine**, validates what comes back, and decides what to keep. This page covers the engines that ship with the UAG, how to enable and configure them, how fields are routed between them, and where they run. To write your own engine, see [Engine SDK](/developers/engine-sdk).

## Terms

| Term | Meaning | Example |
|---|---|---|
| Engine type | An adapter for a model API, published as its own npm package. | `claude` (`@formio/uag-claude`) |
| Instance | A configured engine you enable and route to, with a name. One type can have several instances. | `fast:claude`, `deep:claude` |
| Model | The model one instance calls. | `claude-haiku-5-5` |
| Kind | What an engine does: `decision` or `agent`. | `jev` is a decision engine |

### Decision engines and agent engines

| | Decision engine | Agent engine |
|---|---|---|
| Answers | Closed-set questions: pick an option (`choice`), place on an ordered scale (`score`), yes or no (`noul`). | Open values: dates, amounts, names, free text. Closed-set fields too, as a fallback. |
| Returns | A probability for each answer, and a confidence. | Values keyed by field path. |
| Results | `confident`, `uncertain` or `missing`, against the field's threshold. `calibrated: true`. | Always `suggested`. On decision fields, `calibrated: false`. |
| Speed | Fast: Jev typically answers in 70–500 ms. | Seconds; longer when researching with tools. |
| Tools | None. | May research with a task's read-only tools (`uagTools`) when it declares `toolUse`. |
| Official | `jev`; `openai` with `kind: decision` | `claude`, `openai`, `grok`, `gemini` |

Engines only answer. The UAG validates every value against the form and writes it itself, so no engine, and no model, ever holds a tool that writes.

```sequence
participants: Caller, UAG*, Decision engine, Agent engine
Caller -> UAG: one Agent API request for a task
note UAG: sorts the task's fields into a decision group and a value group
UAG -> Decision engine: radio, select, checkbox: choose with a confidence
UAG -> Agent engine: text, dates, amounts: write the values
Decision engine --> UAG: answers (or fails: the agent engine is asked)
Agent engine --> UAG: suggested values
note UAG: merges, validates with the form
UAG --> Caller: fields with status, engine, model, confidence
```

## Official engines

| Type | Package | Kinds | Default model | In `formio/uag` and `formio/uag-engines` |
|---|---|---|---|---|
| `jev` | `@formio/uag-jev` | decision | `jev-1.13.0` | Yes |
| `claude` | `@formio/uag-claude` | agent | `claude-opus-5-5` | Yes |
| `openai` | `@formio/uag-openai` | agent, or decision with `kind: decision` | none | Yes |
| `grok` | `@formio/uag-grok` | agent | none | Yes |
| `gemini` | `@formio/uag-gemini` | agent | none | Yes |

Three types are built into every UAG, whatever is installed:

| Type | Kinds | Purpose |
|---|---|---|
| `remote` | decision or agent | An engine hosted by an engine server. See [Engine server](/developers/engine-server). |
| `stub-decision` | decision | Answers every decision with a fixed, predictable value. For tests and local development. |
| `stub-agent` | agent | Extracts nothing. For tests and local development. |

With only the stub engines enabled (`UAG_ENGINES=stub-decision,stub-agent`), the Agent API runs without a license, so you can build against it before you have model keys. Every other engine needs a `LICENSE_KEY` that includes the UAG, or a project on Form.io's hosted service. See [Agent API](/developers/agent-api).

## Enabling engines

Nothing is enabled until you name it. Name instances in `UAG_ENGINES`, a comma-separated list:

```bash
UAG_ENGINES=jev,fast:claude,deep:claude
```

Or in configuration, which takes precedence when it is an array:

```js
new UAGServer({
    engines: [
        'jev',
        'fast:claude',
        { name: 'deep', type: 'claude', options: { model: 'claude-opus-5-5', researchEffort: 'high' } },
    ],
});
```

| Entry | Instance name | Type |
|---|---|---|
| `jev` | `jev` | `jev` |
| `fast:claude` | `fast` | `claude` |
| `x:@acme/uag-engine-x` | `x` | the type `@acme/uag-engine-x` exports |
| `uag-engine-keywords` | the type the package exports | the package's |
| `{ name, type, options }` | `name` | `type`: a type name, a package name, or an engine type definition |

- Instance names use lowercase letters, digits and `-`, start with a letter, and are at most 63 characters. Routing lists and `uagEngine` use them.
- A type that starts with `@` or `uag-engine-`, or contains `/`, is a package name. Anything else is a type name. Paths are refused before anything is loaded.
- `options` set an instance's settings and take precedence over every environment variable. They can also carry values that are not settings, such as a test client.
- An empty `UAG_ENGINES`, or an empty `engines` array, enables no engines. The MCP tools and conversation forms work as before.

### How a type is found

A type name is resolved from the first of:

1. `config.engineTypes[type]`: engine types your application passes in.
2. The built-in types: `remote`, `stub-decision`, `stub-agent`.
3. The package `@formio/uag-<type>`.
4. The package `uag-engine-<type>`.

Packages are looked up from the UAG's own installation, then from each absolute directory listed in `UAG_ENGINE_PATH` (separated by `:`), each of which holds a `node_modules` folder. Never from the working directory, and nothing is ever installed. A package built for another version of the engine contract is refused, naming both versions.

```bash
# Engines installed into a mounted volume.
npm install --prefix /engines uag-engine-acme
UAG_ENGINE_PATH=/engines UAG_ENGINES=acme npx uag
```

### Settings

Each type declares settings, such as `apiKey` and `model`. An instance's value for each setting is the first of:

1. The instance's `options` in configuration.
2. `UAG_ENGINE_<NAME>_<SETTING>`: the instance name and the setting in upper snake case. `fast` and `apiKey` give `UAG_ENGINE_FAST_API_KEY`; `baseURL` gives `BASE_URL`; `-` in a name becomes `_`.
3. The type's own variables, in order, such as `CLAUDE_API_KEY` then `ANTHROPIC_API_KEY`.
4. The setting's default.

```bash
UAG_ENGINES=jev,fast:claude,deep:claude
CLAUDE_API_KEY=sk-ant-...              # shared by both Claude instances
UAG_ENGINE_FAST_MODEL=claude-haiku-5-5
UAG_ENGINE_DEEP_MODEL=claude-opus-5-5
UAG_ENGINE_DEEP_RESEARCH_EFFORT=high
TYPESAFE_API_KEY=...
```

Values from the environment are converted to the setting's type (`number`, `boolean` from `true`/`false`, `1`/`0`, `yes`/`no`). Settings marked secret are kept out of error messages, logs and `/agent/capabilities`.

### When startup stops

Engines are enabled before the UAG serves anything. Any of these stops startup with the instance named:

| Problem | Message (example) |
|---|---|
| No such type installed | `No engine type "acme" is installed. Looked for "@formio/uag-acme" and "uag-engine-acme". Install one (npm install @formio/uag-acme), or add a directory that contains it to UAG_ENGINE_PATH.` |
| Missing required setting | `The "fast" engine (type "claude") needs its apiKey setting: set UAG_ENGINE_FAST_API_KEY, CLAUDE_API_KEY or ANTHROPIC_API_KEY.` |
| Invalid setting value | `The "deep" engine's researchEffort setting must be one of low, medium, high, xhigh, max, not "extreme".` |
| Duplicate name | `Two engines are named "claude". Engine instance names must be unique.` |
| Two instances reading one variable | `The engines "fast" and "fast-api" would both read UAG_ENGINE_FAST_API_KEY (for apiKey and key). Rename one of them.` |
| Wrong contract version | `... was built for engine API version 2; this server supports version 1.` |
| A `remote` engine the engine server does not host, or that refuses the key | `The "claude" engine could not start: the engine server at http://engines:3300 refused the engine server key (HTTP 401).` |

### What is enabled

`GET /agent/capabilities` lists each instance with its kind, model, type, and package and version when it came from one, and which Agent API operations can be served. It never lists settings.

```json
{
  "requestId": "6f1c…",
  "engines": [
    { "name": "jev", "kind": "decision", "model": "jev-1.13.0", "type": "jev", "package": "@formio/uag-jev", "version": "2.0.0" },
    { "name": "deep", "kind": "agent", "model": "claude-opus-5-5", "type": "claude", "package": "@formio/uag-claude", "version": "2.0.0" }
  ],
  "operations": {
    "extract": { "available": true, "engines": ["jev", "deep"] },
    "decide": { "available": true, "engines": ["jev", "deep"] },
    "generate": { "available": true, "engines": ["deep"] },
    "provide": { "available": true, "engines": ["jev", "deep"] }
  },
  "edition": "enterprise",
  "formflow": { "licensed": true, "allowed": true, "reason": "licensed" }
}
```

## Routing

For each request, the UAG sorts the task's fields into decision fields and value fields, and gives each group an ordered list of engines to try.

| Field | Kind of work |
|---|---|
| Radio, select with values, checkbox, select boxes, survey, and single-value resource selects whose whole resource fits the engine's option limit (`maxOptions`: 255 for Jev) | `decision` |
| Everything else: dates, amounts, names, free text, multi-value selects, resource selects too large for the limit | `value` |

A field's engines are the first of these that is set:

1. The component's `uagEngine` property.
2. The task's `uagEngine`, on its criteria component.
3. `config.routing.decision` or `config.routing.value`.
4. The defaults: `['decision', 'agent']` for decision fields, `['agent']` for value fields.

Each list entry, or each item of a comma-separated `uagEngine`, is an instance name, `decision` (every enabled decision engine, in the order enabled), or `agent` (every enabled agent engine; `llm` also works). Names of engines that are not enabled are skipped, so one configuration works on deployments that enable only some engines.

The UAG tries the list in order, for each group:

- Only decision work goes to a decision engine. Agent engines can do both; on decision fields they answer as an uncalibrated fallback (`calibrated: false`).
- An engine that fails, times out, or is over its rate limit is recorded in the group's `attempts`, and the next one is tried.
- Value fields whose task researches (`uagTools`, in `generate` and `provide`) go only to agent engines that declare `toolUse`.
- When every engine has failed, the group's fields are left unanswered, and an `error` names the failures. For `/agent/provide` and the `agentDecide` action, the save is then refused with `503` (or `429` when every engine was over its limit).

```js
new UAGServer({
    engines: ['jev', 'decide:openai', 'fast:claude', 'deep:claude'],
    routing: {
        decision: ['jev', 'decide', 'agent'],    // Jev, then OpenAI's Decisions API, then any agent engine
        value: ['fast', 'deep'],
        timeouts: { jev: 2000, decide: 5000, fast: 20000, deep: 60000 },
    },
});
```

On a form, send one task's open values to the deeper model by setting `uagEngine: "deep"` on its criteria component, or one field to it on the field itself.

### Agent API defaults

| Setting (`config`) | Default | Meaning |
|---|---|---|
| `routing.decision` | `['decision', 'agent']` | Engines for decision fields, tried in order. |
| `routing.value` | `['agent']` | Engines for value fields, tried in order. |
| `routing.timeouts[name]` | `agentApi.timeout` | Milliseconds before one engine's call is abandoned and the next is tried. The call's abort signal fires. |
| `agentApi.timeout` | `30000` | The default engine timeout. |
| `agentApi.research.timeout` | `120000` | Milliseconds a researching group may take on one engine, and the lifetime of its scoped token. |
| `agentApi.research.maxIterations` | `10` | Tool-use rounds before a researching engine must answer. |
| `agentApi.threshold` | `0.5` | Default `uagThreshold` for choice and score fields. |
| `agentApi.uncertainBand` | `[0.2, 0.8]` | Default `uagUncertainBand` for yes/no answers. |
| `agentApi.rateLimits.caller` | none | Per caller, by operation (`extract`, `decide`, `generate`, `provide`) or `default`: `{ limit, windowMs }`. |
| `agentApi.rateLimits.engine` | none | Per engine name, or `default`: `{ limit, windowMs }`. An engine over its limit is skipped. |

`windowMs` defaults to 60000. Counters are kept in memory per process. Choose thresholds with [`uag-eval`](/developers/evaluation) rather than leaving the defaults.

## Where engines run

| | In the UAG (default) | On an engine server |
|---|---|---|
| How | `UAG_ENGINES=claude` with `CLAUDE_API_KEY` on the UAG. | `UAG_ENGINES=claude:remote` on the UAG; `formio/uag-engines` runs `claude`. |
| Model keys | In the UAG container. | Only in the engine server container. |
| Model traffic | From the UAG. | From the engine server. |
| Research | In process, through `callTool`. | Back into the UAG's `/mcp`, with a scoped token. |
| Containers | One. | Two, on a private network. |

A deployment can mix both: `UAG_ENGINES=jev,claude:remote` keeps Jev in the UAG and moves Claude out. See [Engine server](/developers/engine-server).

## Building a smaller image

`formio/uag` includes every official engine. Each engine is its own package and the UAG uses only the ones installed, so an image with fewer engines installs `@formio/uag` and just those packages, and starts with the `uag` command:

```dockerfile
FROM node:lts-alpine AS build
WORKDIR /app
# isolated-vm, which runs form logic, compiles on install.
RUN apk add --no-cache make python3 g++
RUN npm install --omit=dev @formio/uag @formio/uag-claude

FROM node:lts-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
# Optional: your module (forms, actions, configuration).
# COPY module ./module
# ENV UAG_MODULE=./module
ENV NODE_OPTIONS=--no-node-snapshot
ENTRYPOINT ["node_modules/.bin/uag"]
```

Configure it as you would `formio/uag`, with `UAG_ENGINES=claude` and `CLAUDE_API_KEY`. Naming an engine whose package is not installed stops startup with the package to install.

## The official engines

`<NAME>` in the tables below is the instance name in upper snake case. An instance's own variable wins over the type's shared one.

### jev

TypeSafe's Jev decision engine. It answers all of a task's decision fields in one request, with a confidence for each.

```bash
UAG_ENGINES=jev
TYPESAFE_API_KEY=...
```

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `TYPESAFE_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `TYPESAFE_MODEL` | `jev-1.13.0` |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL`, `TYPESAFE_BASE_URL` | the SDK's default |

- `maxOptions` is 255: closed sets with more options go to an agent engine.
- The TypeSafe SDK's request timeout follows the instance's routing timeout (`routing.timeouts.<name>`, else `agentApi.timeout`, else 30 s), so its retries never outlast it.
- Pin `model` to a dated version and run `uag-eval` before changing it. To compare a new version on live traffic, run two instances: `UAG_ENGINES=jev,next:jev` with `UAG_ENGINE_NEXT_MODEL=jev-1.14.0`, and `routing.decision: ["next", "jev"]`.
- **Data residency:** each request sends TypeSafe the task's criteria, today's date, the `uagContext` values, and the task's input (or, for a task without one, the whole submission except the fields being decided).

### claude

Anthropic's Claude, as an agent engine. It extracts with structured outputs and, when a task lists tools, researches with them first.

```bash
UAG_ENGINES=claude
CLAUDE_API_KEY=...
```

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `CLAUDE_API_KEY`, `ANTHROPIC_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `CLAUDE_MODEL` | `claude-opus-5-5` |
| `effort` | `UAG_ENGINE_<NAME>_EFFORT`, `CLAUDE_EFFORT` | `low`, for extraction |
| `researchEffort` | `UAG_ENGINE_<NAME>_RESEARCH_EFFORT`, `CLAUDE_RESEARCH_EFFORT` | `medium`, for research with tools |
| `fallbacks` | `UAG_ENGINE_<NAME>_FALLBACKS`, `CLAUDE_FALLBACKS` | `default`; `off` disables |

- `effort` and `researchEffort` take `low`, `medium`, `high`, `xhigh` or `max`.
- **Extraction** is one call with a JSON schema the UAG derives from the form (`output_config.format`). Values are always `suggested`.
- **Research:** Claude may call the task's tools for up to `agentApi.research.maxIterations` turns, then answers with tools turned off.
- **Refusals:** with `fallbacks: default`, a refused request is re-run on a fallback model server-side. A refusal that stands is an engine failure, and routing moves on.
- Set `model` to a specific model ID; a new release may change the default.

### openai

OpenAI, or any server that implements its chat completions API: local models (Ollama, vLLM, LM Studio) and routers (OpenRouter). An instance is an agent engine by default, or a decision engine on OpenAI's Decisions API with `kind: decision`.

```bash
UAG_ENGINES=openai
OPENAI_API_KEY=...
OPENAI_MODEL=<a dated model ID>
```

| Setting | Variables | Default |
|---|---|---|
| `kind` | `UAG_ENGINE_<NAME>_KIND`, `OPENAI_KIND` | `agent`; `decision` for the Decisions API |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `OPENAI_MODEL` | required; there is no default |
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `OPENAI_API_KEY` | required unless `baseURL` is set (secret) |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL`, `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT`, `OPENAI_STRUCTURED_OUTPUT` | `json_schema` |
| `reasoningEffort` | `UAG_ENGINE_<NAME>_REASONING_EFFORT`, `OPENAI_REASONING_EFFORT` | not sent |
| `api` | `UAG_ENGINE_<NAME>_API`, `OPENAI_API` | `responses` for OpenAI itself; `chat` when `baseURL` is set |
| `maxOptions` | `UAG_ENGINE_<NAME>_MAX_OPTIONS` | `255`; decision kind only |

`structuredOutput` says how the answer is constrained:

| Mode | Use when |
|---|---|
| `json_schema` | The server supports strict JSON schema response formats: OpenAI, and recent vLLM, Ollama and OpenRouter models. |
| `json_object` | The server supports JSON mode but not schemas. The schema goes in the prompt. |
| `prompt` | The server supports neither. The schema goes in the prompt, and the answer is read from the text. |

- **Which API:** with OpenAI itself the engine uses the Responses API, which allows tools while a model reasons, with `store: false`. With any other server it uses Chat Completions. Set `api` to choose, for example for a gateway in front of OpenAI.
- **Dates with OpenAI:** OpenAI's strict mode corrupts constrained dates, so with OpenAI itself each field's format and pattern go into its description instead. Other servers keep the constraints; the UAG validates every value either way.
- **Research** uses function calling. A task that researches needs a server that supports it.
- **Failures:** a refusal, a content filter, a truncated answer or an answer that is not JSON is an engine failure.

**Compatible servers and Ollama.** Point `baseURL` at the server. No key is needed when the server does not check one.

```bash
UAG_ENGINES=jev,local:openai,claude
UAG_ENGINE_LOCAL_BASE_URL=http://ollama:11434/v1
UAG_ENGINE_LOCAL_MODEL=llama4:16x17b
CLAUDE_API_KEY=...
```

Choose a model that supports structured outputs, and tool calling for tasks that research. If a smaller model does not follow strict schemas, set `structuredOutput` to `json_object`.

**Decisions.** With `kind: decision`, an instance answers the same questions Jev does, all of a task's decision fields in one request:

| UAG question | Decisions API question | Answer |
|---|---|---|
| yes/no | `predicate` | the probability it holds |
| choice | `choice` | the option, a probability for each, and a confidence |
| score | `score` | the position, a probability for each level, and a confidence |

```bash
UAG_ENGINES=decide:openai,writer:openai
OPENAI_API_KEY=...
UAG_ENGINE_DECIDE_KIND=decision
UAG_ENGINE_DECIDE_MODEL=gpt-6-luna
UAG_ENGINE_WRITER_MODEL=<a dated model ID>
```

Its answers are reported `calibrated: true`, and `uagThreshold` and `uagUncertainBand` apply. No provider guarantees calibration: measure with `uag-eval --engine decide` before relying on the defaults. A question the API declines is left undecided; a request with more than 400 questions is split across calls; `maxOptions` caps the options of one question.

### grok

xAI's Grok models through xAI's OpenAI-compatible API, as an agent engine. It is the `openai` engine's agent kind with xAI's endpoint and key built in.

```bash
UAG_ENGINES=grok
XAI_API_KEY=...
XAI_MODEL=<a Grok model ID>
```

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `XAI_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `XAI_MODEL` | required; there is no default |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL` | `https://api.x.ai/v1` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT` | `json_schema`; `json_object` or `prompt` if a model refuses strict schemas |

Grok has no decision API, so decision fields routed to it are answered as extraction and reported `calibrated: false`.

### gemini

Google's Gemini models through Google's OpenAI-compatible endpoint, as an agent engine.

```bash
UAG_ENGINES=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=<a Gemini model ID>
```

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `GEMINI_MODEL` | required; there is no default |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT` | `json_schema`; `json_object` or `prompt` if a model refuses strict schemas |
| `reasoningEffort` | `UAG_ENGINE_<NAME>_REASONING_EFFORT`, `GEMINI_REASONING_EFFORT` | not sent |

Gemini has no decision API, so decision fields routed to it are answered as extraction and reported `calibrated: false`.

> **Note:** For Grok, Gemini and any agent engine that sends data to a hosted model, each request sends the provider the task's criteria, its input (or, without one, the whole submission except the fields being answered), its `uagContext` values, today's date, and, for a task that researches, what its tools return.

The repository also holds an `mai` engine for Microsoft's MAI models on Microsoft Foundry. It is not released: it is not published to npm or included in the images.

## Recipes

Each recipe is a Docker Compose override for a stack whose UAG service is named `formio-uag` and runs its engines inside the UAG, such as the [custom module sample](https://github.com/formio/uag/tree/main/demo/samples/custom-module). Run one from that stack's folder:

```bash
docker compose -f docker-compose.yml -f <recipe>.yml up -d
```

Check what a stack enabled at `GET /agent/capabilities`.

### Claude on an engine server

Claude's key and traffic stay in their own container. The UAG sends the engine server only the engine server key. Set `ENGINE_SERVER_KEY` in `.env` to 32 or more random characters (`openssl rand -hex 32`). Source: [`engine-server.yml`](https://github.com/formio/uag/blob/main/demo/samples/engines/engine-server.yml).

```yaml
services:
  uag-engines:
    image: formio/uag-engines:2
    restart: always
    environment:
      UAG_ENGINES: claude
      CLAUDE_MODEL: claude-sonnet-5-5
      CLAUDE_API_KEY: ${CLAUDE_API_KEY:?set CLAUDE_API_KEY in .env}
      UAG_ENGINE_SERVER_KEY: ${ENGINE_SERVER_KEY:?set ENGINE_SERVER_KEY in .env (32+ characters)}
      # Where research calls the UAG's /mcp. Taken from here only, never from a request.
      UAG_SERVER: http://formio-uag:3200
    # No published port: only the UAG, on this private network, reaches it.

  formio-uag:
    depends_on:
      uag-engines:
        condition: service_healthy
    environment:
      UAG_ENGINES: claude:remote
      UAG_ENGINE_CLAUDE_URL: http://uag-engines:3300
      UAG_ENGINE_CLAUDE_KEY: ${ENGINE_SERVER_KEY}
      # The UAG no longer needs the Claude key.
      CLAUDE_API_KEY: ""
```

### Two instances of one engine

A fast model and a deeper one with more research effort, sharing one key. Fields go to the first agent engine, `fast`; send a task to `deep` with `uagEngine: "deep"` on its criteria component. Source: [`instances.yml`](https://github.com/formio/uag/blob/main/demo/samples/engines/instances.yml).

```yaml
services:
  formio-uag:
    environment:
      UAG_ENGINES: fast:claude,deep:claude
      UAG_ENGINE_FAST_MODEL: claude-haiku-5-5
      UAG_ENGINE_DEEP_MODEL: claude-opus-5-5
      UAG_ENGINE_DEEP_RESEARCH_EFFORT: high
      # UAG_ENGINE_DEEP_API_KEY would give one instance its own key.
```

### A local model through Ollama

No API key, and no data leaving the network. Set `OLLAMA_MODEL` in `.env`, then pull it once: `docker compose exec ollama ollama pull "$OLLAMA_MODEL"`. Source: [`ollama.yml`](https://github.com/formio/uag/blob/main/demo/samples/engines/ollama.yml).

```yaml
services:
  ollama:
    image: ollama/ollama
    restart: always
    volumes:
      - uag-example-ollama:/root/.ollama

  formio-uag:
    depends_on:
      - ollama
    environment:
      UAG_ENGINES: local:openai
      UAG_ENGINE_LOCAL_BASE_URL: http://ollama:11434/v1
      UAG_ENGINE_LOCAL_MODEL: ${OLLAMA_MODEL:?set OLLAMA_MODEL in .env}
      # Smaller models may not follow strict JSON schemas; try json_object.
      UAG_ENGINE_LOCAL_STRUCTURED_OUTPUT: json_schema
      CLAUDE_API_KEY: ""

volumes:
  uag-example-ollama:
```

### Grok or Gemini in place of Claude

Set `PROVIDER_ENGINE` in `.env` to `grok` or `gemini`, with that provider's variables. Source: [`providers.yml`](https://github.com/formio/uag/blob/main/demo/samples/engines/providers.yml).

```yaml
services:
  formio-uag:
    environment:
      UAG_ENGINES: ${PROVIDER_ENGINE:?set PROVIDER_ENGINE in .env to grok or gemini}
      XAI_API_KEY: ${XAI_API_KEY:-}
      XAI_MODEL: ${XAI_MODEL:-}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      GEMINI_MODEL: ${GEMINI_MODEL:-}
      CLAUDE_API_KEY: ""
```

### OpenAI's Decisions API with Claude

`decide` answers the closed-set fields; Claude answers them only if it fails, and writes the open values. Source: [`openai-decisions.yml`](https://github.com/formio/uag/blob/main/demo/samples/engines/openai-decisions.yml).

```yaml
services:
  formio-uag:
    environment:
      UAG_ENGINES: decide:openai,claude
      OPENAI_API_KEY: ${OPENAI_API_KEY:?set OPENAI_API_KEY in .env}
      UAG_ENGINE_DECIDE_KIND: decision
      UAG_ENGINE_DECIDE_MODEL: gpt-6-luna
```

### Mixing them

Jev decisions with OpenAI's Decisions API as a fallback, a local model for routine values, and Claude on an engine server for the tasks that need it:

```yaml
UAG_ENGINES: jev,decide:openai,local:openai,claude:remote
```

## Next steps

- [Engine SDK](/developers/engine-sdk): write an engine package.
- [Engine server](/developers/engine-server): run engines in their own container.
- [Evaluation](/developers/evaluation): choose thresholds for a decision engine.
