---
title: Deployment
description: Run the UAG with Docker, Compose or Node.js, configure it with the full environment variable reference, choose between Open Source, Enterprise and hosted Form.io, and pin a compatible set of images and packages.
section: Operate
order: 20
---

The UAG is a long-lived HTTP server you deploy next to a Form.io project. It is not a stdio MCP server that a client spawns: deploy it, then point clients at its URL. This page covers how to run it, every setting it reads, how editions and licensing apply, and how to keep a deployment reproducible.

## Ways to run it

| Runtime | Use when | Notes |
|---|---|---|
| **Docker image** `formio/uag` | Almost always | Includes the UAG and every official engine (`jev`, `claude`, `openai`, `grok`, `gemini`). Listens on `PORT` (default 3200). |
| **Docker Compose** | Running Form.io and the UAG together, or with an engine server | The samples are Compose stacks. |
| **`npx uag`** | A Node.js host without Docker | Install `@formio/uag` and the engine packages you need. Reads the same environment, plus `UAG_MODULE`. |
| **Embedded in Express** | Your own Node.js application hosts the UAG | `new UAGServer(config)`; see [Node.js API](/developers/node-api). |

Outside Docker, the UAG needs Node.js 22 or newer, and Node must run with `--no-node-snapshot` (the `uag` command adds it itself) because `isolated-vm`, which runs form logic, requires it.

### Docker

```bash
docker run -d --name formio-uag --restart unless-stopped -p 3200:3200 \
  -e PROJECT=https://forms.example.com \
  -e ADMIN_KEY=... \
  -e JWT_SECRET=... \
  -e BASE_URL=https://uag.example.com \
  -e LOGIN_FORM=https://forms.example.com/user/login \
  formio/uag
```

The image starts `node --no-node-snapshot index.js`, which loads the module in `/app/module`. Mount your own [module](/developers/modules) there to add forms, actions, tools and configuration:

```bash
docker run -v "$PWD/module:/app/module" ... formio/uag
```

### Docker Compose

