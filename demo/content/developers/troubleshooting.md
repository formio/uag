---
title: Troubleshooting
description: Symptoms mapped to their causes, for startup, the UAG's database, forms, authentication, MCP clients, the Agent API, Run task workflows, engines and licensing.
section: Operate
order: 90
---

Most UAG problems are configuration, and they surface far from their cause: a missing tag looks like a missing form, and an unlicensed database looks like a sign-in page that does not exist. Find the symptom below, then check the cause it names.

## First checks

| Check | How |
|---|---|
| Is it running, and which edition? | The log shows `[formio-uag] ... edition. Agentic Formflow ...` then `Form.io UAG server running on port 3200`. |
| Does the UAG use its database? | The startup log says `Using the database "uag"`, `No database (MONGO)`, or `The database (MONGO) is not used:` with the reason. `GET /agent/capabilities` reports `durableRuns`. |
| Is remote MCP sign-in on? | `GET /agent/capabilities` reports `mcpOAuth: true`, and `GET /.well-known/oauth-authorization-server` answers `200`. `/auth/token` for server-side clients is always on. |
| Which engines are on, and is Agentic Formflow allowed? | `GET /agent/capabilities` with a bearer token, or with `x-token`/`x-admin-key` from a server. |
| What did a request do? | Every Agent API response carries `X-Request-Id`. Search the UAG log for it. Set `DEBUG=formio:*` for detail. |
| What did a task run do? | With the database, open Action Logs in a portal stage connected to the UAG (classic portal). Without it, search the UAG log for `Run task "<task>" failed`. To see each field's `reason`, send the submission's data to the form's `{form}/agent/decide` or `{form}/agent/generate` with the task and `overwrite: true`; nothing is saved. |
| What is an agentic run doing right now? | Put the [flow viewer](https://github.com/formio/uag/tree/main/demo/flow) in front of the UAG and engine server. |

## Startup

| Symptom | Cause |
|---|---|
| The UAG exits with "No Form.io project could be loaded" | `PROJECT` is unreachable from inside the UAG container, or it is paired with the wrong credential: `ADMIN_KEY` for Open Source, `PROJECT_KEY` (plus a `LICENSE_KEY` when self-hosted Enterprise) for a project. Earlier log lines say why the load failed. |
| The UAG cannot reach the server at all, and every tool fails | `PROJECT` is an `https` URL with a self-signed certificate: set `NODE_TLS_REJECT_UNAUTHORIZED=0` (private deployments only). Otherwise `PROJECT` is a browser address, not a container-to-container one. |
| The UAG exits on first boot, then works after a restart | Form.io was not answering yet. Add a healthcheck and `depends_on: condition: service_healthy`, or raise `PROJECT_RETRIES`. |
| The UAG logs `401` right after starting | `PROJECT_KEY` is empty or wrong. In the demo stack, check the `setup` job's logs, then recreate the UAG container. |
| The UAG restart-loops with "Endpoint ... is not allowed for this license" | The license's endpoint allowlist does not include `PROJECT`'s host. Match the host to the license (trial licenses expect `api-server:3000`), or get a license for your endpoint. |
| "License is not configured" for a `*.form.io` project | The hosted SaaS exemption does not apply: TLS checks are weakened (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`), or the server could not confirm it is the hosted service. The message names which. |
| Startup stops naming an engine | That engine is misconfigured: its package is not installed, the name is duplicated, a required setting (such as an API key or model) is missing, or a `remote` instance's engine server refused its key or does not host it. |
| "@formio/uag needs @formio/appserver-core 2.24.1 or later" | An embedding application installs an older `@formio/appserver`, or its lockfile resolves an older core for it. Upgrade `@formio/appserver`. |
| Docker Compose fails with `set CLAUDE_API_KEY in .env` (or another `set ... in .env`) | A sample's `.env` is missing or incomplete. Copy `.env.example`; Compose validates every service even when you start only some. |

## The UAG's database

| Symptom | Cause |
|---|---|
| Startup stops: "The database ... holds uag-* collections that the UAG did not create" | `UAG_DATABASE` names a database whose `uag-*` collections belong to something else. Nothing was changed. Choose another `UAG_DATABASE`. |
| Startup stops: "The database ... was created by a newer UAG" | A newer UAG created its schema there. Upgrade this UAG, or choose another `UAG_DATABASE`. |
| Startup stops: "Could not connect to MONGO" | `MONGO` is unreachable from the UAG container, or its credentials are wrong. |
| Startup stops: "The MONGO user may not use the database" | Grant the `MONGO` user the `readWrite` role on `UAG_DATABASE`, or choose another database. |
| Startup stops: "MONGO_CONFIG is not valid JSON" | Fix the driver options in `MONGO_CONFIG`. |
| The log says "The database (MONGO) is not used: ... needs a license that includes ..." | No license that includes the UAG, and the project and the database are not both on development hosts. The UAG runs without the database features (remote MCP sign-in, run records, durable runs, the license grace period) and writes nothing to it. Add a `LICENSE_KEY` that includes the UAG. |
| The log says "MCP_OAUTH is set, but remote MCP sign-in is off" | Sign-in needs a usable database: `MONGO` is unset, or the line above refused it. |
| The log warns that the database "holds other data too" | `UAG_DATABASE` names a database with other collections, such as Form.io's. The UAG uses only its `uag-*` collections; a database of its own is recommended. |
| The licensed features turn off as soon as the license server is unreachable | Without the database there is no grace period. With it, the last confirmed license is trusted for 12 hours from the start of the outage. |

## Forms the agent cannot see

| Symptom | Cause |
|---|---|
| The agent says a form does not exist, or `get_forms` does not list it | The form is not tagged `uag`, or the change has not reached the UAG yet. Allow `PROJECT_TTL` seconds, or restart the UAG to re-register at once. |
| `{form}/agent/*` answers `404` "does not exist or is not tagged" | As above, or the URL names something other than the form's path or `form/{formId}` under the project's URL on the UAG (`/{projectName}` or `/project/{projectId}` on Enterprise and the hosted service). |
| `POST /agent/extract` (or `/agent/decide`, `/agent/generate`) at the UAG's root answers `404` | A form's operations are under the form: `POST {form}/agent/extract`, for example `https://uag.example.com/supportrequest/agent/extract`. Only `/agent/capabilities` is at the root. A `form` in the body is ignored. |
| A change saved in the portal has no effect | The project cache has not refreshed yet (`PROJECT_TTL`). Also confirm you saved the form (**Save Form**), not only the component. |
| A change to the module's template has no effect | The template only installs what the project lacks, matched by key; it never updates an existing form or action. Change it in the portal, through a stage deployment, or by posting the template to `/import`. Or start from an empty database. |
| A form deleted from the project comes back after a restart | It is in the module's template, and `TEMPLATE_SYNC=boot` reinstalls it. Remove it from the template, or set `TEMPLATE_SYNC=off`. |
| An agent's list of forms differs from the portal's | It shows what the signed-in user may see; forms without access are listed as such. |

## Authentication

| Symptom | Cause |
|---|---|
| `/.well-known/*` and `/auth/authorize` answer `404`, and a remote client cannot start sign-in | Remote MCP sign-in is off: `MCP_OAUTH` is not `true`, or the UAG has no usable database. The startup log says which. `/auth/token` is unaffected. |
| Every `/mcp` request returns `401` | The client sends no `Authorization: Bearer <token>`, or the token is not valid (expired, or signed with another `JWT_SECRET`). The `401` names `resource_metadata` only when remote MCP sign-in is on. |
| `/auth/token` returns `400` | The `client_id` prefix is wrong (`formio-oss-x-admin-key` for Open Source, `<project name>-x-token` for a project), or the secret does not match `ADMIN_KEY` or `PROJECT_KEY`. |
| A remote agent (claude.ai, a Claude Desktop connector) cannot authenticate | The discovery documents name a URL the agent cannot reach, often `http` behind a TLS proxy. Read `/.well-known/oauth-protected-resource`: behind a proxy, set `TRUST_PROXY` and forward `Host` and `X-Forwarded-Proto`, or set `BASE_URL` to the public HTTPS URL. |
| The login page says it cannot load the form | `LOGIN_FORM` does not point at a login form JSON endpoint the browser can reach. |
| Tokens stop working after a restart, or on another instance | `JWT_SECRET` is unset (a random one is generated at each start) or differs between instances. |
| A Form.io user token (`x-jwt-token`) is refused with `401` | Form.io's `/current` refused it: it expired, the user logged out, or Form.io could not be reached. A refusal is remembered for 10 seconds. |
| `mcp-remote` signs in as the wrong user | Delete `~/.mcp-auth` and sign in again. |
| A browser call to `{form}/agent/*` with a key returns `401` | Admin credentials are refused from browsers (`Origin` or `Sec-Fetch-Site` present). Send the signed-in user's Form.io token (`x-jwt-token`) instead. |
| `{form}/agent/*` returns `401` "Sign in to use this form's agent operations." | The request has no credential, and the form does not allow anonymous use: it needs `uagAnonymous: "true"`, and `AGENT_ANONYMOUS_RATE_LIMIT` and `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT` must not be `0`. Or send the user's Form.io token. |
| `{form}/agent/*` returns `403` "Anonymous visitors may not submit this form." | The form allows anonymous use, but the Anonymous role may not create its submissions. |
| `{form}/agent/*` returns `429` "Too many requests. Try again shortly." to anonymous visitors | Over the anonymous limits: `AGENT_ANONYMOUS_RATE_LIMIT` per client address (default 10 a minute) or `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT` in total (default 100 a minute), counted by each UAG process. Wait `Retry-After` seconds. Behind a reverse proxy without `TRUST_PROXY`, every visitor shares the proxy's address. |
| A portal team member's request through a connected stage returns `401` | Their team permission does not allow it: `team_read` and `team_access` may only read, and only `team_write`, `team_admin` and the owner may run a form's agent operations. See [Portal team members](/developers/security#portal-team-members). |
| `{form}/agent/*` returns `401` "Scoped tokens can only be used on /mcp." | A research token is being used to start work. Scoped tokens are only for a remote engine's calls back into `/mcp`. |

## Conversations over MCP

| Symptom | Cause |
|---|---|
| A chat app's every turn errors with a token message | `ADMIN_KEY` (or `PROJECT_KEY`) differs between the Form.io server, the UAG and the chat app; all must match. Or the UAG restarted without a fixed `JWT_SECRET`, so its earlier tokens no longer verify. |
| The chat app exits at startup | It cannot reach the UAG. Check the UAG's logs; on a slow first boot the UAG waits for Form.io. |
| The agent writes values the form rejects | Field descriptions or criteria are not specific enough. State units, formats and exact option values; the agent reads them through `get_field_info`. |
| The agent is refused an action the user expects to be allowed | The user's role lacks that permission on the form. Check the form's submission access. |
| The agent submits before the user confirms | The client's prompt does not require confirmation. Keep the `confirm_form_submission` step, and gate write tools on their annotations. |

## The Agent API

| Symptom | Cause |
|---|---|
| `403` with `code: "license_required"` | Agentic Formflow is not allowed here: no `LICENSE_KEY` (or `UAG_LICENSE`) that includes the UAG for the project's endpoint, and the project is not on Form.io's hosted service (a project on this machine, or an Open Source server, needs the license too). Conversation forms, and a form's chat, are unaffected. The startup log says so too. |
| `403` "You do not have ... access" | The caller lacks create access on the form. |
| `503` "No enabled engine can serve" | `UAG_ENGINES` is unset, or names no engine that can do the operation's work. |
| `400` naming the task | An unknown task (the message lists the form's tasks), extract with no `text` for a task with no input, or a `uagTools` entry that may write or does not exist. |
| `400` on decide with a `submissionId` | Decide works on the data in the request and saves nothing. To decide a stored submission's fields, run its task when it is saved, with an "Agent: Run task" action. |
| A call to `/agent/provide` fails | It was removed in 2.0. Use an "Agent: Run task" action on the form, or `{form}/agent/generate` and `{form}/agent/decide` on the submission's data. |
| `429` | The caller is over its `agentApi.rateLimits.caller` limit (wait `Retry-After` seconds), or every engine that could answer is over its own limit. |
| A field is `missing` | Read its `reason`: `not mentioned`, `the engine returned no value`, an engine failure, or `no enabled engine can answer`. |
| A field is always `uncertain` | Its answer changes when the options are reversed (rewrite ambiguous option labels, or set `uagOrderCheck: "false"`), the mention check is in the uncertain band, or `uagThreshold` is above what the engine reaches. Measure with `uag-eval`. |
| Decision fields come back `suggested`, `calibrated: false` | No decision engine is enabled, or it failed, so an agent engine answered as a fallback. |
| A field is never answered | It is in `excluded`: filled (send `overwrite`), hidden by conditionals, inside a Data Grid or Edit Grid, not requested by this operation, or another field's confidence companion. |
| Hiding a page wiped values that decided it | Set `clearOnHide: false` on the decision fields themselves. The setting on the page or panel does not protect them. |

## The chat widget

| Symptom | Cause |
|---|---|
| "This form is not available for chat." | The form is not tagged `uag`, or it was rendered from a definition without its `_id`. |
| `404` "The form "…" does not exist or is not tagged "uag"." | The UAG has not re-read the project since the form was tagged (`PROJECT_TTL`). Wait, or restart it. |
| `503` "No enabled engine can serve chat" | No agent engine is enabled. A decision engine alone cannot chat. |
| `403` on every turn | The caller cannot create the form's submissions, or the form sets `uagChat: "false"`. |
| `502` on a turn | Every engine that could answer failed or timed out. The UAG's log has the engines' errors under the response's `requestId`. |
| The chat never shows the summary | A required field is one the chat cannot collect (a data grid, a file, a nested form): the chat names it and opens the form. Or a value fails validation, and the reply asks again. |

More on [Chat widget](/developers/chat#troubleshooting).

## Run task and workflows

| Symptom | Cause |
|---|---|
| Nothing happens when a submission is created | The submission was sent straight to Form.io: Run task runs only for submissions sent to the UAG, so point the application's project URL at the UAG. Otherwise the action's **Methods** or conditions do not match, or its **Task** is not set. |
| A run after the save did nothing visible | It failed in the background, which never affects the submitter's response. The UAG logs `[formio-uag] Run task "<task>" failed for submission <id> of "<form>": <reason>`. With the database, the run is also recorded, and Action Logs in a connected classic portal stage show it with its error. A run that changes nothing saves nothing, and is recorded as such. |
| A run fails: "Form.io refused the token the UAG signed ... JWT_SECRET must be the same as Form.io Enterprise's" | The action names an agent role, and the UAG's `JWT_SECRET` differs from the Form.io server's. See [Project setup for agents](/developers/project-setup). |
| A run without an agent role fails with an authorization error | It acts with the submitter's own token, which expired or was logged out before the run. Give the action an agent role, or keep tokens valid for longer than a run takes. |
| A run fails: "The submission changed while its task was running, and again on the second try" | A person saved the submission while the task ran, and again after it started over. Nothing was saved. |
| `403` "You may not submit this form." | The form does not let the user's roles create submissions, and either the user has none of the action's **Submitter roles**, or the agent role lacks Create All on the form. |
| `500` "... its Run task actions name different agent roles." | Several Run task actions on the form run on create and name different agent roles. Give them one. |
| A run fails: "An agent cannot act with an admin role." | The action's agent role is an admin role. Use a role without admin access. |
| A save through the UAG is refused with `503` or `429` | A Run task that runs before the save and answers its decision fields only could not decide some of them, so it refused the submission rather than clear them. Nothing was stored. |
| A save through the UAG is refused with `403` and `code: "license_required"` | A Run task runs before the save without a license that includes the UAG. See [Deployment](/developers/deployment#licensing). |
| A value a client sent for a field is dropped | The field is marked `uagAuthoritative` and owned by a task of one of the form's Run task actions. The server decides it; on an update it keeps its stored value. |
| A browser-decided value was stored as the user sent it | The submission was saved straight to Form.io, where no task runs, or the field is not marked `uagAuthoritative`. |
| Runs after the save are lost when the UAG restarts | They are kept in memory: the UAG has no usable database (`durableRuns: false`), or the action names no agent role. |
| Closed-set fields are never saved | Only an agent engine is enabled, and its answers are uncalibrated. Add `uagAgentDecides: "true"` to those fields, or enable a decision engine. |
| The agent fills some fields but not others | The missing ones lack the task's `uag` value (directly or from a container), the value does not exactly match the task name, or they already had a value. |
| The submitter waits a long time after submitting | The Run task runs before the save. Agent runs take seconds to tens of seconds; set **When** to **After the save** unless the submitter needs the answer in the response. |
| Chained tasks run again and again, then stop with "5 runs in a row were each started by the save of the one before" | A Run task on update whose conditions stay true after its own save, with a task that changes something each time. The UAG stops such a chain after 5 runs and logs `Run task "<task>" was not run on submission <id>`. Add a condition on a field the task fills, such as "`awardLevel` is empty". |
| "Agent: Run task" opens as a blank page in the portal | The stage is not connected to the UAG, so the portal asks Form.io, which does not know the action. See [Connecting the Enterprise portal](/developers/deployment#connecting-the-enterprise-portal). |
| Action Logs show no task runs | The UAG has no usable database, the stage is not connected to the UAG, or you use the new portal, which reads Action Logs from its own API server. |

## Engines and engine servers

| Symptom | Cause |
|---|---|
| A remote engine fails with `401` | The UAG's `UAG_ENGINE_<NAME>_KEY` does not match the engine server's `UAG_ENGINE_SERVER_KEY`. |
| Startup says the engine server "does not host an engine named ..." | The instance name differs from the engine's name on the server. Set `UAG_ENGINE_<NAME>_ENGINE`. |
| No engine events appear in the flow viewer | The engines run inside the UAG, so no engine call passes through the proxy, or `UAG_ENGINE_<NAME>_URL` does not point at the proxy. |
| A researching extract shows no `/mcp` calls | The engine server cannot reach the UAG (check its `UAG_SERVER`), or the engine called no tool. |
| An engine server's `/mcp` request returns `401` | Its scoped token expired (research ran past `agentApi.research.timeout`, 2 minutes by default), or it was issued for another project. Or the caller has no identity to research with: anonymous visitors and portal team members below team admin cannot research through an engine server, and a signed-in user's Form.io token that has since expired is refused. |
| A tool call in research is refused | The model called a tool the task does not list in `uagTools`. Add it to the task if it is needed and read-only. |
| An engine is passed over with "does not support tool use" | The task lists `uagTools`, and that agent engine cannot call tools. Route the task to one that can, or remove the tools. |
| A local model through Ollama returns nothing useful | The model must support structured outputs, and tool calling for tasks that research. |

## Still stuck

Run one of the samples to confirm the environment itself is sound, then compare its configuration with yours:

- [Quickstart](/developers/quickstart) for a minimal stack.
- The [conversation form](https://github.com/formio/uag/tree/main/demo), [workflow](https://github.com/formio/uag/tree/main/demo) and [custom module](https://github.com/formio/uag/tree/main/demo/samples/custom-module) samples for each pattern.

To report a bug, include the UAG version, the `X-Request-Id` of a failing request and the matching log lines. Report security issues privately; see [Security](/developers/security#reporting-a-vulnerability).
