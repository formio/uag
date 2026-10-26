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
- **`BASE_URL`** (required) — the URL clients reach the UAG at. The server starts without it, so its absence is easy to miss, but it is published in the `.well-known` OIDC (PKCE) definitions and used for authentication callbacks — leave it unset and remote agents cannot authenticate. Must be a public URL when remote agents connect in; a private or localhost URL is fine for a local MCP client. Ask the user which applies.
- **`PROJECT_KEY`** — project API key, for an Enterprise project only (setting it tells the UAG the project is Enterprise). For an Open Source server set `ADMIN_KEY` instead.
- **`ADMIN_KEY`** — server admin key, Community Edition only.
- **`LICENSE_KEY`** — the Form.io license; required for self-hosted Enterprise deployments, not for Community Edition or a project on Form.io's hosted service. The Agent API (`/agent/*`), with real model engines, also needs it to include the UAG (an online license with the `uagServer` scope and UAG servers to spare, or an offline license with the `uag` option); MCP does not. (`UAG_LICENSE` is the deprecated name, still read.)
- **`PORT`** — defaults to `3200`.

Full list, including `MONGO`, `PORTAL_SECRET`, `BASE_URL`, `LOGIN_FORM`, `CORS`, and `PROJECT_TTL`, is in the README's Environment Variables section. Treat every key and secret as sensitive: put them in an `.env` file or the deployment's secret store, never inline in a committed file.

## Deploying

Docker is the supported path. For an Enterprise project:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT="https://your-project.form.io" \
  -e PROJECT_KEY="..." \
  -e LICENSE_KEY="..." \
  -e JWT_SECRET="..." \
  -e BASE_URL="http://localhost:3200" \
  formio/uag
```

For an Open Source server, replace `PROJECT_KEY` and `LICENSE_KEY` with `ADMIN_KEY`. Set `BASE_URL` to the URL clients actually reach the UAG at.

Or install the npm package and run it as a Node process:

```bash
npm install @formio/uag
```

Working `docker-compose` stacks live in [`demo/`](./demo/) (the demo site) and [`demo/samples/`](./demo/samples/) — start from one of those for anything beyond a single container. They reference `formio/uag` untagged, so they always pull the current release.

## Connecting an agent

The UAG's MCP endpoint is `http://<host>:<port>/mcp` over Streamable HTTP.

Each bundled integration runs its own MCP client and connects **outward** to the UAG, so the UAG does not need to be publicly reachable — only reachable from the integration, for example over a private Docker network or `localhost`. See the README's Integrations section, and its version compatibility matrix, before pinning an integration version.

## Agent API engines (optional)

Besides MCP, the UAG serves an HTTP Agent API (`/agent/extract`, `/agent/decide`, `/agent/generate`, `/agent/provide`). It does nothing until an engine is enabled with `UAG_ENGINES` (for example `jev,claude`, which also need `TYPESAFE_API_KEY` and `CLAUDE_API_KEY`). Enable engines only if the user asks for the Agent API: `jev` and `claude` send submission data to their provider's hosted API. See the README's Agent API section.

## Verifying the deployment

Check that the process is listening on `/mcp` and that the container logs show a successful connection to the configured `PROJECT`. A failure to reach the project usually means `PROJECT` or `PROJECT_KEY` is wrong. If engines are enabled, `GET /agent/capabilities` (with the `x-token` or `x-admin-key` header, from a server rather than a browser) lists them and the tasks each can serve; a misconfigured engine stops startup with its name in the error.

Requires Node.js 22 or newer when run outside Docker.
