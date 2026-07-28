# Example: UAG Flow Viewer

<sub>[Form.io UAG](../../README.md) &rsaquo; this page</sub>

A tiny logging reverse proxy that makes an agentic run visible while it happens. Drop it in front of the UAG and you get a live page showing every leg of the run: the token request, `tools/list`, each `tools/call` with its arguments, the streamed response, and the write-back that ends it.

It exists because an autonomous agent is otherwise opaque. When a submission does not get filled in, the useful question is *how far did it get* — did the integration authenticate, did it see the form, did it call `submission_update` and get rejected? This answers that in one screen instead of three sets of container logs.

![The agentic process flow](../images/agent-flow.png)

Zero npm dependencies, two files, about 260 lines. It is a debugging and demo aid, not a production component.

## How it works

The proxy listens on port 3250 and splits traffic three ways:

| Path | Goes to | What you learn |
|---|---|---|
| `/agent/*` | the integration (`formio-uag-claude:3300`) | the webhook leg — which form, which persona, which submission |
| `/flow`, `/flow/events`, `/flow/history` | served by the proxy itself | the viewer page, its SSE stream, and the event history as JSON |
| everything else | the UAG (`formio-uag:3200`) | the auth leg (`/auth/token`, `/.well-known/*`) and the entire MCP leg |

Because both legs pass through one process, the viewer can correlate them: you see the webhook arrive, then the MCP conversation it triggered, in order, with timings and status codes.

Environment variables, all optional:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3250` | Port the proxy listens on. |
| `UAG_HOST` | `formio-uag` | Hostname of the UAG. Port is fixed at 3200. |
| `CLAUDE_HOST` | `formio-uag-claude` | Hostname of the integration. Port is fixed at 3300. |
| `DATA_FILE` | *(unset)* | When set, events are also appended as JSON lines, e.g. `/data/events.jsonl`. Mount a volume for it. |

## Adding it to a deployment

Three things change: add the service, and point both the webhook actions and the integration at it instead of at the UAG directly. Using [examples/agentic-workflow](../agentic-workflow) as the base:

**1. Add the service** to `docker-compose.yml`:

```yml
  uag-flow:
    build: ../flow-viewer
    container_name: uag-example-flow
    restart: always
    links:
      - formio-uag
      - formio-uag-claude
    ports:
      - "3250:3250"
```

**2. Route the integration through it.** In the `formio-uag-claude` service, and in `formio-uag` so the address it publishes matches the address its client actually uses:

```yml
  formio-uag:
    environment:
      BASE_URL: http://uag-flow:3250      # was http://formio-uag:3200

  formio-uag-claude:
    environment:
      UAG_SERVER: http://uag-flow:3250    # was http://formio-uag:3200
```

`BASE_URL` has to follow `UAG_SERVER` here. It is published in the `.well-known` discovery documents and used for auth callbacks, so if the client reaches the UAG through the proxy, that is the URL the UAG should be advertising.

**3. Route the webhooks through it.** In `module/project.json`, change the webhook action URLs from `http://formio-uag-claude:3300/...` to:

```json
"url": "http://uag-flow:3250/agent/claude/agent_provide_data"
```

Then `docker compose up -d --build`, open http://localhost:3250/flow, and submit something. Events stream in as the run proceeds.

## Reading the output

Each request produces a `request` event and a `response` event sharing a `reqId`, with `kind` set to `auth`, `mcp`, `webhook`, or `other`. Streamed MCP responses also emit interim `chunk` events so a long tool call does not look stalled. Click any event to see its captured body, truncated to 8KB.

A healthy `agent_provide_data` run looks roughly like this:

```
webhook → agent_provide_data     form=application persona=admissions submission=…
auth: token                      token issued
mcp: initialize
mcp: tools/list
tool: agent_provide_data         {"formName":"application","submissionId":"…","persona":"admissions"}
tool: submission_update          {"formName":"application","submissionId":"…","data":{…}}
```

Useful failure signatures:

- **The webhook leg appears but no `auth: token` follows** — the integration could not reach the UAG at all. Check `UAG_SERVER`.
- **`auth: token` returns 404** — `BASE_URL` is not set on the UAG, so the authentication provider is not enabled and the token endpoint does not exist.
- **`tools/list` succeeds but `agent_provide_data` reports the form does not exist** — the form is missing the `uag` tag, or `PROJECT_TTL` has not elapsed since it was added.
- **`submission_update` returns 4xx** — the agent produced data the form rejected. The response body shows the validation errors, which usually means the criteria told it to write a value the field does not allow.

## Caveats

- No authentication on `/flow`, and captured bodies include the `Authorization` bearer token and any webhook API keys. Keep it on a private network and do not expose the port publicly.
- Bodies are truncated at 8KB per event and only the last 500 events stay in memory. Set `DATA_FILE` if you need the full history.
- It buffers each request body before forwarding, so it is not suitable for large file uploads.
