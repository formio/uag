# Form.io Universal Agent Gateway (UAG)

The UAG is a server that sits in front of one [Form.io](https://form.io) project and lets AI agents work with its forms. It turns each form tagged `uag` into context a model can use, validates every value an agent sends with the form's own rules, and forwards every write to Form.io with the caller's own permissions.

Also published as [`@formio/uag`](https://www.npmjs.com/package/@formio/uag) on npm and listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=io.form/formio-uag) as `io.form/formio-uag`.

## What it enables

**Conversation to a validated submission.** An agent collects data through natural language and produces a deterministic, schema-valid Form.io submission — no bespoke parsing, and the form's own validation still applies.

**Agentic workflows.** Applications send submissions to the UAG instead of the Form.io project URL. The UAG forwards each one to Form.io, which saves it and runs the form's own actions, and an **Agent: Run task** action on the form runs one of its tasks before or after the save: review steps, enrichment, triage, and similar automation driven by a form submission. A task's results are saved as an update through the UAG, which can start the next task.

## Quick start

Against a Form.io Open Source server:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT=https://forms.example.com \
  -e ADMIN_KEY=your-admin-key \
  -e JWT_SECRET=your-jwt-secret \
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
  --restart unless-stopped \
  formio/uag
```

Docker Compose is the recommended path for anything beyond a single container. Working stacks — including one that runs the UAG alongside a Form.io OSS server — are in the repository's [`demo/`](https://github.com/formio/uag/tree/main/demo) folder: the whole [ai.form.io](https://ai.form.io) demo site, and [samples](https://github.com/formio/uag/tree/main/demo/samples) you can start from.

## Connecting an agent

The MCP endpoint is `http://<host>:<port>/mcp`, served over Streamable HTTP (default port `3200`).

A local client (your own server, or a script) exchanges `ADMIN_KEY` or `PROJECT_KEY` for a token at `/auth/token` with the `client_credentials` grant, which needs no other setting. Remote clients that connect in, such as claude.ai and Claude Desktop connectors, sign in through OAuth: they need the UAG public over HTTPS, `MCP_OAUTH=true` and `MONGO`, which needs a license that includes the UAG. Behind a reverse proxy, set `TRUST_PROXY` so the OAuth discovery documents name the public URL, or set `BASE_URL`.

Engine servers (`formio/uag-engines`) run their own MCP client and connect **outward** to the UAG for research, so the UAG does not need to be publicly reachable for them — only reachable from the engine server, such as over a private Docker network.

## Agent API and engines

Besides MCP, the UAG serves an HTTP Agent API for a form's tasks: `POST {form}/agent/extract`, `{form}/agent/decide` and `{form}/agent/generate`, under the form's URL on the UAG (for example `https://uag.example.com/supportrequest/agent/decide`), which read no stored submission, save nothing and take the same credentials as the form's submissions; and `GET /agent/capabilities` at the UAG's root, which lists the enabled engines. The operations, and the Run task action, need an engine; with none enabled the operations return `503`. The image bundles the official engines, and `UAG_ENGINES` names the ones to enable:

| Engine | What it does | Needs |
| --- | --- | --- |
| `jev` | Decides closed-set fields (radio, select, checkbox and similar) with a confidence, using TypeSafe Jev. | `TYPESAFE_API_KEY` |
| `claude` | Extracts and generates open values, researching with a task's read-only tools when it lists them. | `CLAUDE_API_KEY` |
| `openai` | Extracts and generates open values on OpenAI, or any OpenAI-compatible server (Ollama, vLLM, OpenRouter). With `UAG_ENGINE_<NAME>_KIND=decision`, decides closed-set fields on OpenAI's Decisions API. | `OPENAI_MODEL`, and `OPENAI_API_KEY` (sent only to OpenAI) or `OPENAI_BASE_URL` (with `UAG_ENGINE_<NAME>_API_KEY` when that server needs a key) |
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

The Agent API and Run task are Agentic Formflow, an Enterprise feature. A project on Form.io's hosted service runs it with real engines and no license. When you self-host, real engines need a license in `LICENSE_KEY` that includes the UAG (an online license with UAG servers, or an offline license with the `uag` option), wherever the project runs (`UAG_LICENSE` still works, but is deprecated). Conversation forms need no license, and run on Form.io Open Source: the MCP tools, and a form's chat (`{form}/agent/chat`, which `Formio.createChat` in `@formio/uag-js` embeds in a page) with any agent engine. The stub engines (`stub-decision`, `stub-agent`) run without one, for trying the API out. The [License documentation](https://github.com/formio/uag#license) covers when a hosted project still needs a license.

Callers send the signed-in user's Form.io token (`x-jwt-token`), a portal team member's remote token (`x-remote-token`) or a UAG bearer token, and Form.io's permissions apply; servers may send `x-token` / `x-admin-key` instead, which are refused from browsers. A form that sets `uagAnonymous: "true"` and lets Anonymous create submissions also answers visitors with no credential, within the anonymous rate limits. `jev` and `claude` send submission data to their provider's hosted API. Field properties, routing and the Run task action are covered in the [Agent API](https://github.com/formio/uag#agent-api) and [Agentic workflows](https://github.com/formio/uag#agentic-workflows) documentation.

## Configuration

| Variable | Description |
| --- | --- |
| `PROJECT` | **Required.** API endpoint of the Enterprise project or the OSS server. |
| `JWT_SECRET` | **Required.** Secret used to sign and validate the UAG's own JWTs, including the scoped tokens a `remote` engine's server uses to call `/mcp`. Set it to the Form.io Enterprise server's for a Run task action with an agent role to act on users' behalf. |
| `BASE_URL` | Optional. The URL clients reach the UAG at, for the OAuth discovery documents remote MCP clients read. Derived from each request when unset. |
| `TRUST_PROXY` | Express's `trust proxy` (`true`, a number of hops, or addresses). Set it behind a reverse proxy, so the UAG reads its public URL from the forwarded headers. |
| `MCP_OAUTH` | `true` turns on OAuth sign-in for remote MCP clients (the `/auth/authorize` page, client registration and `/.well-known/*`). Needs `MONGO`, with its license; otherwise the UAG starts with it off and says why. `/auth/token` (`client_credentials`) and API keys work without it. |
| `MONGO` | Optional. The UAG's own database, for run records, runs that survive a restart, remote MCP sign-in and the license grace period. Holds only `uag-*` collections, never submissions. Needs a license that includes the UAG, unless the project and the database are on development hosts. |
| `UAG_DATABASE` | The database to use on the `MONGO` connection, selected by name. Default `uag`. |
| `MONGO_CONFIG` | MongoDB driver options for `MONGO`, as JSON. |
| `TASK_RUN_RETENTION_DAYS` | Days run records are kept. Default `90`; `0` keeps them forever. |
| `PROJECT_KEY` | Enterprise only. Project API key, from **Project Settings → API Keys**. |
| `ADMIN_KEY` | Open Source only. Used instead of `PROJECT_KEY`. |
| `LICENSE_KEY` | The Form.io license. Required to run against a self-hosted Form.io Enterprise deployment; not needed for a project on Form.io's hosted service (`https://*.form.io`), which also runs Agentic Formflow without one. A license that includes the UAG enables Agentic Formflow (the Agent API, `{form}/agent/*`, the Run task action, `agent_decide` and `agent_provide`) with real engines, on Open Source too; without it these answer `403`, except against a hosted `PROJECT`, and the Agent API and Run task also run with only the stub engines. It also lets the UAG use its database (`MONGO`), on every edition. |
| `UAG_LICENSE` | Deprecated: use `LICENSE_KEY`. Still read until UAG 3.0; a feature is on when either license grants it. |
| `PORT` | Server port. Default `3200`. |
| `PROJECT_RETRIES` | Attempts to load the project (the first try included), for a Form.io server that is still starting. Also used for each refresh and for finding `remote` engines. Default `5`. |
| `PROJECT_RETRY_DELAY` | Milliseconds before the first retry; the delay doubles on each attempt, up to 60 seconds. Default `5000`. |
| `PROJECT_TTL` | Seconds between project refreshes. Default `900`; `0` disables refresh entirely. Values under 60 are not recommended — a refresh calls the project export API, which is expensive. |
| `TEMPLATE_SYNC` | When a module's template is installed into the project: `boot` at startup (default), `refresh` also on every `PROJECT_TTL` refresh, or `off` never. Only what the project is missing is installed. |
| `LOGIN_FORM` | URL of the login form JSON used by the browser login flow, so it must be reachable by that browser. Default `{PROJECT}/user/login`. |
| `JWT_EXPIRE_TIME` | Lifetime of the tokens the UAG issues, in minutes. Default `3600` (60 hours). |
| `PORTAL_SECRET` | Enterprise only. Lets a Form.io Enterprise portal stage connect to the UAG, where you add Run task actions to forms. |
| `CORS` | `true` (the default) allows every origin, `false` turns CORS off, and any other value is the one allowed origin, such as `https://app.example.com`. |
| `DEBUG` | Debug log filter, e.g. `formio.*`. |
| `UAG_ENGINES` | Comma-separated Agent API engine instances to enable, each `<type>` or `<name>:<type>`: `jev`, `claude`, `openai`, `grok`, `gemini`, `remote` (and `stub-decision` / `stub-agent` for testing). Unset enables none. |
| `UAG_ENGINE_<NAME>_<SETTING>` | One instance's setting, such as `UAG_ENGINE_FAST_MODEL`. For a `remote` instance, `_URL` (the engine server) and `_KEY` (its key, at least 32 characters). |
| `UAG_ENGINE_PATH` | Absolute directories with more engine packages installed, such as a mounted volume. |
| `AGENT_ANONYMOUS_RATE_LIMIT` | Anonymous Agent API requests allowed per client address a minute, on forms that set `uagAnonymous`. Default `10`; `0` turns anonymous use off. |
| `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT` | Anonymous Agent API requests allowed in total a minute. Default `100`; `0` turns anonymous use off. |
| `TYPESAFE_API_KEY` | Required for `jev`. |
| `TYPESAFE_MODEL` | Jev model version. Default `jev-1.13.0`; keep it pinned. |
| `TYPESAFE_BASE_URL` | TypeSafe API base URL. Default: the SDK's. |
| `CLAUDE_API_KEY` | Required for `claude` (`ANTHROPIC_API_KEY` also works). |
| `CLAUDE_MODEL` | Default `claude-opus-5-5`. |
| `CLAUDE_EFFORT` / `CLAUDE_RESEARCH_EFFORT` | Effort for extraction (default `low`) and for research with a task's read-only tools (default `medium`). |
| `CLAUDE_FALLBACKS` | `default` re-runs a refused request on a fallback model server-side; `off` disables that. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` only when `PROJECT` is an HTTPS URL with a self-signed or otherwise untrusted certificate, which is common for local and internal deployments. Never set it on a deployment reachable from outside your network — it disables certificate verification for all outbound requests. |

Treat every key, secret, and license as sensitive: supply them through an `.env` file or your platform's secret store rather than inline in a committed file.

## Caching behaviour worth knowing

Forms and resources are cached and refreshed on the `PROJECT_TTL` interval, so a change to a form can take up to that long to appear to an agent. Set `PROJECT_TTL=0` to disable refreshing entirely, in which case a restart is the only way to pick up changes.

## Links

- Source and full documentation: https://github.com/formio/uag
- Live demos of conversation forms, agentic workflows and Agentic Formflow: https://ai.form.io/examples (source: https://github.com/formio/uag/tree/main/demo)
- Engine server image, for running engines in their own container: https://hub.docker.com/r/formio/uag-engines
- MCP server for building and managing Form.io forms from a coding agent: https://hub.docker.com/r/formio/mcp
- Agentic Coding Plugin, so your coding agent can tag forms, deploy the UAG and wire applications to it: https://github.com/formio/ai (`npx skills add formio/ai`)
- License: MIT
