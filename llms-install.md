# Installation instructions for AI agents

This file is for an AI assistant installing the Form.io Universal Agent Gateway (UAG) on a user's behalf. If you are a human, read [README.md](./README.md) instead.

## What this is, and what it is not

The UAG is a **server you deploy**, not a stdio MCP server a client spawns on demand. It runs as a long-lived HTTP process, connects to a Form.io deployment, and exposes MCP over Streamable HTTP at `/mcp` (default port `3200`).

Because of that, do not try to add it to a client config as a `command`/`args` stdio entry. Deploy it first, then point the client at its URL.

If the user actually wants Form.io tools spawned locally inside their editor — creating and editing forms, roles, and projects from an agent — they probably want [`@formio/mcp`](https://github.com/formio/ai) instead. Ask before deploying anything.

## Required configuration

Ask the user for these. Do not guess, and do not invent secret values.

- **`PROJECT`** (required) — API endpoint of the Form.io Enterprise project or OSS server.
- **`JWT_SECRET`** (required) — secret used to sign and validate the UAG's own tokens. Generate a random value if the user has no preference, and show it to them rather than hiding it.
- **`PROJECT_KEY`** — project API key, for an Enterprise project only (setting it tells the UAG the project is Enterprise). For an Open Source server set `ADMIN_KEY` instead.
- **`ADMIN_KEY`** — server admin key, Community Edition only.
- **`LICENSE_KEY`** — the Form.io license; required for self-hosted Enterprise deployments, not for Community Edition or a project on Form.io's hosted service (`https://*.form.io`). The Agent API's `{form}/agent/extract`, `decide` and `generate` and the "Agent: Run task" action, with real model engines, also need it to include the UAG (an online license with the `uagServer` scope and UAG servers to spare, or an offline license with the `uag` option), on Community Edition too; a project on Form.io's hosted service needs none for them. MCP with a local client does not. (`UAG_LICENSE` is the deprecated name, still read.)
- **`PORT`** — defaults to `3200`.

Ask which kind of MCP client will connect (see [Connecting an agent](#connecting-an-agent)). Only for remote clients, also ask for:

- **`MCP_OAUTH=true`** — turns on OAuth sign-in for remote MCP clients.
- **`MONGO`** — a MongoDB connection string for the UAG's own database (it can be the server Form.io uses; `UAG_DATABASE` names the database, default `uag`). It holds only `uag-*` collections, never submissions. Using it needs a `LICENSE_KEY` that includes the UAG, unless the project and the database are both on development hosts (`localhost`, `*.localhost`, `lvh.me`, `*.local`). Without a usable database the UAG starts with remote sign-in off and says why in its log.
- **`TRUST_PROXY`** — when the UAG runs behind a reverse proxy (`true`, a number of hops, or the proxy's addresses), so the OAuth discovery documents name the public URL from the forwarded headers. `BASE_URL` is optional: set it only to override the URL the UAG derives from each request.

Full list, including `PORTAL_SECRET`, `LOGIN_FORM`, `CORS`, and `PROJECT_TTL`, is in the [Deployment documentation](https://ai.form.io/developers/deployment). Treat every key and secret as sensitive: put them in an `.env` file or the deployment's secret store, never inline in a committed file.

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

For a project on Form.io's hosted service (`PROJECT=https://your-project.form.io`), drop `LICENSE_KEY`. For an Open Source server, replace `PROJECT_KEY` and `LICENSE_KEY` with `ADMIN_KEY`. For remote MCP clients, add `-e MCP_OAUTH=true -e MONGO="..."` (and `-e TRUST_PROXY=true` behind a reverse proxy you control).

Or install the npm package and run it as a Node process:

```bash
npm install @formio/uag
```

Working `docker-compose` stacks live in [`demo/`](./demo/) (the demo site) and [`demo/samples/`](./demo/samples/) — start from one of those for anything beyond a single container. The samples reference `formio/uag` untagged, so they pull the current release; the demo site pins its own `:demo` tags.

## Connecting an agent

The UAG's MCP endpoint is `http://<host>:<port>/mcp` over Streamable HTTP.

A local MCP client — the user's own application, or an engine server (`formio/uag-engines`) researching with the UAG's tools — connects **outward** to the UAG, so the UAG then only needs to be reachable from that client, for example over a private Docker network or `localhost`. It gets a token from `/auth/token` with the `client_credentials` grant (`client_id` `formio-oss-x-admin-key` with `ADMIN_KEY`, or `<project name>-x-token` with `PROJECT_KEY`), which needs no `BASE_URL`, `MONGO` or `MCP_OAUTH`. Remote agents (claude.ai and Claude Desktop connectors) connect in, so the UAG must then be public over HTTPS, with `MCP_OAUTH=true` and a usable `MONGO`; its `/.well-known` endpoints answer `404` until both are in place. See the README's [How agents connect](./README.md#how-agents-connect) and its [Packages and versions](./README.md#packages-and-versions) matrix before pinning versions.

## Agent API and agentic workflows (optional)

Besides MCP, the UAG serves an HTTP Agent API (`{form}/agent/extract`, `{form}/agent/decide` and `{form}/agent/generate` under each form's URL on the UAG, and `/agent/capabilities` at its root), which saves nothing, and an **"Agent: Run task"** form action, which runs a form's task on a submission sent to the UAG, before or after the save, and is how agentic workflows run. Both do nothing until an engine is enabled with `UAG_ENGINES` (for example `jev,claude`, which also need `TYPESAFE_API_KEY` and `CLAUDE_API_KEY`), and with real engines they need a `LICENSE_KEY` that includes the UAG, or a hosted project. Enable engines only if the user asks for these: they send submission data to their provider's hosted API.

A form's chat, `{form}/agent/chat`, is the exception: it is part of conversation forms and needs an agent engine (such as `claude`) but no Agentic Formflow license. It is what `Formio.createChat(element, formUrl)` from `@formio/uag-js` calls to embed a form as a chat in a web page; see [Chat widget](https://ai.form.io/developers/chat).

For a workflow, the user adds "Agent: Run task" to the form (on Enterprise, in a portal stage connected to the UAG with `PORTAL_SECRET`) and points their application's project URL at the UAG, since tasks run only for submissions the UAG receives. There is no webhook to configure. See the README's [Agentic workflows](./README.md#agentic-workflows) and [Agent API](./README.md#agent-api) sections.

## Verifying the deployment

Check that the process is listening on `/mcp` and that the container logs show a successful connection to the configured `PROJECT`. A failure to reach the project usually means `PROJECT` or `PROJECT_KEY` is wrong. The startup log also says whether the database (`MONGO`) is used and whether remote MCP sign-in is on, and why not. If engines are enabled, `GET /agent/capabilities` (with the `x-token` or `x-admin-key` header, from a server rather than a browser) lists them and the operations each serves; a misconfigured engine stops startup with its name in the error.

Requires Node.js 22 or newer when run outside Docker.
