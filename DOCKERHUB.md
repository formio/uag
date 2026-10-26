# Form.io Universal Agent Gateway (UAG)

The UAG uses the [Model Context Protocol](https://modelcontextprotocol.io) to let AI agents work with [Form.io](https://form.io) forms, resources, and workflows. It converts a Form JSON schema into an AI-readable markdown description — giving an agent the same understanding of a form that the JavaScript renderer gives a human — then validates and submits the result against the same rules the renderer enforces.

Also published as [`@formio/uag`](https://www.npmjs.com/package/@formio/uag) on npm and listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.form/formio-uag) as `io.form/formio-uag`.

## What it enables

**Conversation to a validated submission.** An agent collects data through natural language and produces a deterministic, schema-valid Form.io submission — no bespoke parsing, and the form's own validation still applies.

**Agentic workflows.** An agent reads existing submission data plus your criteria, then contributes its own data and analysis back into the record — review steps, enrichment, triage, and similar automation driven by a form submission.

## Quick start

Against a Form.io Open Source server:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT=https://forms.example.com \
  -e ADMIN_KEY=your-admin-key \
  -e JWT_SECRET=your-jwt-secret \
  -e BASE_URL=https://uag.example.com \
  -e LOGIN_FORM=https://forms.example.com/user/login \
  --restart unless-stopped \
  formio/uag
```

Against a self-hosted Form.io Enterprise project, use `PROJECT_KEY` and `LICENSE_KEY` in place of `ADMIN_KEY`. A project on Form.io's hosted service (`PROJECT=https://myproject.form.io`) needs only `PROJECT_KEY`:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT=https://forms.example.com/myproject \
  -e PROJECT_KEY=your-project-api-key \
  -e LICENSE_KEY=your-license \
  -e JWT_SECRET=your-jwt-secret \
  -e BASE_URL=https://uag.example.com \
  --restart unless-stopped \
  formio/uag
```

Docker Compose is the recommended path for anything beyond a single container. Working stacks — including one that runs the UAG alongside a Form.io OSS server — are in the repository's [`demo/`](https://github.com/formio/uag/tree/main/demo) folder: the whole [ai.onform.io](https://ai.onform.io) demo site, and [samples](https://github.com/formio/uag/tree/main/demo/samples) you can start from.

## Connecting an agent

The MCP endpoint is `http://<host>:<port>/mcp`, served over Streamable HTTP (default port `3200`).

Engine servers (`formio/uag-engines`) run their own MCP client and connect **outward** to the UAG for research, so the UAG does not need to be publicly reachable for them — only reachable from the engine server, such as over a private Docker network.

## Agent API and engines

Besides MCP, the UAG serves an HTTP Agent API for a form's tasks: `POST /agent/extract`, `/agent/decide` and `/agent/generate`, which save nothing, `/agent/provide`, which fills a task in on a saved submission for webhooks, and `GET /agent/capabilities`, which lists the enabled engines. The operations need an engine; with none enabled they return `503`. The image bundles the official engines, and `UAG_ENGINES` names the ones to enable:

| Engine | What it does | Needs |
| --- | --- | --- |
| `jev` | Decides closed-set fields (radio, select, checkbox and similar) with a confidence, using TypeSafe Jev. | `TYPESAFE_API_KEY` |
| `claude` | Extracts and generates open values, researching with a task's read-only tools when it lists them. | `CLAUDE_API_KEY` |
| `openai` | Extracts and generates open values on OpenAI, or any OpenAI-compatible server (Ollama, vLLM, OpenRouter). With `UAG_ENGINE_<NAME>_KIND=decision`, decides closed-set fields on OpenAI's Decisions API. | `OPENAI_MODEL`, and `OPENAI_API_KEY` or `OPENAI_BASE_URL` |
| `grok` | Extracts and generates open values with xAI's Grok models. | `XAI_API_KEY`, `XAI_MODEL` |
| `gemini` | Extracts and generates open values with Google's Gemini models. | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| `remote` | An engine hosted by an engine server (`formio/uag-engines`), so the model's API key stays in that container. | `UAG_ENGINE_<NAME>_URL`, `UAG_ENGINE_<NAME>_KEY`, and `JWT_SECRET` for research |

With the quick-start settings in an `uag.env` file:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  --env-file uag.env \
  -e UAG_ENGINES=jev,claude \
  -e TYPESAFE_API_KEY=your-typesafe-key \
  -e CLAUDE_API_KEY=your-claude-key \
  -e LICENSE_KEY=your-license \
  formio/uag
```

The Agent API is Agentic Formflow, an Enterprise feature. A project on Form.io's hosted service runs it with real engines and no license. When you self-host, real engines need a license in `LICENSE_KEY` that includes the UAG (an online license with UAG servers, or an offline license with the `uag` option), wherever the project runs (`UAG_LICENSE` still works, but is deprecated). Conversation forms need no license, and run on Form.io Open Source. The stub engines (`stub-decision`, `stub-agent`) run without one, for trying the API out. The [License documentation](https://github.com/formio/uag#license) covers when a hosted project still needs a license.

Callers send a UAG bearer token (the user's Form.io permissions apply), or `x-token` / `x-admin-key` for webhooks and servers; admin credentials are refused from browsers. `jev` and `claude` send submission data to their provider's hosted API. Field properties, routing and the `agentDecide` action are covered in the [Agent API documentation](https://github.com/formio/uag#agent-api).

## Configuration

| Variable | Description |
| --- | --- |
| `PROJECT` | **Required.** API endpoint of the Enterprise project or the OSS server. |
| `JWT_SECRET` | **Required.** Secret used to sign and validate the UAG's own JWTs, including the scoped tokens a `remote` engine's server uses to call `/mcp`. Need not match the Form.io server's. |
| `BASE_URL` | **Required.** The URL clients reach the UAG at. Published in the `.well-known` OIDC (PKCE) definitions and used for auth callbacks. Must be public when remote agents connect in; a private or localhost URL is fine for a local MCP client. |
| `PROJECT_KEY` | Enterprise only. Project API key, from **Project Settings → API Keys**. |
| `ADMIN_KEY` | Open Source only. Used instead of `PROJECT_KEY`. |
| `LICENSE_KEY` | The Form.io license. Required to run against a self-hosted Form.io Enterprise deployment; not needed for a project on Form.io's hosted service (`https://*.form.io`), which also runs Agentic Formflow without one. A license that includes the UAG enables Agentic Formflow (the `/agent/*` API, the `agentDecide` action and `agent_decide`) with real engines; without it these answer `403`, except against a hosted `PROJECT`, a `PROJECT` on the UAG's own machine, or with only the stub engines. |
| `UAG_LICENSE` | Deprecated: use `LICENSE_KEY`. Still read until UAG 3.0; a feature is on when either license grants it. |
| `PORT` | Server port. Default `3200`. |
| `PROJECT_RETRIES` | Times to retry loading the project at startup, for a Form.io server that is still starting. Default `5`. |
| `PROJECT_RETRY_DELAY` | Milliseconds before the first retry; each retry waits longer. Default `5000`. |
| `PROJECT_TTL` | Seconds between project refreshes. Default `900`; `0` disables refresh entirely. Values under 60 are not recommended — a refresh calls the project export API, which is expensive. |
| `TEMPLATE_SYNC` | When a module's template is installed into the project: `boot` at startup (default), `refresh` also on every `PROJECT_TTL` refresh, or `off` never. Only what the project is missing is installed. |
| `LOGIN_FORM` | URL of the login form JSON used by the browser login flow, so it must be reachable by that browser. |
| `JWT_EXPIRE_TIME` | Lifetime of the tokens the UAG issues, in minutes. Default `3600` (60 hours). |
| `PORTAL_SECRET` | Enterprise only. Allows connecting from the Form.io Enterprise Portal. |
| `MONGO` / `MONGO_CONFIG` | Enterprise only. Connect directly to MongoDB instead of routing submissions through the Form.io submission APIs. |
| `CORS` | CORS domain, or JSON configuration for the `cors` module. |
| `DEBUG` | Debug log filter, e.g. `formio.*`. |
| `UAG_ENGINES` | Comma-separated Agent API engine instances to enable, each `<type>` or `<name>:<type>`: `jev`, `claude`, `openai`, `remote` (and `stub-decision` / `stub-agent` for testing). Unset enables none. |
| `UAG_ENGINE_<NAME>_<SETTING>` | One instance's setting, such as `UAG_ENGINE_FAST_MODEL`. For a `remote` instance, `_URL` (the engine server) and `_KEY` (its key, at least 32 characters). |
| `UAG_ENGINE_PATH` | Absolute directories with more engine packages installed, such as a mounted volume. |
| `TYPESAFE_API_KEY` | Required for `jev`. |
| `TYPESAFE_MODEL` | Jev model version. Default `jev-1.13.0`; keep it pinned. |
| `TYPESAFE_BASE_URL` | TypeSafe API base URL. Default: the SDK's. |
| `CLAUDE_API_KEY` | Required for `claude` (`ANTHROPIC_API_KEY` also works). |
| `CLAUDE_MODEL` | Default `claude-opus-5-5`. |
| `CLAUDE_EFFORT` / `CLAUDE_RUN_EFFORT` | Effort for extraction (default `low`) and for tool-use tasks (default `medium`). |
| `CLAUDE_FALLBACKS` | `default` re-runs a refused request on a fallback model server-side; `off` disables that. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` only when `PROJECT` is an HTTPS URL with a self-signed or otherwise untrusted certificate, which is common for local and internal deployments. Never set it on a deployment reachable from outside your network — it disables certificate verification for all outbound requests. |

Treat every key, secret, and license as sensitive: supply them through an `.env` file or your platform's secret store rather than inline in a committed file.

## Caching behaviour worth knowing

Forms and resources are cached and refreshed on the `PROJECT_TTL` interval, so a change to a form can take up to that long to appear to an agent. Set `PROJECT_TTL=0` to disable refreshing entirely, in which case a restart is the only way to pick up changes.

## Links

- Source and full documentation: https://github.com/formio/uag
- Live demos of conversation forms, agentic workflows and Agentic Formflow: https://ai.onform.io/examples (source: https://github.com/formio/uag/tree/main/demo)
- Engine server image, for running engines in their own container: https://hub.docker.com/r/formio/uag-engines
- MCP server for building and managing Form.io forms from a coding agent: https://hub.docker.com/r/formio/mcp
- License: MIT
