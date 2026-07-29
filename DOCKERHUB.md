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
  -e BASE_URL=https://forms.example.com \
  -e LOGIN_FORM=https://forms.example.com/user/login \
  --restart unless-stopped \
  formio/uag
```

Against a Form.io Enterprise project, use `PROJECT_KEY` and `UAG_LICENSE` in place of `ADMIN_KEY`:

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT=https://forms.example.com/myproject \
  -e PROJECT_KEY=your-project-api-key \
  -e UAG_LICENSE=your-license \
  -e JWT_SECRET=your-jwt-secret \
  -e BASE_URL=https://forms.example.com \
  --restart unless-stopped \
  formio/uag
```

Docker Compose is the recommended path for anything beyond a single container. Working stacks — including one that runs the UAG alongside a Form.io OSS server — are in the [examples directory](https://github.com/formio/uag/tree/main/examples).

## Connecting an agent

The MCP endpoint is `http://<host>:<port>/mcp`, served over Streamable HTTP (default port `3200`).

Integrations run their own MCP client and connect **outward** to the UAG, so the UAG does not need to be publicly reachable for them — only reachable from the integration, such as over a private Docker network or `localhost`. The bundled Claude integration is published as [`formio/uag-claude`](https://hub.docker.com/r/formio/uag-claude).

## Configuration

| Variable | Description |
| --- | --- |
| `PROJECT` | **Required.** API endpoint of the Enterprise project or the OSS server. |
| `JWT_SECRET` | **Required.** Secret used to sign and validate the UAG's own JWTs. Need not match the Form.io server's. |
| `BASE_URL` | **Required.** The URL clients reach the UAG at. Published in the `.well-known` OIDC (PKCE) definitions and used for auth callbacks. Must be public when remote agents connect in; a private or localhost URL is fine for a local MCP client. |
| `PROJECT_KEY` | Enterprise only. Project API key, from **Project Settings → API Keys**. |
| `ADMIN_KEY` | Open Source only. Used instead of `PROJECT_KEY`. |
| `UAG_LICENSE` | Required to run against a Form.io Enterprise deployment. |
| `PORT` | Server port. Default `3200`. |
| `PROJECT_TTL` | Seconds between project refreshes. Default `900`; `0` disables refresh entirely. Values under 60 are not recommended — a refresh calls the project export API, which is expensive. |
| `LOGIN_FORM` | URL of the login form JSON used by the browser login flow, so it must be reachable by that browser. |
| `JWT_EXPIRE_TIME` | JWT lifetime in seconds. Default `3600`. |
| `PORTAL_SECRET` | Enterprise only. Allows connecting from the Form.io Enterprise Portal. |
| `MONGO` / `MONGO_CONFIG` | Enterprise only. Connect directly to MongoDB instead of routing submissions through the Form.io submission APIs. |
| `CORS` | CORS domain, or JSON configuration for the `cors` module. |
| `DEBUG` | Debug log filter, e.g. `formio.*`. |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Set to `0` only when `PROJECT` is an HTTPS URL with a self-signed or otherwise untrusted certificate, which is common for local and internal deployments. Never set it on a deployment reachable from outside your network — it disables certificate verification for all outbound requests. |

Treat every key, secret, and license as sensitive: supply them through an `.env` file or your platform's secret store rather than inline in a committed file.

## Caching behaviour worth knowing

Forms and resources are cached and refreshed on the `PROJECT_TTL` interval, so a change to a form can take up to that long to appear to an agent. Set `PROJECT_TTL=0` to disable refreshing entirely, in which case a restart is the only way to pick up changes.

## Links

- Source and full documentation: https://github.com/formio/uag
- Examples, including agentic workflows and a conversational form: https://github.com/formio/uag/tree/main/examples
- Claude integration image: https://hub.docker.com/r/formio/uag-claude
- MCP server for building and managing Form.io forms from a coding agent: https://hub.docker.com/r/formio/mcp
- License: MIT
