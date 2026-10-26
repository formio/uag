# @formio/uag-mai

<sub>[Form.io UAG](../../README.md) &rsaquo; [Engines](../../README.md#engines-and-routing) &rsaquo; this page</sub>

The **MAI** agent engine for the [UAG Agent API](../../README.md#agent-api): Microsoft's MAI models (MAI-Thinking-1) on [Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-mai-thinking). It extracts and generates open values (dates, amounts, names, free text). When a task lists read-only tools in `uagTools`, it researches with them first.

> **Not released.** MAI-Thinking-1 is in preview on Microsoft Foundry, without a service-level agreement, so this engine is not published to npm or included in the Docker images yet. It is kept here, tested, for when MAI is generally available.

To try it from a checkout of this repository, deploy MAI-Thinking-1 in your Foundry project, then enable the engine with the resource endpoint, its key and the deployment name:

```
UAG_ENGINES=mai
MAI_ENDPOINT=https://<resource-name>.services.ai.azure.com
MAI_API_KEY=...
MAI_DEPLOYMENT=<your deployment name>
```

Its tasks are Agentic Formflow, so the UAG also needs a `UAG_LICENSE` with the `uag` feature (see [License](../../README.md#license)).

## Settings

| Setting | Variables | Default |
|---|---|---|
| `endpoint` | `UAG_ENGINE_<NAME>_ENDPOINT`, `MAI_ENDPOINT` | required, unless `baseURL` is set |
| `apiKey` | `UAG_ENGINE_<NAME>_API_KEY`, `MAI_API_KEY` | required (secret); sent in an `api-key` header |
| `model` | `UAG_ENGINE_<NAME>_MODEL`, `MAI_DEPLOYMENT` | required: the deployment name, which Foundry uses as the model |
| `baseURL` | `UAG_ENGINE_<NAME>_BASE_URL` | `<endpoint>/mai/v1` |
| `structuredOutput` | `UAG_ENGINE_<NAME>_STRUCTURED_OUTPUT` | `prompt`: Foundry documents no JSON response format for MAI |

`<NAME>` is the instance name, upper-cased with `-` as `_`. An instance's own variable wins over the shared one.

Authentication is by API key. Microsoft Entra ID is not supported yet.

## How it works

It is the [OpenAI engine](../openai)'s agent kind, pointed at your Foundry resource's MAI endpoint. Each extraction asks for one JSON object matching the fields' schema, given in the prompt, and reads it from the answer; for a task that researches, a function-calling loop over its read-only tools comes first. A refusal, a content-safety block, a truncated answer or an answer that is not JSON is an engine failure, and the UAG falls back to the next engine. It never sends `max_tokens`, which MAI refuses.

MAI has no decision API, so this is an agent engine only. Decision fields routed to it are answered as extraction and reported `calibrated: false`.

**Data residency:** requests go to your own Foundry resource, in the region you deployed to. Each sends the task's criteria, its input (or, without an input, the whole submission except the fields being answered), its `uagContext` values and today's date, and, for a task that researches, what its tools return.

## Using it in your own server

```js
const server = new UAGServer({
    engines: [{ name: 'mai', type: 'mai', options: { endpoint: 'https://contoso.services.ai.azure.com', model: 'mai-thinking' } }],
});
```

License: MIT.
