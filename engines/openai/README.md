# @formio/uag-openai

<sub>[Form.io UAG](https://github.com/formio/uag/blob/main/README.md) &rsaquo; [Engines](https://github.com/formio/uag/blob/main/README.md#engines-and-routing) &rsaquo; this page</sub>

The OpenAI engine for the [UAG Agent API](https://github.com/formio/uag/blob/main/README.md#agent-api). An instance is one of two kinds:

- **agent** (the default): extracts and generates open values on OpenAI's Responses API, or, through Chat Completions, on any server that implements that API: local models (Ollama, vLLM, LM Studio) and routers (OpenRouter). When a task lists read-only tools in `uagTools`, it researches with them first. Grok and Gemini have their own packages built on it: [`grok`](https://github.com/formio/uag/tree/main/engines/grok) and [`gemini`](https://github.com/formio/uag/tree/main/engines/gemini).
- **decision**: decides closed-set fields with a probability for each answer, on OpenAI's Decisions API, like the [`jev`](https://github.com/formio/uag/tree/main/engines/jev) engine. See [Decisions](#decisions).

It is included in the `formio/uag` Docker image. Enable it by naming it, and set its model and key:

```
UAG_ENGINES=openai
OPENAI_API_KEY=...
OPENAI_MODEL=<a dated model ID>
```

Its tasks are Agentic Formflow, so the UAG also needs a `LICENSE_KEY` that includes the UAG (see [License](https://github.com/formio/uag/blob/main/README.md#license)).

## Settings

| Setting | Variables | Default |
|---|---|---|
| `kind` | `UAG_ENGINE_<NAME>_KIND`, `OPENAI_KIND` | `agent`; `decision` for the Decisions API |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `OPENAI_MODEL` | required; there is no default |
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`; `OPENAI_API_KEY` for OpenAI itself only | required for OpenAI itself (secret) |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL`, `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT`, `OPENAI_STRUCTURED_OUTPUT` | `json_schema` |
| `reasoningEffort` | `UAG_ENGINE_<NAME>_REASONING_EFFORT`, `OPENAI_REASONING_EFFORT` | not sent |
| `api` | `UAG_ENGINE_<NAME>_API`, `OPENAI_API` | `responses` for OpenAI itself; `chat` for any other server |
| `maxOptions` | `UAG_ENGINE_<NAME>_MAX_OPTIONS` | `255`, the Decisions API's limit and the most it takes; decision kind only |

`<NAME>` is the instance name, upper-cased with `-` as `_`. An instance's own variable wins over the shared one.

OpenAI's own variables, `OPENAI_API_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` and `OPENAI_CUSTOM_HEADERS`, are sent only to OpenAI itself (`api.openai.com`). An instance whose `baseURL` is any other server, including a proxy in front of OpenAI, gets none of them: give it its own key with `UAG_ENGINE_<NAME>_API_KEY`, or none for a server that needs no key. Grok, Gemini and the other engines built on this one never get them either.

`structuredOutput` says how the server is asked for the answer:

| Mode | Use when |
|---|---|
| `json_schema` | The server supports strict JSON schema response formats: OpenAI, and recent vLLM, Ollama and OpenRouter models. |
| `json_object` | The server supports JSON mode but not schemas. The schema goes in the prompt. |
| `prompt` | The server supports neither. The schema goes in the prompt, and the answer is read from the text. |

In every mode, an answer that is not a JSON object fails as an engine failure, and the UAG routes the fields to the next engine.

## Instances

A local model through Ollama, next to Claude, with no key:

```
UAG_ENGINES=jev,local:openai,claude
UAG_ENGINE_LOCAL_BASE_URL=http://ollama:11434/v1
UAG_ENGINE_LOCAL_MODEL=llama4:16x17b
CLAUDE_API_KEY=...
```

For Grok and Gemini, use their own engines ([`grok`](https://github.com/formio/uag/tree/main/engines/grok), [`gemini`](https://github.com/formio/uag/tree/main/engines/gemini)), which have the right endpoints and keys built in. Any other OpenAI-compatible server works with `baseURL`; check its documentation for model IDs and for which `structuredOutput` mode it supports.

## Decisions

With `kind` set to `decision`, an instance is a decision engine on OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions). It answers the same questions `jev` does, with all of a task's decision fields in one request:

| UAG question | Decisions API question | Answer |
|---|---|---|
| yes/no (a field addressed, affirmed or denied) | `predicate` | the probability it holds |
| choice (radio, select, checkbox) | `choice` | the option, a probability for each, and a confidence |
| score (an ordered scale) | `score` | the position on the scale, a probability for each level, and a confidence |

```
UAG_ENGINES=decide:openai,writer:openai
OPENAI_API_KEY=...
UAG_ENGINE_DECIDE_KIND=decision
UAG_ENGINE_DECIDE_MODEL=gpt-6-luna
UAG_ENGINE_WRITER_MODEL=<a dated model ID>
```

Its answers are reported `calibrated: true`, like `jev`'s, and the same thresholds (`uagThreshold`, `uagUncertainBand`) apply. OpenAI makes no calibration guarantee for these probabilities, and neither does any provider: measure with `uag-eval --engine decide` on your own labeled examples before relying on the default thresholds, and again when you change the model.

- A question the API declines is left undecided, so its field is reported `missing` or decided by the next engine in the routing list.
- A request with more than 400 questions is split across calls.
- `maxOptions` caps the options one choice question may have. Closed sets with more options go to an agent engine.
- Both `jev` and an `openai` decision instance can be enabled; list both in `routing.decision` to fall back from one to the other.

## Choosing a model

There is no default model: set `model` to a specific, dated model ID, not an alias that moves. Answers differ between models, so compare them on your own labeled examples before switching (`uag-eval` measures decision engines only).

## How it works

- **Which API.** With OpenAI itself, the engine uses the Responses API, which lets current models reason while they use tools (Chat Completions refuses tools on a reasoning model). Nothing is stored at OpenAI (`store: false`): the model's reasoning carries across research turns as encrypted reasoning items, sent back with the history. With any other server (`baseURL`), it uses Chat Completions, which local servers and routers implement. Set `api` to `responses` or `chat` to choose yourself, for example for a gateway in front of OpenAI.
- **Dates with OpenAI.** OpenAI's strict mode corrupts dates when the schema constrains them (the year comes back as 1000, 1010, 3362 …), so with OpenAI itself the engine writes each field's format (such as `date`) and pattern into its description instead. Measured October 2026; other servers keep the constraints, and the UAG validates every value either way.
- **Extraction** makes one request, constrained as `structuredOutput` says. Values from this engine are always reported as `suggested`, and only the requested fields are returned.
- **Research:** when a task lists read-only tools, the model may call them first through function calling, up to `agentApi.research.maxIterations` turns. Every call goes back through the UAG with the caller's identity, and tool errors are returned to the model. The model then answers with tools turned off. It never writes: the UAG validates the values and saves them itself. Tasks that research need a server that supports function calling; on one that does not, the request fails as an engine failure.
- **Failures:** a refusal, a content filter, a truncated answer or an answer that is not JSON fails as an engine failure, and the UAG falls back to the next engine.
- **Aborts:** the routing timeout (for research, `agentApi.research.timeout`) aborts the request, and research stops before its next call.

## Using it in your own server

Name it in configuration instead of `UAG_ENGINES`, with options that take precedence over the environment:

```js
const server = new UAGServer({
    engines: [{ name: 'local', type: 'openai', options: { baseURL: 'http://localhost:11434/v1', model: 'llama4:16x17b' } }],
});
```

License: MIT.
