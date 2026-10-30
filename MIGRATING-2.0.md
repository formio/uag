# Migrating to UAG 2.0

UAG 2.0 is the first release of the Agent API and of the **Agent: Run task** action. If you run UAG 1.13 for local MCP clients and conversation forms, nothing you use changes: those need no license and no new configuration. Read on if you connect remote MCP clients (claude.ai, Claude Desktop connectors), set `MONGO`, call agents from Form.io webhooks, write modules, or tried the Agent API from the repository before 2.0.

## Applications can send submissions to the UAG

The UAG now forwards every submission it receives to Form.io, which saves it and runs the form's own actions (Save Submission, Webhook, Email, Login, Role, Group). The UAG runs only its own actions, so nothing runs twice. An application can use the UAG's URL as its project URL and change nothing else: login and registration are forwarded to Form.io, and a Form.io user token (`x-jwt-token`) works against the UAG as it does against Form.io. The UAG verifies it with Form.io and forwards it unchanged.

You only need to do this for forms with a Run task action: a task runs only for submissions sent to the UAG.

## Personas are now tasks

What a form defines with the `uag` property — a criteria component, an optional input, and the fields it fills — is now called a **task**. Form definitions do not change: `uag="finance"` now defines the `finance` task.

Requests, MCP tools and settings take `task`, and the earlier names are gone:

| Where | 1.x | 2.0 |
|---|---|---|
| Agent API request bodies | `persona` | `task`. A body that names `persona` and no `task` is refused with `400`. |
| `agent_provide`, `agent_decide` (MCP) | `persona` | `task` |
| MCP tool name | `agent_provide_data` | `agent_provide` (the same arguments and answer) |
| `@formio/uag-js` option (formerly the `@formio/uag-renderer` option) | `persona` | `task` |
| `uag-eval` | `--persona` | `--task`. `--persona` is refused. |

## Remote MCP clients

Remote MCP clients sign in through OAuth, which is now off unless you turn it on, and keeps its authorization codes in the UAG's own database instead of the project:

| 1.13 | 2.0 |
|---|---|
| OAuth sign-in always on, at `BASE_URL` | `MCP_OAUTH=true`, with the UAG's database (`MONGO`) and a license that includes the UAG. Without them the UAG starts with sign-in off, says why in its log, and `/auth/authorize` and `/.well-known/*` answer `404`. |
| `BASE_URL` required; without it `/auth/token` and `/.well-known/*` answered `404` | `BASE_URL` optional. The UAG derives its public URL from each request: the `Host` header, or `X-Forwarded-Proto` and `X-Forwarded-Host` when `TRUST_PROXY` is set. `BASE_URL` overrides it. |
| An "Authorization Codes" resource created in the project | Not created. Codes are stored, by their SHA-256 hash, in the `uag-authcodes` collection of the UAG's database, with the token each one exchanges for sealed under a key derived from the code. |

To upgrade a deployment that serves remote clients:

