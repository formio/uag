# Installation instructions for AI agents

This file is for an AI assistant installing the Form.io Universal Agent Gateway (UAG) on a user's behalf. If you are a human, read [README.md](./README.md) instead.

## What this is, and what it is not

The UAG is a **server you deploy**, not a stdio MCP server a client spawns on demand. It runs as a long-lived HTTP process, connects to a Form.io deployment, and exposes MCP over Streamable HTTP at `/mcp` (default port `3200`).

Because of that, do not try to add it to a client config as a `command`/`args` stdio entry. Deploy it first, then point the client at its URL.

If the user actually wants Form.io tools spawned locally inside their editor — creating and editing forms, roles, and projects from an agent — they probably want [`@formio/mcp`](https://github.com/formio/ai) instead. Ask before deploying anything.

## Required configuration

Ask the user for these. Do not guess, and do not invent secret values.

- **`PROJECT`** (required) — API endpoint of the Form.io project: a self-hosted Enterprise project, a project on Form.io's hosted service, or a Form.io Open Source server.
- **`JWT_SECRET`** (required) — secret used to sign and validate the UAG's own tokens. Generate a random value if the user has no preference, and show it to them rather than hiding it.
- **`PROJECT_KEY`** — project API key, for a self-hosted Enterprise project or a project on Form.io's hosted service (setting it tells the UAG the project is Enterprise). For an Open Source server set `ADMIN_KEY` instead.
- **`ADMIN_KEY`** — server admin key, Form.io Open Source only.
- **`LICENSE_KEY`** — a Form.io license that includes the UAG: an online license whose key has the `uagServer` scope, or an offline license with the `uag` option (then also set **`LICENSE_REMOTE=true`**). It is required:
  - for a self-hosted Enterprise project, and its endpoint allowlist must include `PROJECT`'s host; otherwise the project does not load and the UAG says why;
  - for Agentic Formflow (the Agent API's `{form}/agent/extract`, `decide` and `generate`, the "Agent: Run task" action, and the `agent_decide` and `agent_provide` MCP tools) with real model engines on a self-hosted project, Open Source or Enterprise;
  - for the UAG's own database (`MONGO`), on every project.

  Conversation forms (the MCP tools and a form's chat) on Form.io Open Source or a hosted project need none. A project on Form.io's hosted service (`https://*.form.io`) needs none for Agentic Formflow either: leave `LICENSE_KEY` unset there unless the UAG has its own database. Without a license, those requests answer `403` with `code: "license_required"`. (`UAG_LICENSE` is the deprecated name, still read until UAG 3.0.) The user can ask support@form.io for a trial license.
- **`PORT`** — defaults to `3200`.

Ask which kind of MCP client will connect (see [Connecting an agent](#connecting-an-agent)). Only for remote clients, also ask for:

- **`MCP_OAUTH=true`** — turns on OAuth sign-in for remote MCP clients.
- **`MONGO`** — a MongoDB connection string for the UAG's own database (it can be the server Form.io uses; `UAG_DATABASE` names the database, default `uag`). It holds only `uag-*` collections, never submissions. Using it needs a `LICENSE_KEY` that includes the UAG. Without a usable database the UAG starts with remote sign-in off and says why in its log.
- **`TRUST_PROXY`** — when the UAG runs behind a reverse proxy (`true`, a number of hops, or the proxy's addresses), so the OAuth discovery documents name the public URL from the forwarded headers. `BASE_URL` is optional: set it only to override the URL the UAG derives from each request.

Full list, including `PORTAL_SECRET`, `LOGIN_FORM`, `CORS`, and `PROJECT_TTL`, is in the [Deployment documentation](./demo/content/developers/deployment.md). Treat every key and secret as sensitive: put them in an `.env` file or the deployment's secret store, never inline in a committed file.

## Deploying

Docker is the supported path. For a self-hosted Enterprise project:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT="https://forms.example.com/your-project" \
  -e PROJECT_KEY="..." \
  -e LICENSE_KEY="..." \
  -e JWT_SECRET="..." \
  formio/uag
```

For an offline license, add `-e LICENSE_REMOTE=true`. For a project on Form.io's hosted service (`PROJECT=https://your-project.form.io`), drop `LICENSE_KEY`. For an Open Source server, replace `PROJECT_KEY` with `ADMIN_KEY`, and drop `LICENSE_KEY` unless the user wants Agentic Formflow or the UAG's database. For remote MCP clients, add `-e MCP_OAUTH=true -e MONGO="..."` (and `-e TRUST_PROXY=true` behind a reverse proxy you control).

Or install the npm package and run it as a Node process (Node.js 22 or newer), with the same variables in the environment or in an `.env` file in the working directory:

```bash
npm install @formio/uag
npx uag
```

Install the package before running `npx uag`: without it, `npx` fetches an unrelated npm package named `uag`. Install the engine packages the user enables next to it (`npm install @formio/uag-claude`).

For anything beyond a single container, start from a Docker Compose stack: the README's [Quickstart](./README.md#quickstart) (Form.io Open Source and the UAG in one file), or the [custom module sample](./demo/samples/custom-module) (Form.io Open Source, MongoDB and the UAG with a module), with the [engine setups](./demo/samples/engines) to add engines. They use untagged images (`formio/uag`, `formio/uag-engines`), which follow the newest release; pin an exact version (`formio/uag:2.0.0`) for production. Do not start from `demo/`: it is the demo site's own deployment.

## Making forms visible to agents

The UAG registers only the forms tagged `uag` (in the portal, **Form Settings → Tags**); a form without the tag is invisible to agents, with no error. It reads the project at startup and again every `PROJECT_TTL` seconds (default `900`), so a new tag or a changed form reaches agents only after the next refresh. Tell the user this, and restart the UAG to pick a change up at once; while experimenting, a short `PROJECT_TTL` (such as `10`) helps.

## Connecting an agent

The UAG's MCP endpoint is `http://<host>:<port>/mcp` over Streamable HTTP.

A local MCP client — the user's own application, or an engine server (`formio/uag-engines`) researching with the UAG's tools — connects **outward** to the UAG, so the UAG then only needs to be reachable from that client, for example over a private Docker network or `localhost`. It gets a token from `/auth/token` with the `client_credentials` grant (`client_id` `formio-oss-x-admin-key` with `ADMIN_KEY`, or `<project name>-x-token` with `PROJECT_KEY`), which needs no `BASE_URL`, `MONGO` or `MCP_OAUTH`. Remote agents (claude.ai and Claude Desktop connectors) connect in, so the UAG must then be public over HTTPS, with `MCP_OAUTH=true` and a usable `MONGO`; its `/.well-known` endpoints answer `404` until both are in place. See the README's [How agents connect](./README.md#how-agents-connect) and its [Packages and versions](./README.md#packages-and-versions) matrix before pinning versions.

## Agent API and agentic workflows (optional)

Besides MCP, the UAG serves an HTTP Agent API (`{form}/agent/extract`, `{form}/agent/decide` and `{form}/agent/generate` under each form's URL on the UAG, and `/agent/capabilities` at its root), which saves nothing, and an **"Agent: Run task"** form action, which runs a form's task on a submission sent to the UAG, before or after the save, and is how agentic workflows run. Both do nothing until an engine is enabled with `UAG_ENGINES` (for example `jev,claude`, which also need `TYPESAFE_API_KEY` and `CLAUDE_API_KEY`), and with real engines they need a `LICENSE_KEY` that includes the UAG, or a hosted project. Enable engines only if the user asks for these: they send submission data to their provider's hosted API.

A form's chat, `{form}/agent/chat`, is the exception: it is part of conversation forms and needs an agent engine (such as `claude`) but no Agentic Formflow license. It is what `Formio.createChat(element, formUrl)` from `@formio/uag-js` calls to embed a form as a chat in a web page; see [Chat widget](./demo/content/developers/chat.md).

For a workflow, the user adds "Agent: Run task" to the form (on Enterprise, in a portal stage connected to the UAG with `PORTAL_SECRET`) and points their application's project URL at the UAG, since tasks run only for submissions the UAG receives. There is no webhook to configure. See the README's [Agentic workflows](./README.md#agentic-workflows) and [Agent API](./README.md#agent-api) sections.

## Verifying the deployment

`GET /status` needs no credential and answers `200` once the UAG is serving, with the UAG's version: it opens its port only after the project, the engines and the database are ready. Check that it answers, and that the container logs show a successful connection to the configured `PROJECT`. A failure to reach the project usually means `PROJECT` or `PROJECT_KEY` is wrong. The startup log also says whether the database (`MONGO`) is used and whether remote MCP sign-in is on, and why not. If engines are enabled, `GET /agent/capabilities` (with the `x-token` or `x-admin-key` header, from a server rather than a browser) lists them and the operations each serves; a misconfigured engine stops startup with its name in the error.

Requires Node.js 22 or newer when run outside Docker. If an agent says a form does not exist, the form is not tagged `uag`, or the project has not refreshed yet (`PROJECT_TTL`).
