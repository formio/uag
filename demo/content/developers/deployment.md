---
title: Deployment
description: Run the UAG with Docker, Compose or Node.js, configure it with the full environment variable reference, choose between Open Source, Enterprise and hosted Form.io, and pin a compatible set of images and packages.
section: Operate
order: 20
---

The UAG is a long-lived HTTP server you deploy next to a Form.io project. It is not a stdio MCP server that a client spawns: deploy it, then point clients at its URL. This page covers how to run it, every setting it reads, how editions and licensing apply, and how to keep a deployment reproducible.

> **Tip:** The [Agentic Coding Plugin](/developers/agentic-coding)'s `formio-uag` skill writes a Compose stack or Kubernetes manifest and an `.env.example` for your edition, with every secret left as a placeholder for your secret store.

## Ways to run it

| Runtime | Use when | Notes |
|---|---|---|
| **Docker image** `formio/uag` | Almost always | Includes the UAG and every official engine (`jev`, `claude`, `openai`, `grok`, `gemini`). Listens on `PORT` (default 3200). |
| **Docker Compose** | Running Form.io and the UAG together, or with an engine server | The samples are Compose stacks. |
| **`npx uag`** | A Node.js host without Docker | Install `@formio/uag@rc` and the engine packages you need. Reads the same environment, plus `UAG_MODULE`. |
| **Embedded in Express** | Your own Node.js application hosts the UAG | `new UAGServer(config)`; see [Node.js API](/developers/node-api). |

Outside Docker, the UAG needs Node.js 22 or newer, and Node must run with `--no-node-snapshot` (the `uag` command adds it itself) because `isolated-vm`, which runs form logic, requires it.

### Docker

```bash
docker run -d --name formio-uag --restart unless-stopped -p 3200:3200 \
  -e PROJECT=https://forms.example.com \
  -e ADMIN_KEY=... \
  -e JWT_SECRET=... \
  formio/uag:rc
```

The image starts `node --no-node-snapshot index.js`, which loads the module in `/app/module`. Mount your own [module](/developers/modules) there to add forms, actions, tools and configuration:

```bash
docker run -v "$PWD/module:/app/module" ... formio/uag:rc
```

### Docker Compose

