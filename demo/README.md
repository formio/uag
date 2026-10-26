# The UAG demo site

<sub>[Form.io UAG](../README.md) &rsaquo; this page</sub>

The marketing and demo site for the Form.io Universal Agent Gateway, published at **[ai.onform.io](https://ai.onform.io)**:

- **Product** (`/`) and **Getting Started** (`/getting-started`): what the UAG is, and how to run it yourself.
- **Examples** (`/examples`): three live demos, each with a flow viewer beside it showing every call the agents make.
  - **Conversation Forms** (`/examples/conversation`): a chat whose questions come entirely from a form.
  - **Agentic Workflow** (`/examples/workflow`): a college application reviewed by two chained agents, with no human in the loop.
  - **Agentic Formflow** (`/examples/formflow`): a claims wizard that chooses its own pages and fills itself in from a description.
- **Developers** (`/developers`): the technical documentation, from how the UAG works to the engine SDK.
- **Contact Us** (`/contact`): the hosted Form.io contact form.

Everything runs as one Docker Compose stack, on the demo's project on Form.io's hosted service, **`https://uag.form.io`**. Only the site is published; the UAG, the engine server and the flow proxy stay on the stack's private network, which is the deployment the site itself recommends. A hosted project needs no license.

```
                    ┌──────────── private network ──────────────────────────────────┐
 visitor ──HTTPS──▶ LB ──HTTP──▶ site ──▶ uag-flow ──▶ formio-uag ──▶ uag-flow ──▶ uag-engines ──▶ JEV, Claude
                    │              │ ▲        ▲              │                          │
                    │              │ │        └── webhooks ──┼──── the site's relay     research (/mcp) via uag-flow
                    │              │ │                       │
                    │              └─┼── reads the flow proxy's events
                    └────────────────┼───────────────────────┼──────────────────────────┘
                                     │                       ▼
            uag.form.io webhooks ──HTTPS──▶ /webhooks/uag    https://uag.form.io (Form.io's hosted service)
```

| Service | What it is |
|---|---|
| `site` | This folder's server (`server/`): the pages, the docs, the demos' back ends, the flow viewer's per-visitor stream, and the webhook relay. Plain HTTP on `DEMO_PORT`. |
| `uag-flow` | The flow proxy (`flow/proxy.mjs`): a logging reverse proxy in front of the UAG and the engine server. |
| `formio-uag` | The UAG, built from this repository. |
| `uag-engines` | The engine server (`packages/engine-server`), with JEV and Claude and their keys. |
| `setup` | A one-shot job (`server/setup.mjs`) that imports `module/project.json` into the project, creating the demo's forms or updating them in place. |

**The webhook relay.** The workflow demo runs on the project's webhook actions, which call the UAG's `/agent/provide`. Form.io's hosted service calls them from the internet, and the UAG is private, so the site passes them on: `POST /webhooks/uag/agent/provide` goes to the flow proxy (so the viewer still shows the runs), and only when it carries the project key. The setup job points the webhooks at `https://<DEMO_DOMAIN>/webhooks/uag`; set `WEBHOOK_UAG_URL` to send them elsewhere. Your load balancer must route `/webhooks/uag/*` to the site like any other path.

**Self-hosted instead.** `docker-compose.enterprise.yml` adds Form.io Enterprise and MongoDB to the stack and holds the project there: the setup job creates it and installs `PROJECT_KEY`, and the webhooks stay on the private network. That needs Form.io's `LICENSE_KEY`, which the UAG reads too, so it must include the UAG and allow `api-server:3000` (or add a `UAG_LICENSE`, deprecated, that does), and the settings marked "self-hosted" in `.env.example`:

```bash
docker compose -f docker-compose.yml -f docker-compose.enterprise.yml up -d --build
```

## Deploying it

```bash
cd demo
cp .env.example .env        # fill in every value marked "required"
docker compose up -d --build
```

Then point your load balancer or reverse proxy at `DEMO_BIND:DEMO_PORT` (127.0.0.1:8080 by default; set `DEMO_BIND` to the private address the load balancer reaches) for `ai.onform.io`, terminating TLS there. If your load balancer adds more than one `X-Forwarded-For` entry (some cloud load balancers and CDNs do), raise `TRUST_PROXY` to match, or every visitor shares one rate limit. The site sends `Strict-Transport-Security` when its public URL is `https`, reads visitor IPs from `X-Forwarded-For` through `TRUST_PROXY` hops, and serves its live streams (`/api/flow/stream`, `/api/formflow/agent/extract`) as server-sent events: turn off response buffering for those paths, and allow long-lived responses (a few minutes).

The images build from this repository (`docker compose build`). To deploy released images instead, set `UAG_IMAGE`, `ENGINES_IMAGE` and `DEMO_IMAGE` in `.env` and run `docker compose pull`.

`PROJECT_KEY` is an API key of `https://uag.form.io`, made in the project's settings (API Keys). To run the stack on another hosted project, set `FORMIO_PROJECT_URL` and its key; the project's name is read from its subdomain (`FORMIO_PROJECT_NAME` overrides it).

## Changing the domain

The domain is one setting. Set `DEMO_DOMAIN` in `.env` to the new name (and `DEMO_PUBLIC_URL` only if it is not `https://<DEMO_DOMAIN>`), restart the site, and move the load balancer. Canonical links, social cards and cookies follow it. Nothing inside the stack names the public domain: every service reaches the others by their Compose names.

The repository's own docs link to `ai.onform.io` as the place to see the demos; search for it when the domain changes for good.

## Keeping the demos safe to leave public

The demos call real models on Form.io's keys and hold what visitors type, so the site:

- **Checks visitors are human** with Cloudflare Turnstile. It is required in production (`NODE_ENV=production`): the site does not start without `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` unless `DEMO_REQUIRE_TURNSTILE=false`. One challenge unlocks the demos for `TURNSTILE_VALID_MINUTES` (120).
- **Rate limits** each operation per client network (an IPv4 address, or an IPv6 /64) and then per visitor (`DEMO_LIMITS`, JSON; see `server/config.mjs` for the defaults). A network may also start only `DEMO_SESSIONS_PER_NETWORK` (default 300, so offices and campuses behind one address are not shut out) new visitor sessions in ten minutes, and hold `DEMO_STREAMS_PER_NETWORK` flow views open.
- **Caps the day's spend** at `DEMO_DAILY_BUDGET` units across all visitors, and `DEMO_DAILY_NETWORK_BUDGET` per network. A chat turn or an extraction costs a unit up front (an application 2; `DEMO_COSTS` changes them), and a chat turn pays one more per `DEMO_TOKENS_PER_UNIT` model tokens it actually used, stopping between model calls when the day runs out. The chat sends at most `CHAT_MAX_HISTORY_CHARS` of history, makes at most `CHAT_MAX_TOOL_ITERATIONS` model calls a turn, and stops when the visitor goes away. Requests are validated before they are charged. The count is kept in the `demo-state` volume, so a restart does not reset it. Once it is spent the demos say so until midnight UTC; the rest of the site keeps working. Set a spend limit on the model provider's side too.
- **Keeps visitors apart.** A visitor is a signed cookie (`DEMO_SECRET`; `__Host-` prefixed over HTTPS), started only by the demos' API. They can read only the applications they submitted, and the flow viewer shows them only their own runs: every call the site makes for them carries an `X-Request-Id` naming their session, which the UAG forwards to the engine server and the engine server to its research calls, and webhook runs are matched to the submission they name. Token exchanges are redacted from the viewer, and so are the private services' addresses.
- **Narrows the chat.** It runs with the project key, so it offers Claude only the tools that fill in a form (never `find_submissions` or `submission_update`), and only the forms in `CHAT_FORMS` (`serviceRequest`).
- **Deletes what visitors submit** after `DEMO_RETENTION_HOURS` (24), and never writes request bodies to its logs.
- **Fixes the task server-side.** The browser cannot choose which form or task the demo's key is used for, or pre-fill the agents' fields; descriptions are capped at `DEMO_MAX_INPUT_LENGTH` (8000) characters, and the claim upload is read only after the guard lets it in.
- **Publishes only the site, and only on `DEMO_BIND`** (127.0.0.1 by default). Point your load balancer at it on a private address: the site trusts the `X-Forwarded-For` of whatever connects to it (`TRUST_PROXY` hops), so the port must not be reachable around the load balancer. MongoDB is on an internal network only Form.io can reach.

Sessions and rate-limit counters are in the site's memory (bounded), so run one instance of `site`.

## Settings

All of them are in [`.env.example`](./.env.example). The ones you are most likely to change:

| Variable | Default | Purpose |
|---|---|---|
| `DEMO_DOMAIN` | `ai.onform.io` | The domain the site is served at. |
| `DEMO_PORT`, `DEMO_BIND` | `8080`, `127.0.0.1` | The host port the site listens on, and the address it is bound to. |
| `CONTACT_FORM_URL` | `https://formio.form.io/contact` | The hosted form the Contact Us page renders. Point it at the form on `crm.form.io` once it is there. |
| `CHAT_MODEL`, `CLAUDE_MODEL` | `claude-sonnet-5-5` | The model the chat uses, and the one the Claude engine uses. |
| `PROJECT_TTL` | `300` | Seconds between the UAG's re-reads of the project. |
| `DEMO_TEMPLATE_SYNC` | `import` | `off` stops the setup job updating an existing project's forms from `module/project.json`. |

## Working on it

Run on your own machine, the examples say whether they can run: with no UAG to talk to, or one that cannot run Agentic Formflow (no license that includes the UAG, and not on a hosted project), they show a notice that a license is needed to run them locally, and the workflow and formflow demos say they are not supported. The deployed site (`NODE_ENV=production`) never shows it: there, a UAG that does not answer is an outage, and the demos say so themselves.

### Run it against your own project

The quickest way to run every demo on your machine: your own project on Form.io's hosted service (a free one from [portal.form.io](https://portal.form.io) will do, or a stage of one), and one command. No Docker, and no UAG license: a hosted project runs Agentic Formflow under Form.io's license.

**You need:** Node.js 22 or later, Yarn (`corepack enable`), an API key of the project (the project's **Settings → API Keys**), a Claude API key, and a TypeSafe API key (for JEV, the decision engine).

```bash
git clone https://github.com/formio/uag.git && cd uag
yarn install && yarn build
cp demo/local.env.example demo/.env.local      # then fill it in (below)
yarn demo:local                                # http://localhost:8080
```

In `demo/.env.local` (git ignores it):

| Setting | Value |
|---|---|
| `FORMIO_PROJECT_URL` | Your project, `https://<name>.form.io`. Not `https://uag.form.io`, the deployed demo's own project. |
| `PROJECT_KEY` | The project's API key. |
| `CLAUDE_API_KEY`, `TYPESAFE_API_KEY` | Your model keys. |
| `DEMO_TEMPLATE_SYNC` | Leave empty the first time, so the demo's forms are imported. Set `off` afterwards, or on a project others already set up and share. |

`yarn demo:local` then:

1. Imports the demo's forms and actions (`module/project.json`) into the project: `serviceRequest`, `application`, `sum` and `claim`. An empty project is fine; forms it already has are updated in place.
2. Starts the UAG from `lib/` on the project, with JEV and Claude in-process, on `UAG_PORT` (3200).
3. Starts the flow proxy, for the flow viewer, on `FLOW_PORT` (3250).
4. Starts the site on `DEMO_PORT` (8080), and prints what it found:

```
[demo:local] The demo is running at http://localhost:8080
[demo:local] Project:  https://<name>.form.io
[demo:local] UAG:      http://localhost:3200 (enterprise edition; Agentic Formflow enabled, hosted)
```

Ctrl+C stops everything. If a port is taken, it says which one and which setting moves it.

**What works.** Conversation Forms and Agentic Formflow work as soon as it is up. **Agentic Workflow** runs on the project's webhooks, which Form.io's hosted service calls over the internet, so they cannot reach `localhost`: applications stay "Under review" until you expose the site with a tunnel and point the webhooks at it, then run once with the import on:

```bash
ngrok http 8080                                # or: cloudflared tunnel --url http://localhost:8080
# demo/.env.local: WEBHOOK_UAG_URL=https://<the tunnel's host>/webhooks/uag, DEMO_TEMPLATE_SYNC empty
yarn demo:local
```

Only one machine can receive a project's webhooks at a time: the last import wins.

**Plans without Submission Collections.** The UAG keeps its authorization codes in a resource with a submission collection of its own where the project allows one. On a plan that does not (Form.io's hosted service answers `403 Your project cannot be configured for Submission Collections`), it creates the resource without one instead (`@formio/appserver-core` 2.20.1 and later), so an empty project on any plan works.

### Against a UAG you run

Run a UAG on your machine, connected to `https://uag.form.io` (or any hosted project, or another project with a `LICENSE_KEY`), and then the site alone against it. In the UAG's `.env`, at the repository root:

```bash
PORT=3200
PROJECT=https://uag.form.io
PROJECT_KEY=<an API key of the project>
JWT_SECRET=<openssl rand -hex 32>
BASE_URL=http://localhost:3200
# The engines the deployed stack runs: JEV decides, Claude fills in values.
UAG_ENGINES=jev,claude
TYPESAFE_API_KEY=<your key>
CLAUDE_API_KEY=<your key>
```

Then the site's, in `demo/.env.local` (read by `yarn demo:start`):

```bash
FORMIO_PROJECT_URL=https://uag.form.io
PROJECT_KEY=<the same key>
UAG_URL=http://localhost:3200
DEMO_PUBLIC_URL=http://localhost:8080
CLAUDE_API_KEY=<your key>
```

```bash
yarn build && yarn start        # the UAG, on :3200
yarn demo:start                 # the site, on http://localhost:8080
```

The UAG reports the hosted project (`reason: "hosted"`), so every demo runs and no notice is shown. There is no flow proxy in this setup, so the flow viewer is off, and the project's webhooks still go to the deployed site's relay, so a submitted application is decided by the deployed stack.

### The whole stack

Run the whole site locally:

```bash
yarn install && yarn build      # the UAG, from lib/
yarn demo:dev                   # http://127.0.0.1:3420; Ctrl+C stops it and removes the containers
```

It runs Form.io Open Source and MongoDB in Docker, the UAG from `lib/`, the engine server with the e2e suite's scripted engines (instant, keyword-driven answers for the workflow and the claims wizard), the flow proxy and the site, as the e2e suites do ([`scripts/dev.mjs`](./scripts/dev.mjs)). The chat calls Claude when `CLAUDE_API_KEY` is set in the root `.env`. The workflow and formflow demos are Agentic Formflow, so they need a license that includes the UAG, `LICENSE_KEY` (or `E2E_UAG_LICENSE`) in the root `.env`; without one the examples show the notice, and those two demos "Not supported without a license or SaaS project", as they do against any Open Source server or unlicensed UAG. Pages and docs are re-read on every request, so edits show on reload; restart it after changing server code.

| Path | What |
|---|---|
| `server/` | The site: `index.mjs` (routes), `pages.mjs` and `views/` (the pages), `docs.mjs` and `content/developers/` (the docs), one module per demo, and the guard, sessions and flow viewer. |
| `public/` | Styles, scripts, images, and the three demo apps under `public/apps/`. |
| `flow/proxy.mjs` | The flow proxy. |
| `module/` | The demo project (`project.json`) and the sample applicants. |
| `samples/` | Things to start your own deployment from: the [custom module](./samples/custom-module) (Claude Desktop) and [engine setups](./samples/engines). |
| `test/` | Unit tests, run by `yarn test` at the root. The e2e suites are `test/e2e/layer1.demo-*` and `layer3.demo-stack` at the root. |

The docs are Markdown; see [`content/developers/README.md`](./content/developers/README.md) for the format.
