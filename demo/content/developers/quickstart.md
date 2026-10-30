---
title: Quickstart
description: Run the UAG yourself, inside your own network or against a hosted Form.io project, and make your first MCP and Agent API calls.
section: Start here
order: 3
---

This page gets a UAG running and answering in about ten minutes. There are two ways to run it:

- **[Self-hosted](#self-hosted-with-formio-open-source)**: Form.io Open Source and the UAG in one Docker Compose stack, on your machine or your own servers. Free, and nothing leaves your network unless you enable a model engine that calls out.
- **[Against a hosted project](#against-a-hosted-formio-project)**: the UAG in Docker, connected to a project on Form.io's hosted SaaS at `portal.form.io`.

Both end with the same [first calls](#first-calls): a token, the MCP tool list, and the Agent API's capabilities.

**Prerequisites**: Docker with Compose, and `curl`. Node.js 22 or newer for the JavaScript examples.

> **Tip:** To have your coding agent do this, run `npx skills add formio/ai` in your application's folder to install the [Agentic Coding Plugin](/developers/agentic-coding), and ask, for example: "Deploy the UAG against our Form.io project with Docker Compose and make our serviceRequest form agent-ready." It writes the Compose file with placeholder secrets and shows each form change before saving it.

## Self-hosted with Form.io Open Source

Running the UAG inside your own security boundary is the deployment most teams choose. The UAG, Form.io and MongoDB all run in your network; the UAG calls only the Form.io server you point it at, plus whichever model providers you explicitly enable. Agents connect from inside the network, or through a public URL you choose to expose. Form.io Open Source and the UAG's MCP and conversation features need no license.

### 1. Write the Compose file

Create a directory with this `docker-compose.yml`. Replace every `CHANGEME` before you run it anywhere but your own machine; `ADMIN_KEY` must be the same on both services.

```yaml
services:
  mongo:
    image: mongo:7
    restart: always
    volumes:
      - mongo-data:/data/db

  # Form.io Community Edition. The container listens on 3001.
  formio:
    image: formio/formio
    restart: always
    depends_on:
      - mongo
    ports:
      - "3000:3001"
    environment:
      NODE_CONFIG: '{"mongo": "mongodb://mongo:27017/formio-oss", "jwt": {"secret": "CHANGEME"}, "mongoSecret": "CHANGEME"}'
      ROOT_EMAIL: admin@example.com
      ROOT_PASSWORD: CHANGEME
      ADMIN_KEY: CHANGEME
    healthcheck:
      # The UAG loads the project at startup, so hold it back until Form.io answers.
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 5s
      timeout: 5s
      retries: 40

  formio-uag:
    image: formio/uag
    restart: always
    depends_on:
      formio:
        condition: service_healthy
    ports:
      - "3200:3200"
    environment:
      PORT: 3200
      # Container-to-container address of the Form.io server.
      PROJECT: http://formio:3001
      ADMIN_KEY: CHANGEME
      JWT_SECRET: CHANGEME
      # Re-read the project every 10 seconds while you experiment.
      PROJECT_TTL: 10

volumes:
  mongo-data:
```

### 2. Start it

```bash
docker compose up -d
docker compose logs -f formio-uag
```

When the UAG is ready it prints:

```
[formio-uag] Open Source edition. Agentic Formflow requires a license (LICENSE_KEY) that includes the UAG, or a project on Form.io's hosted service; MCP and conversation forms are unaffected.
Form.io UAG server running on port 3200
```

Form.io is at http://localhost:3000 (log in as `admin@example.com` with `ROOT_PASSWORD`), and the UAG is at http://localhost:3200.

> **Note:** The UAG exits if it cannot load the project. If the logs say "No Form.io project could be loaded", check that `PROJECT` is reachable from inside the UAG container and that `ADMIN_KEY` matches the Form.io server's.

### 3. Give the agent a form

Agents see only forms tagged `uag`. Create one with the admin key (or in the portal, under **Form Settings → Tags**):

```bash
curl -s -X POST http://localhost:3000/form \
  -H 'x-admin-key: CHANGEME' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Support Request",
    "name": "supportRequest",
    "path": "supportrequest",
    "type": "form",
    "tags": ["uag"],
    "components": [
      { "type": "textfield", "key": "fullName", "label": "Full name", "input": true, "validate": { "required": true } },
      { "type": "email", "key": "email", "label": "Email", "input": true, "validate": { "required": true } },
      { "type": "radio", "key": "urgency", "label": "Urgency", "input": true,
        "values": [ { "label": "Low", "value": "low" }, { "label": "High", "value": "high" } ] },
      { "type": "button", "key": "submit", "label": "Submit", "input": true, "action": "submit" }
    ]
  }'
```

Wait `PROJECT_TTL` seconds (10 here) for the UAG to register it, or run `docker compose restart formio-uag`.

To make the UAG reachable from outside the host, put it behind a reverse proxy with TLS, and set `TRUST_PROXY` so the UAG reads its public URL from the proxy's forwarded headers (or set `BASE_URL` to that URL). Remote MCP clients such as claude.ai connectors also need `MCP_OAUTH=true` and a database of the UAG's own (`MONGO`); see [Connect Claude](/developers/connect-claude). Read [Deployment](/developers/deployment) and [Security](/developers/security) before you expose it.

## Against a hosted Form.io project

If your forms already live on Form.io's hosted SaaS, run the UAG yourself and point it at the project. The UAG still runs where you run it, so its tokens, logs and engine traffic stay in your infrastructure.

1. **Create a project.** Sign in at https://portal.form.io and create a project, or open an existing one. Note its API endpoint, `https://<project>.form.io`.
2. **Create an API key.** In the project, open **Project Settings → API Keys** and add a key. The UAG uses it as `PROJECT_KEY`. Treat it as a secret: it grants administrator access to the project.
3. **Tag a form.** Open a form, add `uag` under **Form Settings → Tags**, and save.
4. **Run the UAG.**

```bash
docker run -d --name formio-uag -p 3200:3200 \
  -e PROJECT="https://<project>.form.io" \
  -e PROJECT_KEY="<your API key>" \
  -e JWT_SECRET="<a long random string>" \
  formio/uag
```

Hosted SaaS projects need no license: they run under Form.io's own license, as the Enterprise edition, and Agentic Formflow is allowed (`/agent/capabilities` reports `reason: "hosted"`). A license is needed only when you self-host Form.io Enterprise; see [Deployment](/developers/deployment#licensing).

> **Note:** The exemption rests on the project's `https://*.form.io` certificate, so it is turned off by anything that weakens that proof: `NODE_TLS_REJECT_UNAUTHORIZED=0`, or extra certificate authorities (`NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`). It does not cover a database of the UAG's own (`MONGO`), which needs a license that includes the UAG on every edition.

In the commands below, a hosted project uses its own name in the `client_id` (`<project>-x-token`) and its API key as the secret.

## First calls

The examples use `http://localhost:3200`. Set two shell variables first:

```bash
UAG=http://localhost:3200
ADMIN_KEY=CHANGEME
```

### Get a token

Server-side clients exchange a key for a UAG access token with the `client_credentials` grant. The `client_id` is the project name followed by the credential type:

| Deployment | `client_id` | `client_secret` |
|---|---|---|
| Form.io Open Source | `formio-oss-x-admin-key` | `ADMIN_KEY` |
| Form.io Enterprise or hosted SaaS | `<project name>-x-token` | `PROJECT_KEY` |

The token endpoint is `/auth/token` on the UAG, on every edition, and it is always on: it needs no `BASE_URL`, `MONGO` or `MCP_OAUTH`. Against an Enterprise or hosted project, the project's routes are also served under its name, so `/<project name>/auth/token` works too.

```bash
curl -s -X POST $UAG/auth/token \
  -H 'Content-Type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"formio-oss-x-admin-key\",\"client_secret\":\"$ADMIN_KEY\"}"
```

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "formio"
}
```

`expires_in` is in seconds: `JWT_EXPIRE_TIME` (minutes, default 60) times 60. A `400` means the `client_id` prefix or the secret is wrong.

```bash
TOKEN=$(curl -s -X POST $UAG/auth/token -H 'Content-Type: application/json' \
  -d "{\"grant_type\":\"client_credentials\",\"client_id\":\"formio-oss-x-admin-key\",\"client_secret\":\"$ADMIN_KEY\"}" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
```

### List the MCP tools

`/mcp` speaks JSON-RPC over Streamable HTTP. The UAG runs it statelessly, so a single `tools/list` request works without a session:

```bash
curl -s -X POST $UAG/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The answer arrives as one Server-Sent Event:

```
event: message
data: {"result":{"tools":[{"name":"get_forms","title":"Get Available Forms", ... }]},"jsonrpc":"2.0","id":1}
```

Call a tool the same way, with `tools/call`:

```bash
curl -s -X POST $UAG/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_forms","arguments":{}}}'
```

The text it returns lists `Support Request (**supportRequest**)` with your permissions on it. Real clients use an MCP SDK instead of `curl`; [MCP tools](/developers/mcp-tools#a-minimal-mcp-client) has a complete one.

### Ask the Agent API what it can do

```bash
curl -s $UAG/agent/capabilities -H "x-admin-key: $ADMIN_KEY"
```

```json
{
  "requestId": "f79dcf1c-11d7-4387-be12-e6c54527e2a6",
  "engines": [],
  "operations": {
    "extract": { "available": false, "engines": [] },
    "decide": { "available": false, "engines": [] },
    "generate": { "available": false, "engines": [] }
  },
  "edition": "open-source",
  "formflow": { "licensed": false, "allowed": false, "reason": "unlicensed" },
  "durableRuns": false,
  "mcpOAuth": false
}
```

No engine is enabled yet, so no operation is available. `durableRuns` and `mcpOAuth` are `false` because the UAG has no database of its own (`MONGO`); see [Deployment](/developers/deployment#the-database). A bearer token works here too (`-H "Authorization: Bearer $TOKEN"`). The admin-key form works only from servers: the UAG refuses admin credentials on any request that carries an `Origin` or `Sec-Fetch-Site` header.

### Try the Agent API without a model

The stub engines answer instantly with fixed values and need no credentials and no license. Add them to the UAG's environment and recreate the container:

```yaml
      UAG_ENGINES: stub-decision,stub-agent
```

```bash
docker compose up -d
curl -s -X POST $UAG/supportrequest/agent/decide \
  -H "x-admin-key: $ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"data":{}}'
```

A form's operations are under the form's URL on the UAG, as its submissions are: here the form's path, `supportrequest`, at the UAG's root. Against an Enterprise or hosted project, the form is under the project's name (`$UAG/<project name>/supportrequest/agent/decide`), and the key is `-H "x-token: $PROJECT_KEY"`.

```json
{ "requestId": "b011c34d-9bda-447c-bb8d-9e53f8d362dc", "error": "The form \"supportRequest\" defines no tasks." }
```

The form defines no task yet, so the UAG answers `400` and says so. Add a task (see [Concepts](/developers/concepts)) and call it again. Their answers are placeholders: to decide for real, enable a real engine such as `jev` or `claude` (see [Engines](/developers/engines)), which needs a `LICENSE_KEY` that includes the UAG, or a project on Form.io's hosted service.

## Next steps

- [How the UAG works](/developers): the architecture and the three usage patterns.
- [Connect Claude](/developers/connect-claude): talk to your forms from Claude Desktop.
- [Concepts](/developers/concepts): define a task on a form.
- [Agent API](/developers/agent-api): every endpoint, with examples.
- [Chat widget](/developers/chat): embed a form as a chat in your own page, with no license.
- [Workflows](/developers/workflows): run a task on every submission with the "Agent: Run task" action.
- [Agentic Coding Plugin](/developers/agentic-coding): let your coding agent tag forms, design tasks and wire your application.
