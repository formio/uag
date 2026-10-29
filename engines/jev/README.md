# @formio/uag-jev

<sub>[Form.io UAG](https://github.com/formio/uag/blob/main/README.md) &rsaquo; [Engines](https://github.com/formio/uag/blob/main/README.md#engines-and-routing) &rsaquo; this page</sub>

The TypeSafe **Jev** decision engine for the [UAG Agent API](https://github.com/formio/uag/blob/main/README.md#agent-api). It answers a task's closed-set fields (radio, select, checkbox, select boxes, survey and small resource selects) in one request, typically in 70–500 ms, with a confidence for each answer.

It is included in the `formio/uag` Docker image. Enable it by naming it, and set its key:

```
UAG_ENGINES=jev
TYPESAFE_API_KEY=...
```

Decisions are Agentic Formflow, so the UAG also needs a `LICENSE_KEY` that includes the UAG (see [License](https://github.com/formio/uag/blob/main/README.md#license)).

## Settings

| Setting | Variables | Default |
|---|---|---|
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `TYPESAFE_API_KEY` | required (secret) |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `TYPESAFE_MODEL` | `jev-1.13.0` |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL`, `TYPESAFE_BASE_URL` | the SDK's default |

`<NAME>` is the instance name, upper-cased with `-` as `_`. An instance's own variable wins over the shared one.

The SDK's request timeout follows the instance's routing timeout (`routing.timeouts.<name>`, else `agentApi.timeout`, else 30 seconds; always 30 seconds on an engine server), so its retries of rate-limit and overload responses never outlast it. After the timeout, the UAG falls back to the next engine.

## Instances

Run a second Jev model next to the first, for example to compare a new version on live traffic before switching:

```
UAG_ENGINES=jev,next:jev
TYPESAFE_API_KEY=...
UAG_ENGINE_NEXT_MODEL=jev-1.14.0
```

Routing lists name the instances: `routing.decision: ["next", "jev"]`.

## Pin the model

Behavior differs between Jev versions. Keep `model` at a dated version, and run `uag-eval` on your own labeled examples before changing it or any threshold. `uag-eval --engine jev` works from a checkout of the UAG repository or inside the `formio/uag` image:

```
docker run --rm --entrypoint node -v "$PWD:/data" -e TYPESAFE_API_KEY -e LICENSE_KEY formio/uag \
  --no-node-snapshot bin/uag-eval.js --form /data/claim.json --examples /data/claim-examples.json \
  --engine jev --project <your project URL>
```

The license must allow that project URL.

## How it works

The UAG builds the questions and interprets the answers; this package only maps them to and from `@typesafe-ai/sdk`. Answers outside the options asked are dropped, and scores are kept within their levels. Jev's [confidence](https://docs.typesafe.ai/confidence) is already normalized against an even split, which is what the UAG's confidence threshold expects, so it is passed on unchanged.

**Errors:** a refused API key (401, 403), a rate limit (429) and a TypeSafe server failure (5xx) reach API callers as that, with no response body; any other failure is reported only as "the engine failed". Retries never wait longer than the request timeout for a `Retry-After`.

**Data residency:** Jev is a hosted service. Each request sends TypeSafe:
- the task's criteria and today's date;
- the values at its `uagContext` paths;
- its input fields, or, for a task with no input, the whole submission except the fields being decided.

Deployments that cannot send data there should not enable this engine; decision fields then fall back to an agent engine.

**Logging:** leave `TYPESAFE_LOG_LEVEL` unset (or `warn`) in production. At `debug`, the TypeSafe SDK writes each request and response body, which hold submission data, to the console.

## Using it in your own server

Name it in configuration instead of `UAG_ENGINES`, with options that take precedence over the environment:

```js
const server = new UAGServer({ engines: [{ name: 'jev', type: 'jev', options: { model: 'jev-1.13.0' } }] });
```

License: MIT.