A self-contained stack on Form.io Open Source is in the [Quickstart](/developers/quickstart#self-hosted-with-formio-open-source). Points that apply to every Compose deployment:

- `PROJECT` is a **container-to-container** address (`http://formio:3001`), not a browser URL.
- Hold the UAG back until Form.io answers (a `healthcheck` with `depends_on: condition: service_healthy`). The UAG also retries a project that is still starting (`PROJECT_RETRIES`, `PROJECT_RETRY_DELAY`) and exits if it never loads.
- The Form.io Open Source container listens on `3001`.

For an Enterprise server in the same stack:

```yaml
services:
  # Name the service to match your license's endpoint allowlist (trial licenses: api-server).
  api-server:
    image: formio/formio-enterprise
    environment:
      PORT: 3000
      LICENSE_KEY: ${LICENSE_KEY}
      # ...database and secrets
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 5s
      retries: 60
  formio-uag:
    image: formio/uag:rc
    depends_on:
      api-server: { condition: service_healthy }
    environment:
      PROJECT: http://api-server:3000/myproject
      PROJECT_KEY: ${PROJECT_KEY}
      # The same Form.io license, which must include the UAG.
      LICENSE_KEY: ${LICENSE_KEY}
      # The Form.io server's own JWT_SECRET, so an agent role can act on users' behalf.
      JWT_SECRET: ${JWT_SECRET}
```

The project API key must exist before the UAG starts, which is why the [demo stack](https://github.com/formio/uag/tree/v2.0.0-rc.5/demo), self-hosted (`docker-compose.enterprise.yml`), starts Form.io, runs a setup job that creates the project and installs the key ([`server/setup.mjs`](https://github.com/formio/uag/blob/v2.0.0-rc.5/demo/server/setup.mjs)), and only then starts the UAG.

To run engines in their own container, see [Engine server](/developers/engine-server).

## The three URLs

Three settings name places, and confusing them causes most deployment problems. Whether any needs to be public depends on [how agents connect](/developers/mcp-tools#how-agents-connect).

| Setting | Who uses it | Must be reachable from |
|---|---|---|
| `PROJECT` | The UAG, to load the project and proxy submissions | The UAG container |
| `BASE_URL` (optional) | Remote MCP clients, through the OAuth discovery documents (`MCP_OAUTH`) | Remote MCP clients: public HTTPS |
| `LOGIN_FORM` | The user's browser, on the `/auth/authorize` login page (`MCP_OAUTH` only) | The browser doing the login |

### `PROJECT`

The Form.io deployment the UAG serves:

| Deployment | `PROJECT` | Credential |
|---|---|---|
| Open Source | The server's root, `http://formio:3001` or `https://forms.example.com` | `ADMIN_KEY` |
| Enterprise, self-hosted | The project endpoint, `http://api-server:3000/myproject` or `https://forms.example.com/myproject` | `PROJECT_KEY`, plus `LICENSE_KEY` |
| Hosted SaaS | `https://<project>.form.io` | `PROJECT_KEY` |

It does not need public DNS. If it is an `https` URL with a self-signed certificate, the UAG cannot connect until you set `NODE_TLS_REJECT_UNAUTHORIZED=0`, which disables certificate checks for every outbound request; do that only on deployments unreachable from outside your network.

### `BASE_URL`

Optional. The URL clients reach the UAG at, which the UAG needs only for the OAuth discovery documents that remote MCP clients read (`MCP_OAUTH`). Without it, the UAG derives the URL from each request: from the `Host` header, or, when `TRUST_PROXY` is set, from the reverse proxy's `X-Forwarded-Proto` and `X-Forwarded-Host`.

Set it only when the derived URL is wrong: a proxy that rewrites the host, or one you do not trust. Remote agents read this URL from the discovery documents and follow it, so it must be correct from their side: `https://uag.example.com`.

### `LOGIN_FORM`

The login form JSON endpoint the `/auth/authorize` page loads, such as `https://forms.example.com/user/login` (Open Source) or `https://forms.example.com/myproject/user/login` (Enterprise). The page exists only with OAuth sign-in for remote MCP clients on (`MCP_OAUTH`). It defaults to `{PROJECT}/user/login`, which is usually a container address the browser cannot reach, so set it when you turn sign-in on. Clients using `client_credentials` never load it. A login page that says it cannot load the form means this URL is wrong.

## Environment variables

### Connection and identity

| Variable | Default | Description |
|---|---|---|
| `PROJECT` | none, **required** | The Open Source server URL, or the Enterprise or hosted project endpoint. |
| `PROJECT_KEY` | none | Enterprise and hosted: the project API key (**Project Settings → API Keys**). Also accepted from callers as `x-token`. |
| `ADMIN_KEY` | none | Open Source: the server's admin key. Also accepted from callers as `x-admin-key`. |
| `JWT_SECRET` | random per start, with a warning | **Required in practice.** Signs the UAG's own tokens. Set it to the Form.io Enterprise server's `JWT_SECRET` for an agent to act on users' behalf (see [Project setup for agents](/developers/project-setup)). Set it the same on every instance, or tokens break on restart. |
| `JWT_EXPIRE_TIME` | `60` | Lifetime of the UAG's access tokens, in **minutes**. A token from OAuth sign-in ends with the user's Form.io login token if that is sooner, and its refresh token cannot outlive it either. `client_credentials` returns no refresh token. |
| `BASE_URL` | derived from each request | The URL clients reach the UAG at, for the OAuth discovery documents. Set it only when the derived URL is wrong. |
| `TRUST_PROXY` | unset | Express's `trust proxy`: `true`, a number of proxy hops, or addresses (`loopback, 10.0.0.0/8`). Set it behind a reverse proxy, so the UAG reads its public URL and callers' addresses from the forwarded headers. Read by the `uag` command and the Docker image; an application that embeds the UAG calls `app.set('trust proxy', ...)` itself. |
| `MCP_OAUTH` | `false` | `true` turns on OAuth sign-in for remote MCP clients (claude.ai and Claude Desktop connectors): the browser sign-in page, client registration and the discovery documents. Needs the UAG's database (`MONGO`), and a license to use it. Local clients use `/auth/token`, which is always on. |
| `AGENT_ANONYMOUS_RATE_LIMIT` | `10` | Requests a minute one client address may make to the agent operations of forms that allow anonymous use ([`uagAnonymous`](/developers/form-properties#uaganonymous)). Counted by each UAG process; behind a reverse proxy, set `TRUST_PROXY` so the address is the visitor's. `0` turns anonymous use off. |
| `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT` | `100` | Requests a minute from all anonymous visitors together, per UAG process: with several replicas, the total is replicas × this. `0` turns anonymous use off. |
| `LOGIN_FORM` | `{PROJECT}/user/login` | The login form the browser loads at `/auth/authorize`. |
| `PORTAL_SECRET` | none | Enterprise: lets a Form.io Enterprise portal stage connect to the UAG. See [Connecting the Enterprise portal](#connecting-the-enterprise-portal). |
| `PORT` | `3200` | The port the UAG listens on. Read by the `uag` command and the Docker image; an application that embeds the UAG chooses its own port. |

### Project sync

| Variable | Default | Description |
|---|---|---|
| `PROJECT_TTL` | `900` | Seconds between project refreshes. `0` disables them. Keep it at `60` or more outside development: each refresh calls the project's `/export`. |
| `TEMPLATE_SYNC` | `boot` | When a module's template is installed: `boot`, `refresh` (also on each TTL refresh) or `off`. Only what the project lacks is installed. Use `off` when stage deployments manage the project. |
| `PROJECT_RETRIES` | `5` | Attempts to load a project that is not answering yet, and to describe a remote engine at startup. |
| `PROJECT_RETRY_DELAY` | `5000` | Milliseconds before the first retry; doubles each time, up to 60 seconds. |

### License settings

| Variable | Default | Description |
|---|---|---|
| `LICENSE_KEY` | none | The Form.io license. It must include the UAG (see [Licensing](#licensing)) for a self-hosted Enterprise project, and for Agentic Formflow outside a hosted SaaS project. Form.io Enterprise reads the same variable, so one license can serve both. |
| `UAG_LICENSE` | none | Deprecated, with a startup notice; it works until UAG 3.0. A second license, checked before `LICENSE_KEY`, which is used when it is missing, unusable, or does not include the UAG for the endpoint. |
| `LICENSE_REMOTE` | unset | `true` when the key is an offline (self-contained) license, so it is never sent to the license server. |
| `LICENSE_SERVER` | `https://license.form.io` | The license server that validates other keys. |

### Database, network and runtime

| Variable | Default | Description |
|---|---|---|
| `MONGO` | none | The UAG's own database: run records for Action Logs, runs that survive a restart, remote MCP sign-in, and the license grace period. It holds only `uag-*` collections, never submissions, which stay in Form.io. Needs a license that includes the UAG, unless the project and the database are both on development hosts; without one, the UAG starts with these features off and says so. |
| `UAG_DATABASE` | `uag` | The database the UAG uses on the `MONGO` connection, selected by name, so `MONGO` can be the connection string Form.io uses. A database of its own is recommended. |
| `MONGO_CONFIG` | none | JSON options for the MongoDB driver. |
| `TASK_RUN_RETENTION_DAYS` | `90` | Days a run record is kept. `0` keeps records forever. |
| `CORS` | `true` | `true` allows every origin, `false` turns CORS off, and any other value is the allowed origin, or several separated by commas (`https://app.example.com,https://admin.example.com`). Restrict it before exposing the UAG. |
| `MAX_BODY_SIZE` | `16mb` | Largest JSON request body the UAG accepts, the same as Form.io's. Bodies are parsed before authentication, so raise it only as far as the forms need. A form's agent operations take at most 5 MB whatever it is set to. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | unset | `0` to accept a self-signed `PROJECT` certificate. Never on a deployment reachable from outside. Turns off the hosted SaaS exemption. |
| `DEBUG` | unset | Debug logging, for example `formio:*` or `formio:uag*`. |
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
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_STRUCTURED_OUTPUT` | The `openai` engine, which also reaches OpenAI-compatible servers such as Ollama. `OPENAI_MODEL` has no default. `OPENAI_API_KEY` is sent only to OpenAI itself; an instance with a `baseURL` elsewhere takes its key from `UAG_ENGINE_<NAME>_API_KEY`. |
| `XAI_API_KEY`, `XAI_MODEL` | The `grok` engine. No default model. |
| `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GEMINI_MODEL` | The `gemini` engine. No default model. |
| `UAG_ENGINE_<NAME>_URL`, `UAG_ENGINE_<NAME>_KEY`, `UAG_ENGINE_<NAME>_ENGINE` | A `remote` instance: the engine server's URL, its key (32+ characters, the server's `UAG_ENGINE_SERVER_KEY`), and the engine's name there when it differs. |

A misconfigured engine (a type that is not installed, a duplicate name, a missing setting) stops startup with the instance named, rather than failing the first request.

Which engine answers which work (`routing`), timeouts, rate limits, and the engines and bounds of a form's chat (`agentApi.chat`) are configuration, not variables: set them in a [module](/developers/modules)'s `config`. See [Routing](/developers/engines#routing) and [Chat settings](/developers/agent-api#chat-settings).

## Editions

| | Open Source | Enterprise, self-hosted | Hosted SaaS |
|---|---|---|---|
| Form.io server | `formio/formio` | `formio/formio-enterprise` | `portal.form.io` |
| UAG credential | `ADMIN_KEY` | `PROJECT_KEY` | `PROJECT_KEY` |
| `client_credentials` id | `formio-oss-x-admin-key` | `<project>-x-token` | `<project>-x-token` |
| License for MCP and conversation forms (the MCP tools, and a form's [chat](/developers/chat)) | Not needed | Needed (includes the UAG) | Not needed |
| Agentic Formflow (Agent API `extract`, `decide`, `generate`; "Agent: Run task") | Needs a license that includes the UAG | Needs a license that includes the UAG | Allowed |
| An agent role acting on users' behalf | No | Yes (shared `JWT_SECRET`) | No |
| The UAG's database (`MONGO`) | With a license | With a license | With a license |
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

**Running against a self-hosted Enterprise project.** The project needs a license that includes the UAG, and the license's endpoint allowlist must include `PROJECT`'s host. Development endpoints need none: `localhost`, `*.localhost`, `lvh.me`, `*.lvh.me`, `*.local` and `file:` URLs. A project that fails the check does not load, and the UAG exits saying why ("Endpoint ... is not allowed for this license", for example). Trial licenses carry such allowlists, which is why the demo stack's self-hosted overlay (`docker-compose.enterprise.yml`) names its Form.io service `api-server`.

**Agentic Formflow.** The Agent API's `extract`, `decide` and `generate`, the "Agent: Run task" action, the `agent_decide` and `agent_provide` MCP tools and `uag-eval` need a license that includes the UAG for the project's endpoint (any license allows `localhost`), wherever the project runs. Without it they run only:

- against a project on Form.io's hosted SaaS (`reason: "hosted"`);
- with only the built-in stub engines (`reason: "stub-engines"`), which answer with placeholders, except `agent_decide` and `agent_provide`, which call no engine.

Conversation forms need no license: the MCP tools and a form's [chat](/developers/chat) (`{form}/agent/chat`, which needs an agent engine) run on Form.io Open Source with an unlicensed UAG.

Otherwise each Agentic Formflow request is refused with `403` and `code: "license_required"`. A Run task action that runs before the save refuses the submission the same way, so nothing is saved; one that runs after the save fails in the background, and the failure is logged. `GET /agent/capabilities` always answers with the current `edition` and `formflow.reason`.

**The UAG's database** (`MONGO`) needs a license that includes the UAG on every edition, Form.io's hosted service included, unless the project and the database are both on development hosts. See [The database](#the-database).

**Hosted SaaS** projects need no license at all: they run under Form.io's own license, as the Enterprise edition. The exemption applies to `https` endpoints on `form.io` or its subdomains, and rests on the project's certificate, so it is off when anything weakens that proof (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`, the `--use-system-ca` or `--use-openssl-ca` flags). The UAG also confirms with the server (`GET /formio-config`) that it is the hosted service. Leave `LICENSE_KEY` and `UAG_LICENSE` unset there unless the UAG has a database of its own, which needs one: with a key set, the project must be on that key's endpoint allowlist, or it does not load.

**How keys are validated.** An offline license is verified locally; set `LICENSE_REMOTE=true` for those. Any other key is validated with the Form.io license server. If the license server cannot be reached and the UAG has its database, the terms it last confirmed (or, before it ever answered, a provisional license) are trusted for 12 hours from the start of the outage. The database records when the outage began, so a restart neither begins nor extends the 12 hours; after that the licensed features turn off until the server answers again. Without the database there is no grace period: the licensed features turn off as soon as the license server cannot confirm the license, and an Enterprise project does not load until it can. The UAG checks online licenses again on its own schedule, so a revoked license is noticed without a restart.

Contact [support@form.io](mailto:support@form.io) for a trial license.

## The database

The UAG needs no database to run: Form.io stores every submission, and the UAG forwards them. A database of the UAG's own is optional, and turns on four features:

| Feature | Without the database |
|---|---|
| Remote MCP sign-in (`MCP_OAUTH`), for claude.ai and Claude Desktop connectors and `mcp-remote` | Off. Local clients still use `/auth/token`. |
| Run records, shown as [Action Logs](#connecting-the-enterprise-portal) in a connected portal stage | No record of task runs. Failures are only logged. |
| Runs after the save that survive a restart (actions with an agent role) | Every run after the save is kept in memory, in the instance that received the submission, and is lost if it stops. |
| The license grace period | None: the licensed features turn off as soon as the license server cannot confirm the license. |

`GET /agent/capabilities` reports the first and third as `mcpOAuth` and `durableRuns`.

### Configuring it

```yaml
      MONGO: mongodb://mongo:27017        # can be the connection string Form.io uses
      UAG_DATABASE: uag                   # the default
      TASK_RUN_RETENTION_DAYS: 90         # the default; 0 keeps run records forever
```

The UAG selects `UAG_DATABASE` by name on the `MONGO` connection, so the database in the connection string (and its `authSource`) is left as it is. `MONGO_CONFIG` passes JSON options to the MongoDB driver. The `MONGO` user needs the `readWrite` role on that database; without it, startup stops and names the database.

**Sharing Form.io's MongoDB.** Point `MONGO` at the same server, or the same connection string, as Form.io, and keep `UAG_DATABASE` at `uag` or another name of its own. The UAG reads and writes only collections named `uag-*`, so it may share a database, but it warns at startup when its database holds other data, and a database of its own is recommended.

### What it holds

| Collection | Contents |
|---|---|
| `uag-meta` | The UAG's schema marker, and when the license server became unreachable. |
| `uag-authcodes` | One-time authorization codes for remote MCP sign-in, stored by their SHA-256 hash, with the token each is exchanged for sealed with a key only the code gives, so the database holds neither a usable code nor a usable token. Each expires after 10 minutes. |
| `uag-taskruns` | One record per Run task run: the form, submission, action, task, when it ran, its state, the engines and models that answered, the paths of the fields it wrote and cleared (never their values), any error, and the user it acted for (their id, roles and email). Never a token. Records are removed `TASK_RUN_RETENTION_DAYS` after they were created. |

It never holds submissions. The UAG no longer creates an "Authorization Codes" resource in the project, as earlier versions did; an existing one is unused and can be deleted.

### The signature check

At startup, before it writes anything, the UAG checks its database. It stops startup, licensed or not, and says why, when:

- it cannot connect to `MONGO`;
- the database holds `uag-*` collections the UAG did not create ("holds uag-* collections that the UAG did not create"); choose another `UAG_DATABASE`;
- the database was created by a newer UAG ("created by a newer UAG"); upgrade the UAG, or choose another database.

On a fresh database it writes its schema marker first, then creates its collections and indexes. A database created by an older UAG is brought up to date.

### The database's license

Using the database needs a license that includes the UAG, on Open Source, Enterprise and Form.io's hosted service alike, unless the project and the database are both on development hosts (`localhost`, `*.localhost`, `lvh.me`, `*.lvh.me`, `*.local`). The [custom module sample](https://github.com/formio/uag/tree/v2.0.0-rc.5/demo/samples/custom-module) names its services `formio.local` and `mongo.local` for that reason.

Without the license, the UAG still starts, with the database features off. It creates and changes nothing in the database, closes the connection, and says why:

```
[formio-uag] The database (MONGO) is not used: A database of this server's own (MONGO) needs a license that includes ... Runs after the save are kept in memory, and remote MCP sign-in (MCP_OAUTH) is off.
```

Until the license is known, the UAG only reads the database. The one exception is recording a license server outage for a configured license key.

### Runs after the save

An "Agent: Run task" action that runs after the save (see [Workflows](/developers/workflows)) runs in the background, after the submitter has Form.io's response. Where that run lives depends on the database and on the action's **Agent role** (see [Project setup for agents](/developers/project-setup)):

| | No database | Database, no agent role | Database and an agent role |
|---|---|---|---|
| Where the run is kept | In memory | In memory, because it acts with the caller's token, which is never stored | In `uag-taskruns`, recorded as pending before the submitter gets the response |
| Recorded for Action Logs | No | Yes | Yes |
| After a restart | Lost | Lost | Resumed |
| With several instances | Runs in the instance that received the submission | The same | Taken by one instance at a time |

A durable run is taken by one instance under a lease of 2 minutes, which that instance renews every 30 seconds while it runs. Each instance sweeps for pending runs, and for runs whose instance stopped renewing, at startup and every minute. A run that loses its instance 3 times is marked failed. A resumed run saves only what changed, so running it twice is harmless. Runs made before the save are recorded too, once Form.io has given the submission its id.

## Form.io Enterprise benefits

Running against Form.io Enterprise (self-hosted or hosted) adds controls that matter when agents change your data and your forms change what agents do:

- **Form revisions.** Every form change is a revision, and each submission records the revision it was made against. Because agent behavior comes from the form, rolling back a bad criteria edit is reverting a revision; no model is retrained.
- **Submission revisions.** Every change to a submission is recorded with who made it. Together with the UAG's provenance in `metadata.uag`, an audit can follow a value from the engine that proposed it to the person who confirmed or changed it.
- **Stage versions and deployments.** Tag a version across all of a project's forms and deploy it between stages, so the set of forms (and therefore agent behaviors) in production is versioned as a whole. Set `TEMPLATE_SYNC=off` when stages manage the project, so a module template does not reinstall forms you removed.
- **Agents that act on users' behalf** with a role of their own, so Form.io's permissions keep users off the fields agents own. See [Project setup for agents](/developers/project-setup).
- **Action Logs** in a stage connected to the UAG, with each task run beside Form.io's own entries (with the UAG's database; see below).

### Connecting the Enterprise portal

The UAG adds an action of its own, "Agent: Run task", which Form.io Enterprise does not know. On an ordinary stage the portal asks Form.io for an action's settings form, so Run task opens as a blank page (Form.io answers `400 Action not found`). Connect a stage of the project to the UAG instead, as an on-premise environment, and the portal asks the UAG:

1. Set `PORTAL_SECRET` on the UAG to a long random secret, and make the UAG reachable from the browser that runs the portal.
2. In the portal, create a stage (**Stage → Create Stage**, empty), then open **Staging → Connect to an On-Premise Environment**.
3. Enter the UAG's root URL and the same secret, choose **Subdirectories** as the project path type, and **Continue**.
4. Choose the UAG's project and **Connect Stage**.

In that stage, forms and actions are read and saved through the UAG, which passes them on to Form.io. Every member of the project's team can work there with their own permission: the owner and team admins as administrators, `team_write` members editing forms, roles, actions and submissions, and `team_read` members reading them. The UAG applies Form.io's team rules itself; see [Portal team members](/developers/security#portal-team-members). The UAG describes only its own actions: Run task opens with its **Task**, **Answer**, **When**, **Agent role** and **Submitter roles** settings. Every other action's settings form comes from Form.io, fetched with your own credential, so a webhook or email action is edited exactly as it would be on Form.io, conditions included.

**Action Logs.** With the UAG's database, the stage's Action Logs list Form.io's own entries and the UAG's run records together, newest first. Each run shows the action's title, the task, its state (new, in progress, complete or error), the fields it saved or the error, and the engines that answered. Form.io decides who may read Action Logs: the UAG asks Form.io with your credential before it shows them. This works in the classic portal, which asks the stage's URL for Action Logs. The new portal asks its own API server instead, so the UAG's records do not appear there.

## Image and version pinning

The UAG and each engine package are versioned independently from 2.0.0. Pick a compatible set:

| Package | Version | Compatible UAG | Notes |
|---|---|---|---|
| `@formio/uag` | 2.x | | The UAG. Docker image `formio/uag`. |
| `@formio/uag-sdk` | 2.x | >= 2.0.0 | Engine contract version 1, remote engine protocol version 1. |
| `@formio/uag-jev` | 2.x | >= 2.0.0 | Default model `jev-1.13.0`. |
| `@formio/uag-claude` | 2.x | >= 2.0.0 | The Claude engine. |
| `@formio/uag-openai` | 2.x | >= 2.0.0 | No default model. Its first release is 2.0.0, with the agent and decision kinds. |
| `@formio/uag-grok` | 2.x | >= 2.0.0 | Built on `@formio/uag-openai`. No default model. |
| `@formio/uag-gemini` | 2.x | >= 2.0.0 | Built on `@formio/uag-openai`. No default model. |
| `@formio/uag-engines` | 2.x | >= 2.0.0 | The engine server. Docker image `formio/uag-engines`. |
| `@formio/uag-js` | 2.x | >= 2.0.0 | The formio.js module, for the browser: saves `uag` forms through the UAG and adds Agent Input. Published on npm. |
| `@formio/uag-claude` | 1.3.x | 1.12.0 – 1.13.x | The retired Claude integration, deprecated. Against 2.0 only its direct commands work: its `agent_provide_data` webhooks need 1.x. |
| `@formio/uag-claude` | 1.2.x | 1.10.0 – 1.11.x | The retired Claude integration. |

`@formio/uag-claude` 2.x is the Claude **engine**, which runs inside the UAG. The retired integration is 1.x and the `formio/uag-claude` image; pin `@formio/uag-claude@^1` if you install the integration from npm. It receives security fixes only.

For a reproducible deployment:

- **Pin image tags.** The samples use the `rc` channel tag, which moves to each new release candidate. Production should pin `formio/uag:<version>` (and `formio/uag-engines:<version>`, `formio/formio-enterprise:<version>`).
- **Pin models.** Set `CLAUDE_MODEL`, `TYPESAFE_MODEL` and the other model variables to specific versions. A new UAG release may change an engine's default, and answers differ between models. Run [`uag-eval`](/developers/evaluation) before changing one.
- **Keep `@formio/appserver` current.** When embedding the UAG, it reaches `@formio/appserver-core` only through `@formio/appserver`, so there is one copy of it, which must be 2.25.2 or later; the UAG refuses to start with an older one, and says what to upgrade.
- **Roll back** by pinning the previous image. Stored submissions are unaffected; UAG 1.x ignores the `metadata.uag.generated` provenance that 2.0 adds. See [MIGRATING-2.0.md](https://github.com/formio/uag/blob/v2.0.0-rc.5/MIGRATING-2.0.md) when upgrading from 1.x.

### A smaller image

Each engine is its own npm package, and the UAG uses only those installed. For an image with fewer engines:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
# isolated-vm, which runs form logic, compiles on install.
RUN apk add --no-cache make python3 g++
RUN npm install --omit=dev @formio/uag@rc @formio/uag-claude@rc

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
# Optional: your module.
# COPY module ./module
# ENV UAG_MODULE=./module
ENV NODE_OPTIONS=--no-node-snapshot
# The same health check as the formio/uag image.
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node_modules/.bin/uag"]
```

Naming an engine whose package is not installed stops startup with the package to install.

## Running more than one instance

The UAG holds no conversation state, and `/mcp` is stateless, so instances can sit behind a load balancer. Keep in mind:

- Set the same `JWT_SECRET` on every instance, so each accepts the others' tokens.
- Each instance keeps its own project cache and refreshes on its own `PROJECT_TTL` timer, so instances can briefly serve different versions of a form after a change.
- Rate-limit counters are per process: each instance has its own allowance.
- With `TEMPLATE_SYNC=boot`, every instance installs missing template items at startup. Installation only adds what is missing, and instances starting together do not install anything twice (Form.io refuses the second copy, and the UAG counts what another instance installed as installed), but consider `off` and a single provisioning step for large fleets.
- Give every instance the same `MONGO` and `UAG_DATABASE`. The instances then share authorization codes for remote MCP sign-in, so a code issued by one can be exchanged at another, and they share run records.
- A run after the save is durable only with the database and an action that names an agent role. Such a run is recorded before the submitter gets the response, and one instance at a time takes it, under a lease it renews (see [Runs after the save](#runs-after-the-save)). Any other run after the save runs in the instance that received the submission, and is lost if that instance stops.

## Verifying a deployment

`GET /status` needs no credential and answers `200` once the UAG is serving, reporting the UAG version (`@formio/uag`) and the versions of the Form.io packages it runs on: it opens its port only after the project, the engines and the database are ready. The `formio/uag` image declares a `HEALTHCHECK` on it, and it suits load-balancer checks and Kubernetes probes.

```bash
# Tokens can be issued (always on):
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://uag.example.com/auth/token \
  -d grant_type=client_credentials -d client_id=myproject-x-token -d client_secret="$PROJECT_KEY"   # 200

# Remote MCP sign-in, only with MCP_OAUTH and a usable database:
curl -s -o /dev/null -w '%{http_code}\n' https://uag.example.com/.well-known/oauth-authorization-server   # 200

# Edition, engines, license state, durableRuns and mcpOAuth (from a server, not a browser):
curl -s https://uag.example.com/agent/capabilities -H "x-token: $PROJECT_KEY"
```

The UAG's log shows whether it uses a database (`Using the database "uag": ...`, `No database (MONGO): ...`, or `The database (MONGO) is not used: ...` with the reason), the edition line, and `Form.io UAG server running on port 3200` once it is serving. If it exits instead, the `Failed to start server:` line says why: `No Form.io project could be loaded` (`PROJECT` is not set), `Unable to load project from ...` or `Unable to load the project template from ...` (`PROJECT` is unreachable, or paired with the wrong credential; set `DEBUG=formio:error` to see each attempt's status), a license problem, a database the UAG may not use (see [The signature check](#the-signature-check)), or a misconfigured engine. See [Troubleshooting](/developers/troubleshooting).
