---
title: Troubleshooting
description: Symptoms mapped to their causes, for startup, forms, authentication, MCP clients, the Agent API, workflows, engines and licensing.
section: Operate
order: 90
---

Most UAG problems are configuration, and they surface far from their cause: a missing tag looks like a missing form, and a missing `BASE_URL` looks like a permissions error. Find the symptom below, then check the cause it names.

## First checks

| Check | How |
|---|---|
| Is it running, and which edition? | The log shows `[formio-uag] ... edition. Agentic Formflow ...` then `Form.io UAG server running on port 3200`. |
| Is authentication enabled? | `GET {BASE_URL}/.well-known/oauth-authorization-server` answers `200`. A `404` means `BASE_URL` is not set. |
| Which engines are on, and is Agentic Formflow allowed? | `GET /agent/capabilities` with a bearer token, or with `x-token`/`x-admin-key` from a server. |
| What did a request do? | Every Agent API response carries `X-Request-Id`. Search the UAG log for it. Set `DEBUG=formio:*` for detail. |
| What did a task answer, and why? | Call `/agent/provide` by hand on the submission (it saves nothing if nothing changes) and read each field's `reason`. |
| What is an agentic run doing right now? | Put the [flow viewer](https://github.com/formio/uag/tree/main/demo/flow) in front of the UAG and engine server. |

## Startup

| Symptom | Cause |
|---|---|
| The UAG exits with "No Form.io project could be loaded" | `PROJECT` is unreachable from inside the UAG container, or it is paired with the wrong credential: `ADMIN_KEY` for Open Source, `PROJECT_KEY` (plus a `LICENSE_KEY` when self-hosted Enterprise) for a project. Earlier log lines say why the load failed. |
| The UAG cannot reach the server at all, and every tool fails | `PROJECT` is an `https` URL with a self-signed certificate: set `NODE_TLS_REJECT_UNAUTHORIZED=0` (private deployments only). Otherwise `PROJECT` is a browser address, not a container-to-container one. |
| The UAG exits on first boot, then works after a restart | Form.io was not answering yet. Add a healthcheck and `depends_on: condition: service_healthy`, or raise `PROJECT_RETRIES`. |
| The UAG logs `401` right after starting | `PROJECT_KEY` is empty or wrong. In the demo stack, check the `setup` job's logs, then recreate the UAG container. |
| The UAG restart-loops with "Endpoint ... is not allowed for this license" | The license's endpoint allowlist does not include `PROJECT`'s host. Match the host to the license (trial licenses expect `api-server:3000`), or get a license for your endpoint. |
| "License is not configured" for a `*.form.io` project | The hosted SaaS exemption does not apply: the UAG has `MONGO` set, TLS checks are weakened (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA`), or the server could not confirm it is the hosted service. The message names which. |
| Startup stops naming an engine | That engine is misconfigured: its package is not installed, the name is duplicated, a required setting (such as an API key or model) is missing, or a `remote` instance's engine server refused its key or does not host it. |
| "Two copies of @formio/appserver-core are installed" | An embedding application resolves two versions. Upgrade `@formio/appserver` to 2.20.0 or later and deduplicate (`yarn dedupe @formio/appserver-core`). |
| Docker Compose fails with `set CLAUDE_API_KEY in .env` (or another `set ... in .env`) | A sample's `.env` is missing or incomplete. Copy `.env.example`; Compose validates every service even when you start only some. |

## Forms the agent cannot see

| Symptom | Cause |
|---|---|
| The agent says a form does not exist, or `get_forms` does not list it | The form is not tagged `uag`, or the change has not reached the UAG yet. Allow `PROJECT_TTL` seconds, or restart the UAG to re-register at once. |
| `/agent/*` answers `404` "does not exist or is not tagged" | As above, or `form` names something other than the form's name or path. |
| A change saved in the portal has no effect | The project cache has not refreshed yet (`PROJECT_TTL`). Also confirm you saved the form (**Save Form**), not only the component. |
| A change to the module's template has no effect | The template only installs what the project lacks, matched by key; it never updates an existing form or action. Change it in the portal, through a stage deployment, or by posting the template to `/import`. Or start from an empty database. |
| A form deleted from the project comes back after a restart | It is in the module's template, and `TEMPLATE_SYNC=boot` reinstalls it. Remove it from the template, or set `TEMPLATE_SYNC=off`. |
| An agent's list of forms differs from the portal's | It shows what the signed-in user may see; forms without access are listed as such. |

## Authentication

| Symptom | Cause |
|---|---|
| `/auth/token` returns `404`, and `/.well-known/*` is missing | `BASE_URL` is not set. The authentication provider exists only when it is. |
| Every `/mcp` request returns `401` | `BASE_URL` is unset, or the client sends no `Authorization: Bearer <token>`. |
| `/auth/token` returns `400` | The `client_id` prefix is wrong (`formio-oss-x-admin-key` for Open Source, `<project name>-x-token` for a project), or the secret does not match `ADMIN_KEY` or `PROJECT_KEY`. |
| A remote agent (claude.ai, a Claude Desktop connector) cannot authenticate | `BASE_URL` is not a public HTTPS URL the agent can reach. The agent reads it from the discovery documents and follows it. |
| The login page says it cannot load the form | `LOGIN_FORM` does not point at a login form JSON endpoint the browser can reach. |
| Tokens stop working after a restart, or on another instance | `JWT_SECRET` is unset (a random one is generated at each start) or differs between instances. |
| `mcp-remote` signs in as the wrong user | Delete `~/.mcp-auth` and sign in again. |
| A browser call to `/agent/*` with a key returns `401` | Admin credentials are refused from browsers (`Origin` or `Sec-Fetch-Site` present). Use the user's bearer token. |
| `/agent/*` returns `401` "Scoped tokens can only be used on /mcp." | A research token is being used to start work. Scoped tokens are only for a remote engine's calls back into `/mcp`. |

## Conversations over MCP

| Symptom | Cause |
|---|---|
| A chat app's every turn errors with a token message | `BASE_URL` is unset on the UAG, or `ADMIN_KEY` differs between the Form.io server, the UAG and the chat app. All must match. |
| The chat app exits at startup | It cannot reach the UAG. Check the UAG's logs; on a slow first boot the UAG waits for Form.io. |
| The agent writes values the form rejects | Field descriptions or criteria are not specific enough. State units, formats and exact option values; the agent reads them through `get_field_info`. |
| The agent is refused an action the user expects to be allowed | The user's role lacks that permission on the form. Check the form's submission access. |
| The agent submits before the user confirms | The client's prompt does not require confirmation. Keep the `confirm_form_submission` step, and gate write tools on their annotations. |

## The Agent API

| Symptom | Cause |
|---|---|
| `403` with `code: "license_required"` | Agentic Formflow is not allowed here: no `LICENSE_KEY` (or `UAG_LICENSE`) that includes the UAG for the project's endpoint, and the project is not on Form.io's hosted service (a project on this machine, or an Open Source server, needs the license too). Conversation forms are unaffected. The startup log says so too. |
| `403` "You do not have ... access" | The caller lacks create or update access (update, for provide) on the form. |
| `503` "No enabled engine can serve" | `UAG_ENGINES` is unset, or names no engine that can do the operation's work. |
| `400` naming the task | An unknown task (the message lists the form's tasks), a form with several tasks and no `task` on provide, extract with no `text` for a task with no input, or a `uagTools` entry that may write or does not exist. |
| `400` on decide with a `submissionId` | Decide never touches stored submissions. Use `/agent/provide`. |
| `429` | The caller is over its `agentApi.rateLimits.caller` limit (wait `Retry-After` seconds), or every engine that could answer is over its own limit. |
| A field is `missing` | Read its `reason`: `not mentioned`, `the engine returned no value`, an engine failure, or `no enabled engine can answer`. |
| A field is always `uncertain` | Its answer changes when the options are reversed (rewrite ambiguous option labels, or set `uagOrderCheck: "false"`), the mention check is in the uncertain band, or `uagThreshold` is above what the engine reaches. Measure with `uag-eval`. |
| Decision fields come back `suggested`, `calibrated: false` | No decision engine is enabled, or it failed, so an agent engine answered as a fallback. |
| A field is never answered | It is in `excluded`: filled (send `overwrite`), hidden by conditionals, inside a Data Grid or Edit Grid, not requested by this operation, or another field's confidence companion. |
| Hiding a page wiped values that decided it | Set `clearOnHide: false` on the decision fields themselves. The setting on the page or panel does not protect them. |

## Workflows and webhooks

| Symptom | Cause |
|---|---|
| Nothing happens when a submission is created | The webhook did not fire, or its call was refused. Check `handler` is `after` and `method` includes `create`, and that the `x-token` header matches the UAG's `PROJECT_KEY`. Check the Form.io server's logs. Open Source webhooks cannot send headers: call `/agent/provide` from your own code there. |
| The webhook fires but nothing is written | Call `/agent/provide` by hand and read `fields`. Common causes: a `403` license error, an invalid model key (an engine failure in `attempts`), or every field already had a value. |
| `/agent/provide` answers `503` | Some fields could not be answered: every engine that could answer them failed, timed out or was rate limited. The response names each failure. With a remote engine, check the engine server's logs too. The webhook does not wait, so call the endpoint yourself to see it. |
| `/agent/provide` answers `422` | The new values would make the submission invalid, usually because a decision turned on a page whose required fields are empty. `details` lists them. |
| `/agent/provide` answers `409` | The submission kept changing while the task ran. Nothing was saved; try again. |
| Closed-set fields are never saved | Only an agent engine is enabled, and its answers are uncalibrated. Add `uagAgentDecides: "true"` to those fields, or enable a decision engine. |
| The agent fills some fields but not others | The missing ones lack the task's `uag` value (directly or from a container), the value does not exactly match the task name, or they already had a value. |
| The submitter waits a long time after submitting | The webhook has `block: true`. Agent runs take seconds to tens of seconds; set `block: false`. |
| An agent runs continuously and burns API credits | A chained webhook's condition stays true, or uses an unknown operator or a field that does not exist (treated as always true), or the webhook calls something other than `/agent/provide`. |
| A browser-decided value was stored as the user sent it | The submission was saved directly to Form.io, where the `agentDecide` action does not run. Add an after-save webhook to `/agent/provide`. |
| A save through the UAG is refused with `503` or `429` | The `agentDecide` action could not decide some fields at all, so it refused rather than clear them. |

## Engines and engine servers

| Symptom | Cause |
|---|---|
| A remote engine fails with `401` | The UAG's `UAG_ENGINE_<NAME>_KEY` does not match the engine server's `UAG_ENGINE_SERVER_KEY`. |
| Startup says the engine server "does not host an engine named ..." | The instance name differs from the engine's name on the server. Set `UAG_ENGINE_<NAME>_ENGINE`. |
| No engine events appear in the flow viewer | The engines run inside the UAG (only the webhook leg passes through the proxy), or `UAG_ENGINE_<NAME>_URL` does not point at the proxy. |
| A researching extract shows no `/mcp` calls | The engine server cannot reach the UAG (check its `UAG_SERVER`), or the engine called no tool. |
| An engine server's `/mcp` request returns `401` | Its scoped token expired: research ran past `agentApi.research.timeout` (2 minutes by default). |
| A tool call in research is refused | The model called a tool the task does not list in `uagTools`. Add it to the task if it is needed and read-only. |
| An engine is passed over with "does not support tool use" | The task lists `uagTools`, and that agent engine cannot call tools. Route the task to one that can, or remove the tools. |
| A local model through Ollama returns nothing useful | The model must support structured outputs, and tool calling for tasks that research. |

## Still stuck

Run one of the samples to confirm the environment itself is sound, then compare its configuration with yours:

- [Quickstart](/developers/quickstart) for a minimal stack.
- The [conversation form](https://github.com/formio/uag/tree/main/demo), [workflow](https://github.com/formio/uag/tree/main/demo) and [custom module](https://github.com/formio/uag/tree/main/demo/samples/custom-module) samples for each pattern.

To report a bug, include the UAG version, the `X-Request-Id` of a failing request and the matching log lines. Report security issues privately; see [Security](/developers/security#reporting-a-vulnerability).