1. Set `MONGO` (see below) and `MCP_OAUTH=true`, with a `LICENSE_KEY` that includes the UAG. A project and a database both on development hosts (`localhost`, `*.localhost`, `lvh.me`, `*.local`) need no license.
2. Behind a reverse proxy, set `TRUST_PROXY` (`true`, a number of hops, or the proxy's addresses) for a proxy you control, and remove `BASE_URL` unless the derived URL is wrong.
3. Delete the "Authorization Codes" resource from the project. The UAG no longer reads or writes it.

`/auth/token` with the `client_credentials` grant, and API keys, need none of this: local MCP clients keep working with no `BASE_URL`, `MONGO` or `MCP_OAUTH`.

## `MONGO` is now the UAG's own database

In 1.13, `MONGO` (with `MONGO_CONFIG`) connected the UAG directly to a MongoDB database instead of routing submissions through Form.io's APIs. In 2.0 every submission goes through Form.io, and `MONGO` names a database of the UAG's own:

| Setting | Meaning |
|---|---|
| `MONGO` | The connection string. It can be the server Form.io uses; the database it names, if any, is ignored. |
| `UAG_DATABASE` | The database used on that connection. Default `uag`. |
| `MONGO_CONFIG` | Driver options, as JSON. |
| `TASK_RUN_RETENTION_DAYS` | Days run records are kept. Default `90`; `0` keeps them forever. |

The database holds only `uag-meta`, `uag-authcodes` and `uag-taskruns`, never submissions. At startup the UAG checks it before writing: a database with `uag-*` collections the UAG did not create, or created by a newer UAG, stops startup, naming the database. It enables remote MCP sign-in, run records shown in a connected portal stage's Action Logs, runs after the save that survive a restart, and the license grace period (12 hours; without the database there is none).

Using it needs a license that includes the UAG, on every edition and on Form.io's hosted service, unless the project and the database are both on development hosts. Without the license the UAG still starts, with the database features off; it writes nothing to the database, and says why in its log. If you set `MONGO` for 1.13 and do not want the database, unset it.

## Webhooks become "Agent: Run task"

`/agent/provide` is removed, and with it the webhook pattern built on it. The **Agent: Run task** action replaces it: it runs a task on a submission sent to the UAG, and after the save it saves the results as an update through the UAG, so the form's update actions, including other Run task actions, run on it. Tasks chain by their conditions, as webhooks did.

For each form whose webhooks call the UAG (`/agent/provide`) or the retired Claude integration (`/agent/claude/agent_provide_data`):

1. **Send its submissions to the UAG.** Point the application's project URL at the UAG instead of Form.io. A submission sent straight to Form.io runs no task.
2. **Replace each webhook with Run task.** Add "Agent: Run task" with the webhook's task, **Answer** set to the whole task, **When** set to after the save, and the webhook's method (create or update). On Form.io Enterprise, add it in a portal stage connected to the UAG (`PORTAL_SECRET`; see [Deployment → Connecting the Enterprise portal](https://ai.form.io/developers/deployment#connecting-the-enterprise-portal)). On Open Source, add it with Form.io's action API (`POST /form/{formId}/action`) or in a module's project template. Then delete the webhook: the UAG no longer serves `/agent/provide`.
3. **Keep the conditions.** Copy each webhook's condition onto its Run task action, including the condition on a field the task sets that keeps an update action from running again on the task's own save. Form.io's condition lists (`all` or `any`) work as they do on any action.
4. **Mark the agent's fields `uagAuthoritative: "true"`.** Decision and value fields alike; a field's `uagConfidenceField` is owned with it. The UAG then removes them from what a client sends, for every Run task action on the form, and on an update they keep their stored value. Fields without it stay editable, so a person's correction is kept.

Run task never substitutes the UAG's project API key for the caller's credential. Without an **Agent role** it saves with the credential the submission was sent with (a user's token needs update permission on their own submission); with one, on Form.io Enterprise with the same `JWT_SECRET`, it acts for the user with that role. See [Project setup for agents](https://ai.form.io/developers/project-setup).

What changes in behavior, coming from the Claude integration:

- **Each task fills only its own fields.** The integration let the model write any field. Check that no task's criteria tell it to set a field flagged for another task.
- **The UAG saves once, and only what changed.** The engines answer the task's fields; the UAG validates the values with the form and saves them as one update. A value field is filled only while it is empty, and a run that changes nothing saves nothing.
- **Closed-set fields are decided**, with a decision engine when one is enabled, and reconciled with what is stored.
- **The submitter does not wait.** A run after the save starts once Form.io has answered. Its failures never affect the response; they are logged, and recorded when the UAG has its database.

The UAG needs an engine enabled (for example `UAG_ENGINES=claude` with `CLAUDE_API_KEY`) and a Form.io license that includes the UAG in `LICENSE_KEY` (the variable the Enterprise and PDF servers use; `UAG_LICENSE` still works, but is deprecated), or a project on Form.io's hosted service. See [License](README.md#license).

To run a task again on stored submissions, save them again through the UAG.

## The Claude integration is retired

`integrations/claude` (`@formio/uag-claude` 1.x, `formio/uag-claude`) is retired in 2.0. From 2.0.0, the npm name `@formio/uag-claude` carries the Claude *engine*, which runs inside the UAG 2.x and is not a server; if you install the integration from npm, pin `@formio/uag-claude@^1`. The engine's README maps the 1.x settings to 2.0 under [Upgrading from 1.x](https://github.com/formio/uag/blob/main/engines/claude/README.md#upgrading-from-1x), and npm marks 1.x deprecated once 2.0.0 is published. Its 1.3.x release gets security fixes only, from the `1.x` branch. Its `agent_provide_data` webhooks need UAG 1.x, since 2.0 removed that tool: move them to Run task before upgrading the UAG. Its direct commands drive a model over the UAG's other MCP tools, which 2.0 still serves.

| Integration | 2.0 |
|---|---|
| A webhook to `POST /agent/claude/agent_provide_data` | An "Agent: Run task" action after the save (above). |
| `POST /agent/claude/collect_field_data` | `POST {form}/agent/extract` on the UAG, under the form's URL (see [The Agent API](#the-agent-api-if-you-tried-it-before-20)). |
| `POST /agent/claude` with `{ command }` | No Agent API equivalent: connect an MCP client to `/mcp`, where Form.io permissions apply to every tool call. |
| The integration container holding the Claude key | Either the `claude` engine in the UAG (`UAG_ENGINES=claude`, `CLAUDE_API_KEY`), or a `formio/uag-engines` container holding the key, reached with `UAG_ENGINES=claude:remote` (see [Engines](#engines)). |

## Engines

Engines are npm packages, enabled as named instances of a type. The `formio/uag` image includes `jev`, `claude`, `openai`, `grok` and `gemini`.

| Before | 2.0 |
|---|---|
| `UAG_ENGINES=jev,claude` | Unchanged: a bare name is an instance named after its type. |
| — | `UAG_ENGINES=jev,fast:claude,deep:claude`, with `UAG_ENGINE_FAST_MODEL`, `UAG_ENGINE_DEEP_MODEL` and so on: one type, several instances. |
| `server.use(JevEngine({ ... }))` in an embedding application | `new UAGServer({ engines: ['jev'] })`, or `{ name, type, options }` entries. The type may be a package name or an engine type definition; types can also be registered by name in `engineTypes`. |
| `UAG_ENGINES=remote` with `UAG_REMOTE_AGENT_URL` (the integration) | A `formio/uag-engines` container (`UAG_ENGINES=claude`, `CLAUDE_API_KEY`, `UAG_ENGINE_SERVER_KEY`, `UAG_SERVER`), and on the UAG `UAG_ENGINES=claude:remote`, `UAG_ENGINE_CLAUDE_URL` and `UAG_ENGINE_CLAUDE_KEY`. The UAG sends the engine server only its key, never a Form.io credential. |

A third-party engine is a package named `uag-engine-<type>`: install it in a derived image, or mount it and list the directory in `UAG_ENGINE_PATH`.

## Modules

- **Platform actions are not run by the UAG.** Actions that Form.io implements are marked `platform: true`: `save`, `login`, `role`, `webhook`, `email` and `group`. The UAG skips them, since Form.io runs its own when the submission reaches it; a module's own actions run as before. Mark an action of your module `platform: true` if Form.io runs it.
- **Overriding a platform action by name.** A module action registered under the name of one of Form.io's actions (its own `webhook`, say) is not run by the UAG either: Form.io runs its own action of that name on the forwarded submission, and running both would do the work twice. Give a module action a name of its own to have the UAG run it.
- **Who a submission is forwarded as.** A `before:access:<op>` hook can set `req.forwardAuth` to the identity the submission is checked and forwarded as, instead of the caller's.
- **`FormInterface.submit(submission, auth, request)`** takes a third argument: extra request fields for the submission's request.

## The Agent API, if you tried it before 2.0

The Agent API is stateless: its operations answer a task's fields from the data they are given, read no stored submission, and save nothing. They are now under the form, as its submissions are: `{form}` is the form's path, or `form/{formId}`, under the project's URL on the UAG (the UAG's root on Form.io Open Source; `/{projectName}` or `/project/{projectId}` on Enterprise and the hosted service).

| Before | 2.0 |
|---|---|
| `POST /agent/{operation}` at the UAG's root, with `form` in the body | `POST {form}/agent/{operation}`, for example `https://uag.example.com/supportrequest/agent/decide` (Open Source) or `https://uag.example.com/myproject/supportrequest/agent/decide`. The root operations answer `404`, and a `form` in the body is ignored. `GET /agent/capabilities` stays at the root. |
| A UAG bearer token or a server key | The form's own credentials as well: the signed-in user's Form.io token (`x-jwt-token`) or a portal remote token (`x-remote-token`). UAG bearer tokens and server keys (`x-token`, `x-admin-key`, refused from browsers) still work. A form with `uagAnonymous: "true"` that lets Anonymous create answers visitors with no credential, within `AGENT_ANONYMOUS_RATE_LIMIT` and `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT`. |
| `persona` in the body | Not accepted: send `task`. |
| `/agent/decide` with `data` | `{form}/agent/decide` (saves nothing) |
| `/agent/decide` with `submissionId` | `400`. Add Run task to the form, and save the submission through the UAG. |
| `/agent/provide` (and its `formName` alias) | Removed. An "Agent: Run task" action, after the save (above). |
| The `agentDecide` action | Removed. An "Agent: Run task" action with the same task, **Answer** set to its decision fields only, and **When** set to before the save. A decision it cannot make refuses the save with `503` (`429` when every engine is over its rate limit), as `agentDecide` did. |
| — | `{form}/agent/generate`: a task's open values from `data`, saving nothing |
| `/agent/extract` | `{form}/agent/extract`, which also takes plain `text` |
| `/agent/run` | Removed. Connect an MCP client (Claude Desktop, Claude Code, or your own) to `/mcp`, where Form.io permissions apply to every tool call. |
| capabilities `tasks` | capabilities `operations`, plus `durableRuns` and `mcpOAuth` |

Only extract streams. To get decisions and values for the same data, call `decide` and `generate` at the same time.

**No model holds a write tool any more.** If a task needs to look things up (another submission, external data), list read-only tools on its criteria component with `uagTools`, for example `uagTools: "find_submissions"`. Tools run with the caller's identity (for Run task, the user who submitted); none are given by default.

Configuration:

| Before | 2.0 |
|---|---|
| `routing.provide`, `routing.run` | Removed: a task's fields route like any field, through `routing.decision` and `routing.value`. |
| `agentApi.provide.timeout`, `agentApi.run.timeout` | `routing.timeouts` per engine, and `agentApi.research.timeout` (default 120000) for engines that research. |
| `agentApi.provide.maxIterations`, `agentApi.run.maxIterations` | `agentApi.research.maxIterations` (default 10). |
| `agentApi.run.tools` | Removed. |
| `agentApi.rateLimits.caller` keyed by task | Keyed by operation: `extract`, `decide`, `generate`. |
| `CLAUDE_RUN_EFFORT` | `CLAUDE_RESEARCH_EFFORT`. |

Task-scoped tokens are now **scoped tokens**: they carry the caller's identity (their own token, sealed so the engine server cannot read it) and a task's read-only research tools only, are issued only for research, and are honored only by the project they were issued for.

## The renderer plugin is now `@formio/uag-js`

The unpublished `@formio/uag-renderer` (the repository's `renderer` folder) is replaced by the published `@formio/uag-js` 2.x, in `packages/uag-js`. You register it once instead of attaching it to each form, and it uses the signed-in user's Form.io token instead of a UAG token:

```js
import { UAG } from '@formio/uag-js';   // or the browser global FormioUAG
Formio.use(UAG('https://uag.example.com'));
```

Forms tagged `uag` then save through the UAG, and get Agent Input when one of their tasks has an input. Other forms, and every other request, still go to Form.io. Routing in the browser is not a security boundary: keep the agent's fields safe with an agent role, the form's permissions and `uagAuthoritative`.

| `@formio/uag-renderer` | `@formio/uag-js` |
|---|---|
| `UAGAgent.attach(form, options)` on each form | `Formio.use(UAG(uagUrl, options))` once; `UAG.attach(form, options)` to attach Agent Input by hand |
| `uag-renderer.css` | `uag-js.css` |
| `baseUrl` | The UAG's URL, given to `UAG()`. `UAG.attach` takes `formUrl`, the form's URL on the UAG or a relay of your own. |
| `formName` | Removed. The module addresses each form on the UAG by its id. |
| `getToken` | Removed. Requests carry the credential formio.js already sends to Form.io: the user's `x-jwt-token`, or none for a visitor (see `uagAnonymous`). |
| `persona` | Removed: use `task`. |
| `trigger` | The same values. On forms attached when registered, the default is `next` for wizards and `blur` otherwise; `UAG.attach` still defaults to `blur`. |
| `task`, `pauseMs`, `nextTimeoutMs`, `fetch`, `onStart`, `onResult`, `onError`, `onDone` | Unchanged. |

See [JavaScript (formio.js)](https://ai.form.io/developers/renderer).

## The demo's conversation runs in the UAG

If you run the demo site (`demo/`), its Conversation Forms page now embeds the form with `Formio.createChat` from `@formio/uag-js`, and each turn is the UAG's `{form}/agent/chat`. The demo server no longer calls a model:

| Before | Now |
|---|---|
| `POST /api/conversation/chat` (`{ message }`), `GET /api/conversation/forms` | `GET /api/conversation/uag/{formPath}`, `POST /api/conversation/uag[/project/{id}]/form/{id}/agent/chat` and `.../submission`: stand-ins for the UAG's own routes, for the one chat form. `POST /api/conversation/reset` stays. |
| `CLAUDE_API_KEY`, `CHAT_MODEL`, `CHAT_MAX_TOKENS`, `CHAT_MAX_TOOL_ITERATIONS`, `CHAT_MAX_HISTORY_CHARS` on the site | Not read. The model is the UAG's agent engine (`CLAUDE_API_KEY` and `CLAUDE_MODEL` on the engine server). |
| `CHAT_FORMS` (a list) | `CHAT_FORM` (one form, default `serviceRequest`). |

To offer the same chat in your own application, see [Chat widget](https://ai.form.io/developers/chat): it needs only the UAG, with an agent engine, and no license.

## Rolling back

Pin `formio/uag:1.13` (or the last 1.x). Stored submissions are unchanged; the `metadata.uag` provenance 2.0 adds is ignored by 1.x. Before you start 1.x, unset `MONGO` (1.x would use it as a database for submissions) and `MCP_OAUTH`, set `BASE_URL` again, and restore the webhooks you replaced with Run task actions.