A self-contained stack on Form.io Open Source is in the [Quickstart](/developers/quickstart#self-hosted-with-formio-open-source). Points that apply to every Compose deployment:

- `PROJECT` is a **container-to-container** address (`http://formio:3001`), not a browser URL.
- Hold the UAG back until Form.io answers (a `healthcheck` with `depends_on: condition: service_healthy`). The UAG also retries a project that is still starting (`PROJECT_RETRIES`, `PROJECT_RETRY_DELAY`) and exits if it never loads.
- The Form.io Open Source container listens on `3001`.

For an Enterprise server in the same stack:

```yaml
services:
  formio-enterprise:
    image: formio/formio-enterprise
    environment:
      PORT: 3000
      LICENSE_KEY: ${LICENSE_KEY}
      # ...database and secrets
  formio-uag:
    image: formio/uag
    depends_on:
      - formio-enterprise
    environment:
      PROJECT: http://formio-enterprise:3000/myproject
      PROJECT_KEY: ${PROJECT_KEY}
      # The same Form.io license, which must include the UAG.
      LICENSE_KEY: ${LICENSE_KEY}
      JWT_SECRET: ${JWT_SECRET}
      BASE_URL: https://uag.example.com
      LOGIN_FORM: https://forms.example.com/myproject/user/login
```

The project API key must exist before the UAG starts, which is why the [demo stack](https://github.com/formio/uag/tree/main/demo) starts Form.io, runs a setup job that creates the project and installs the key ([`server/setup.mjs`](https://github.com/formio/uag/blob/main/demo/server/setup.mjs)), and only then starts the UAG.

To run engines in their own container, see [Engine server](/developers/engine-server).

## The three URLs

Three settings name places, and confusing them causes most deployment problems. Whether any needs to be public depends on [how agents connect](/developers/mcp-tools#how-agents-connect).

| Setting | Who uses it | Must be reachable from |
|---|---|---|
| `PROJECT` | The UAG, to load the project and proxy submissions | The UAG container |
| `BASE_URL` | MCP clients, through the OAuth discovery documents and callbacks | Every client: public HTTPS when remote agents connect in, private otherwise |
| `LOGIN_FORM` | The user's browser, on the `/auth/authorize` login page | The browser doing the login |

### `PROJECT`

The Form.io deployment the UAG serves:

| Deployment | `PROJECT` | Credential |
|---|---|---|
| Open Source | The server's root, `http://formio:3001` or `https://forms.example.com` | `ADMIN_KEY` |
| Enterprise, self-hosted | The project endpoint, `http://formio-enterprise:3000/myproject` or `https://forms.example.com/myproject` | `PROJECT_KEY`, plus `LICENSE_KEY` |
| Hosted SaaS | `https://<project>.form.io` | `PROJECT_KEY` |

It does not need public DNS. If it is an `https` URL with a self-signed certificate, the UAG cannot connect until you set `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables certificate checks for every outbound request; do that only on deployments unreachable from outside your network.

### `BASE_URL`

The URL clients reach the UAG at. It is always required, even when nothing is public: the authentication provider is only enabled when it is set. Without it, `/mcp` answers `401` to everything, and `/auth/token` and `/.well-known/*` do not exist (`404`). A `404` on `/auth/token` is the clearest sign it is missing.

- **Remote agents connect in**: the public HTTPS URL, `https://uag.example.com`. The agent reads this value from the discovery documents and follows it, so it must be correct from the agent's side.
- **Local clients only**: the address they use, such as `http://localhost:3200` or `http://formio-uag:3200` on a Docker network.

### `LOGIN_FORM`

The login form JSON endpoint the `/auth/authorize` page loads, such as `https://forms.example.com/user/login` (Open Source) or `https://forms.example.com/myproject/user/login` (Enterprise). It defaults to `{PROJECT}/user/login`, which is usually a container address the browser cannot reach, so set it. Clients using `client_credentials` never load it. A login page that says it cannot load the form means this URL is wrong.

## Environment variables

### Connection and identity

| Variable | Default | Description |
|---|---|---|
| `PROJECT` | none, **required** | The Open Source server URL, or the Enterprise or hosted project endpoint. |
| `PROJECT_KEY` | none | Enterprise and hosted: the project API key (**Project Settings → API Keys**). Also accepted from callers as `x-token`. |
| `ADMIN_KEY` | none | Open Source: the server's admin key. Also accepted from callers as `x-admin-key`. |
| `JWT_SECRET` | random per start | **Required in practice.** Signs the UAG's own tokens. Unrelated to the Form.io server's secret. Set it, the same on every instance, or tokens break on restart. |
| `JWT_EXPIRE_TIME` | `3600` | Lifetime of the UAG's access tokens, in **minutes** (3600 is 60 hours). Refresh tokens last twice as long. |
| `BASE_URL` | none, **required** | The URL clients reach the UAG at. |
| `LOGIN_FORM` | `{PROJECT}/user/login` | The login form the browser loads at `/auth/authorize`. |
| `PORTAL_SECRET` | none | Enterprise: lets the Form.io Enterprise portal connect to the UAG. |
| `PORT` | `3200` | The port the UAG listens on. |

### Project sync

| Variable | Default | Description |
|---|---|---|
| `PROJECT_TTL` | `900` | Seconds between project refreshes. `0` disables them. Keep it at `60` or more outside development: each refresh calls the project's `/export`. |
| `TEMPLATE_SYNC` | `boot` | When a module's template is installed: `boot`, `refresh` (also on each TTL refresh) or `off`. Only what the project lacks is installed. Use `off` when stage deployments manage the project. |
| `PROJECT_RETRIES` | `5` | Attempts to load a project that is not answering yet, and to describe a remote engine at startup. |
| `PROJECT_RETRY_DELAY` | `5000` | Milliseconds before the first retry; doubles each time, up to 60 seconds. |

### Licensing

| Variable | Default | Description |
|---|---|---|
| `LICENSE_KEY` | none | The Form.io license. It must include the UAG (see [Licensing](#licensing)) for a self-hosted Enterprise project, and for Agentic Formflow outside a hosted SaaS project. Form.io Enterprise reads the same variable, so one license can serve both. |
| `UAG_LICENSE` | none | Deprecated, with a startup notice; it works until UAG 3.0. A second license, checked before `LICENSE_KEY`, which is used when it is missing, unusable, or does not include the UAG for the endpoint. |
| `LICENSE_REMOTE` | unset | `true` when the key is an offline (self-contained) license, so it is never sent to the license server. |
| `LICENSE_SERVER` | `https://license.form.io` | The license server that validates other keys. |

### Database, network and runtime

| Variable | Default | Description |
|---|---|---|
| `MONGO` | none | Enterprise: connect the UAG directly to the project's MongoDB instead of sending submissions through the Form.io API. Turns off the hosted SaaS exemption. |
| `MONGO_CONFIG` | none | JSON options for the MongoDB driver. |
| `CORS` | permissive | The allowed origin, or a JSON configuration for the `cors` module. Restrict it before exposing the UAG. |
| `MAX_BODY_SIZE` | `100mb` | Largest JSON request body the UAG accepts, on every route. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | unset | `0` to accept a self-signed `PROJECT` certificate. Never on a deployment reachable from outside. Turns off the hosted SaaS exemption. |
| `DEBUG` | unset | Debug logging, for example `formio.*` or `formio:uag*`. |
| `UAG_MODULE` | none | For the `uag` command only: a file or folder exporting a module. The Docker image loads `/app/module` instead. |

### Engines

None of these does anything until `UAG_ENGINES` names an engine. See [Engines](/developers/engines) for each engine's settings.

| Variable | Description |
|---|---|
| `UAG_ENGINES` | Comma-separated engine instances, each `<type>` or `<name>:<type>`: `jev`, `claude`, `openai`, `grok`, `gemini`, `remote`, `stub-decision`, `stub-agent`, or an installed engine package. Unset means no engines. `config.engines` overrides it. |
| `UAG_ENGINE_<NAME>_<SETTING>` | One instance's setting, for example `UAG_ENGINE_FAST_MODEL=claude-haiku-5-5`. Takes precedence over the type's own variables. |
| `UAG_ENGINE_PATH` | Absolute directories, separated by `:`, holding more engine packages (each with a `node_modules` folder). |
| `TYPESAFE_API_KEY`, `TYPESAFE_MODEL`, `TYPESAFE_BASE_URL` | The `jev` engine. Pin `TYPESAFE_MODEL` to a dated version, such as `jev-1.13.0`. |
| `CLAUDE_API_KEY` (or `ANTHROPIC_API_KEY`), `CLAUDE_MODEL`, `CLAUDE_EFFORT`, `CLAUDE_RESEARCH_EFFORT`, `CLAUDE_FALLBACKS` | The `claude` engine. `CLAUDE_MODEL` defaults to `claude-opus-5-5`; set it explicitly. |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_STRUCTURED_OUTPUT` | The `openai` engine, which also reaches OpenAI-compatible servers such as Ollama. `OPENAI_MODEL` has no default. |
| `XAI_API_KEY`, `XAI_MODEL` | The `grok` engine. No default model. |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GEMINI_MODEL` | The `gemini` engine. No default model. |
| `UAG_ENGINE_<NAME>_URL`, `UAG_ENGINE_<NAME>_KEY`, `UAG_ENGINE_<NAME>_ENGINE` | A `remote` instance: the engine server's URL, its key (32+ characters, the server's `UAG_ENGINE_SERVER_KEY`), and the engine's name there when it differs. |

A misconfigured engine (a type that is not installed, a duplicate name, a missing setting) stops startup with the instance named, rather than failing the first request.

## Editions

| | Open Source | Enterprise, self-hosted | Hosted SaaS |
|---|---|---|---|
| Form.io server | `formio/formio` | `formio/formio-enterprise` | `portal.form.io` |
| UAG credential | `ADMIN_KEY` | `PROJECT_KEY` | `PROJECT_KEY` |
| `client_credentials` id | `formio-oss-x-admin-key` | `<project>-x-token` | `<project>-x-token` |
| License for MCP and conversation forms | Not needed | Needed (includes the UAG) | Not needed |
| Agentic Formflow (Agent API, `agentDecide`) | Needs a license that includes the UAG | Needs a license that includes the UAG | Allowed |
| Webhooks can call `/agent/provide` | No: no custom headers or transform. Call it from your code. | Yes | Yes |
| Direct database (`MONGO`) | No | Yes | No |
| Form and submission revisions, stages | No | Yes | Yes |

The UAG prints its edition at startup, and whether Agentic Formflow will run:

```
[formio-uag] Enterprise edition. Agentic Formflow is enabled (licensed by LICENSE_KEY).
```

## Licensing

Running against a self-hosted Enterprise project and Agentic Formflow are licensed separately, and one license that includes the UAG covers both.

**A license that includes the UAG** is one of:

- **An online license**, validated with the Form.io license server like the Enterprise and PDF servers' licenses, whose key has the `uagServer` scope. The license allows a number of UAG servers, and each project endpoint a UAG serves counts as one; replicas of a UAG serving the same project count once. A UAG past that number is refused ("UAG server limit reached") and does not load its project. The Form.io portal lists the UAGs counted under UAG Servers.
- **An offline license** (`LICENSE_REMOTE=true`) with the `uag` option. It is issued for the project it serves, so it has no count.

**Which variable.** Put the license in `LICENSE_KEY`: Form.io Enterprise reads the same variable, so one Form.io license runs both. `UAG_LICENSE` still works, and is deprecated. With both set, a feature is on when either key grants it; `LICENSE_KEY` is only checked when `UAG_LICENSE` does not include the UAG for the endpoint, and the startup line names the key that licensed Agentic Formflow.

**Running against a self-hosted Enterprise project.** The project needs a license that includes the UAG, and the license's endpoint allowlist must include `PROJECT`'s host. Development endpoints need none: `localhost`, `*.localhost`, `lvh.me`, `*.lvh.me`, `*.local` and `file:` URLs, provided the database (if the UAG has one) is on one too. A project that fails the check does not load, and the UAG exits saying why ("Endpoint ... is not allowed for this license", for example). Trial licenses carry such allowlists, which is why the workflow sample names its Form.io service `api-server`.

**Agentic Formflow.** The Agent API, the `agentDecide` action, the `agent_decide` and `agent_provide` MCP tools and `uag-eval` need a license that includes the UAG for the project's endpoint (any license allows `localhost`), wherever the project runs. Without it they run only:

- against a project on Form.io's hosted SaaS (`reason: "hosted"`);
- with only the built-in stub engines (`reason: "stub-engines"`), which answer with placeholders, except `agent_decide` and `agent_provide`, which call no engine.

Conversation forms need no license: they run on Form.io Open Source with an unlicensed UAG.

Otherwise each Agentic Formflow request is refused with `403` and `code: "license_required"`. `GET /agent/capabilities` always answers with the current `edition` and `formflow.reason`.

**Hosted SaaS** projects need no license at all: they run under Form.io's own license, as the Enterprise edition. The exemption applies to `https` endpoints on `form.io` or its subdomains, and rests on the project's certificate, so it is off when anything weakens that proof (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, the `--use-system-ca` or `--use-openssl-ca` flags) or when the UAG has a database of its own (`MONGO`). The UAG also confirms with the server (`GET /formio-config`) that it is the hosted service. Leave `LICENSE_KEY` and `UAG_LICENSE` unset there: with a key set, the project must be on that key's endpoint allowlist, or it does not load.

**How keys are validated.** An offline license is verified locally; set `LICENSE_REMOTE=true` for those. Any other key is validated with the Form.io license server. If the license server cannot be reached, the terms it last confirmed (or, before it ever answered, a provisional license) are trusted for 12 hours from the start of the outage, across restarts; after that the licensed features turn off until it answers again. The UAG checks online licenses again on its own schedule, so a revoked license is noticed without a restart.

Contact [support@form.io](mailto:support@form.io) for a trial license.

## Form.io Enterprise benefits

Running against Form.io Enterprise (self-hosted or hosted) adds controls that matter when agents change your data and your forms change what agents do:

- **Form revisions.** Every form change is a revision, and each submission records the revision it was made against. Because agent behavior comes from the form, rolling back a bad criteria edit is reverting a revision; no model is retrained.
- **Submission revisions.** Every change to a submission is recorded with who made it. Together with the UAG's provenance in `metadata.uag`, an audit can follow a value from the engine that proposed it to the person who confirmed or changed it.
- **Stage versions and deployments.** Tag a version across all of a project's forms and deploy it between stages, so the set of forms (and therefore agent behaviors) in production is versioned as a whole. Set `TEMPLATE_SYNC=off` when stages manage the project, so a module template does not reinstall forms you removed.
- **Webhook headers and transforms**, which let Form.io webhooks start [workflows](/developers/workflows) directly.
- **A direct database connection** (`MONGO`) for self-hosted deployments.

## Image and version pinning

The UAG and each engine package are versioned independently from 2.0.0. Pick a compatible set:

| Package | Version | Compatible UAG | Notes |
|---|---|---|---|
| `@formio/uag` | 2.x | | The UAG. Docker image `formio/uag`. |
| `@formio/uag-sdk` | 2.x | >= 2.0.0 | Engine contract version 1, remote engine protocol version 1. |
| `@formio/uag-jev` | 2.x | >= 2.0.0 | Default model `jev-1.13.0`. |
| `@formio/uag-claude` | 2.x | >= 2.0.0 | The Claude engine. |
| `@formio/uag-openai` | 2.x | >= 2.0.0 | No default model. 2.1 adds the decision kind (OpenAI's Decisions API). |
| `@formio/uag-grok` | 2.x | >= 2.0.0 | Built on `@formio/uag-openai`. No default model. |
| `@formio/uag-gemini` | 2.x | >= 2.0.0 | Built on `@formio/uag-openai`. No default model. |
| `@formio/uag-engines` | 2.x | >= 2.0.0 | The engine server. Docker image `formio/uag-engines`. |
| `@formio/uag-renderer` | 0.1.x | >= 2.0.0 | Used from the repository's `renderer` folder; not published. |
| `@formio/uag-claude` | 1.3.x | >= 1.12.0 | The retired Claude integration, deprecated. Works against 2.0 as against 1.13. |
| `@formio/uag-claude` | 1.2.x | 1.10.0 – 1.11.x | The retired Claude integration. |

`@formio/uag-claude` 2.x is the Claude **engine**, which runs inside the UAG. The retired integration is 1.x and the `formio/uag-claude` image; pin `@formio/uag-claude@^1` if you install the integration from npm. It receives security fixes only.

For a reproducible deployment:

- **Pin image tags.** The samples reference images without a tag so they always pull the latest release. Production should pin `formio/uag:<version>` (and `formio/uag-engines:<version>`, `formio/formio-enterprise:<version>`).
- **Pin models.** Set `CLAUDE_MODEL`, `TYPESAFE_MODEL` and the other model variables to specific versions. A new UAG release may change an engine's default, and answers differ between models. Run [`uag-eval`](/developers/evaluation) before changing one.
- **Keep one copy of `@formio/appserver-core`.** When embedding the UAG, it and `@formio/appserver` must share one copy at 2.20.0 or later; the UAG refuses to start with two, and says how to deduplicate.
- **Roll back** by pinning the previous image. Stored submissions are unaffected; UAG 1.x ignores the `metadata.uag.generated` provenance that 2.0 adds. See [MIGRATING-2.0.md](https://github.com/formio/uag/blob/main/MIGRATING-2.0.md) when upgrading from 1.x.

### A smaller image

Each engine is its own npm package, and the UAG uses only those installed. For an image with fewer engines:

```dockerfile
FROM node:lts-alpine AS build
WORKDIR /app
# isolated-vm, which runs form logic, compiles on install.
RUN apk add --no-cache make python3 g++
RUN npm install --omit=dev @formio/uag @formio/uag-claude

FROM node:lts-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
# Optional: your module.
# COPY module ./module
# ENV UAG_MODULE=./module
ENV NODE_OPTIONS=--no-node-snapshot
ENTRYPOINT ["node_modules/.bin/uag"]
```

Naming an engine whose package is not installed stops startup with the package to install.

## Running more than one instance

The UAG holds no conversation state, and `/mcp` is stateless, so instances can sit behind a load balancer. Keep in mind:

- Set the same `JWT_SECRET` on every instance, so each accepts the others' tokens.
- Each instance keeps its own project cache and refreshes on its own `PROJECT_TTL` timer, so instances can briefly serve different versions of a form after a change.
- Rate-limit counters are per process: each instance has its own allowance.
- With `TEMPLATE_SYNC=boot`, every instance installs missing template items at startup. Installation only adds what is missing, but consider `off` and a single provisioning step for large fleets.

## Verifying a deployment

```bash
# The authentication provider is enabled (BASE_URL is set):
curl -s -o /dev/null -w '%{http_code}\n' https://uag.example.com/.well-known/oauth-authorization-server   # 200

# Edition, engines and license state (from a server, not a browser):
curl -s https://uag.example.com/agent/capabilities -H "x-token: $PROJECT_KEY"
```

The UAG's log shows the edition line and `Form.io UAG server running on port 3200` once it is serving. If it exits instead, the line before says why: no project could be loaded (check `PROJECT` and its credential), a license problem, or a misconfigured engine. See [Troubleshooting](/developers/troubleshooting).
