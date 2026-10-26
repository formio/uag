# Migrating to UAG 2.0

UAG 2.0 is the first release of the Agent API. If you run UAG 1.13 for MCP clients and conversation forms, nothing you use changes: those need no license and no configuration. This guide is for deployments that call agents from Form.io webhooks, and for anyone who tried the Agent API from the repository before 2.0.

## Personas are now tasks

What a form defines with the `uag` property — a criteria component, an optional input, and the fields it fills — is now called a **task**. Form definitions do not change: `uag="finance"` now defines the `finance` task.

Requests, MCP tools and settings take `task`. The earlier name still works until a future major release:

| Where | New | Still accepted |
|---|---|---|
| Agent API request bodies | `task` | `persona` |
| `/agent/provide` | `form` | `formName` |
| `agent_provide`, `agent_decide` (MCP) | `task` | `persona` |
| MCP tool name | `agent_provide` | `agent_provide_data` (same arguments and answer) |
| `agentDecide` action setting | `task` | `persona` |
| Renderer option | `task` | `persona` |
| `uag-eval` | `--task` | `--persona` |

Sending both names with different values is refused with `400`. The UAG logs one deprecation notice for each kind of use.

## The Claude integration is retired

`integrations/claude` (`@formio/uag-claude` 1.x, `formio/uag-claude`) is retired in 2.0. From 2.0.0, the npm name `@formio/uag-claude` carries the Claude *engine*, which runs inside the UAG 2.x and is not a server; if you install the integration from npm, pin `@formio/uag-claude@^1`. Its 1.3.x release keeps working against UAG 2.0 — its commands and its `agent_provide_data` webhooks behave as they did against 1.13 — and gets security fixes only, from the `1.x` branch. Move off it when you can:

| Integration | 2.0 |
|---|---|
| `POST /agent/claude/agent_provide_data` | `POST /agent/provide` on the UAG, with the same body (below). |
| `POST /agent/claude/collect_field_data` | `POST /agent/extract` on the UAG. |
| `POST /agent/claude` with `{ command }` | No Agent API equivalent: connect an MCP client to `/mcp`, where Form.io permissions apply to every tool call. |
| The integration container holding the Claude key | Either the `claude` engine in the UAG (`UAG_ENGINES=claude`, `CLAUDE_API_KEY`), or a `formio/uag-engines` container holding the key, reached with `UAG_ENGINES=claude:remote` (see [Engines](#engines)). |

### Webhooks

A Form.io webhook that called the Claude integration's `/agent/claude/agent_provide_data` can call the UAG instead, with the same payload, by changing only its URL:

```
http://formio-uag-claude:3300/agent/claude/agent_provide_data   →   http://formio-uag:3200/agent/provide
```

The UAG needs an engine enabled (for example `UAG_ENGINES=claude` with `CLAUDE_API_KEY`) and a Form.io license that includes the UAG in `LICENSE_KEY` (see [License](README.md#license)) (the variable the Enterprise and PDF servers use; `UAG_LICENSE` still works, but is deprecated). What changes in behavior:

- **Each task fills only its own fields.** The integration let the model write any field. Check that no task's criteria tell it to set a field flagged for another task.
- **The UAG saves, once.** The model answers the task's fields; the UAG validates the values and saves the submission once, and only when something changed. A value field is filled only while it is empty, so a webhook that the task's own save triggers does nothing the second time.
- **Closed-set fields are decided**, with a decision engine when one is enabled, and reconciled as the `agentDecide` action does (see the README's Agent API section).
- **A form with several tasks needs `task`** (or `persona`) in the payload; the old default, the form's first task, is gone for this endpoint.

## Engines

Engines are npm packages, enabled as named instances of a type. The `formio/uag` image includes `jev`, `claude` and `openai`.

| Before | 2.0 |
|---|---|
| `UAG_ENGINES=jev,claude` | Unchanged: a bare name is an instance named after its type. |
| — | `UAG_ENGINES=jev,fast:claude,deep:claude`, with `UAG_ENGINE_FAST_MODEL`, `UAG_ENGINE_DEEP_MODEL` and so on: one type, several instances. |
| `server.use(JevEngine({ ... }))` in an embedding application | `new UAGServer({ engines: ['jev'] })`, or `{ name, type, options }` entries. The type may be a package name or an engine type definition; types can also be registered by name in `engineTypes`. |
| `UAG_ENGINES=remote` with `UAG_REMOTE_AGENT_URL` (the integration) | A `formio/uag-engines` container (`UAG_ENGINES=claude`, `CLAUDE_API_KEY`, `UAG_ENGINE_SERVER_KEY`, `UAG_SERVER`), and on the UAG `UAG_ENGINES=claude:remote`, `UAG_ENGINE_CLAUDE_URL` and `UAG_ENGINE_CLAUDE_KEY`. The UAG sends the engine server only its key, never a Form.io credential. |

A third-party engine is a package named `uag-engine-<type>`: install it in a derived image, or mount it and list the directory in `UAG_ENGINE_PATH`.

## The Agent API, if you tried it before 2.0

The endpoints were reorganised around what each one does, and whether it saves:

| Before | 2.0 |
|---|---|
| `/agent/decide` with `data` | `/agent/decide` (unchanged, saves nothing) |
| `/agent/decide` with `submissionId` | `/agent/provide` with the same body: decides and reconciles, and also fills the task's empty value fields |
| `/agent/provide` (a tool loop that wrote through `submission_update`) | `/agent/provide`: the model answers, the UAG saves once |
| — | `/agent/generate`: a task's open values from `data`, saving nothing |
| `/agent/extract` | `/agent/extract`, which also takes plain `text` |
| `/agent/run` | Removed. Connect an MCP client (Claude Desktop, Claude Code, or your own) to `/mcp`, where Form.io permissions apply to every tool call. |
| capabilities `tasks` | capabilities `operations` |

Only extract streams. To get decisions and values for the same data, call `decide` and `generate` at the same time.

**No model holds a write tool any more.** If a task needs to look things up (another submission, external data), list read-only tools on its criteria component with `uagTools`, for example `uagTools: "find_submissions"`. Tools run with the caller's identity; none are given by default.

Configuration:

| Before | 2.0 |
|---|---|
| `routing.provide`, `routing.run` | Removed: provide routes like any field, through `routing.decision` and `routing.value`. |
| `agentApi.provide.timeout`, `agentApi.run.timeout` | `routing.timeouts` per engine, and `agentApi.research.timeout` (default 120000) for engines that research. |
| `agentApi.provide.maxIterations`, `agentApi.run.maxIterations` | `agentApi.research.maxIterations` (default 10). |
| `agentApi.run.tools` | Removed. |
| `agentApi.rateLimits.caller` keyed by task | Keyed by operation: `extract`, `decide`, `generate`, `provide`. |
| `CLAUDE_RUN_EFFORT` | `CLAUDE_RESEARCH_EFFORT`. |

Task-scoped tokens are now **scoped tokens**: they carry the caller's identity and a task's read-only research tools only, and are issued only for research.

## Rolling back

Pin `formio/uag:1.13` (or the last 1.x). Stored submissions are unchanged; the `metadata.uag.generated` provenance 2.0 adds is ignored by 1.x.
