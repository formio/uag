---
title: Security
description: The UAG's trust model, its credential modes and tokens, how research and server-side re-decision are scoped, its posture on prompt injection, and a checklist for production.
section: Operate
order: 10
---

The UAG puts AI agents in front of your data, so its design starts from one rule: models propose, the UAG disposes. This page explains what that means in practice, what each credential can do, where data goes, and how to harden a deployment.

## The trust model

| Principle | How it is enforced |
|---|---|
| **No model holds a write tool.** | In the Agent API, extract and decide give models no tools at all; generate and provide give an agent engine only the read-only tools its task lists in `uagTools`, none by default. A tool that may write is refused when the task is planned, and a scoped token can never carry one. The UAG writes, once, after validating. |
| **The form validates every value.** | Every proposed value goes through the form's own processing and validation on the server. A value that fails is never `confident`, and a submission that would be invalid is not saved (`422`). |
| **A task fills only its own fields.** | Engines are asked for the task's fields and nothing else, and values for any other path are discarded. Text in a submission cannot make a model write a field the task does not own, or touch another submission. |
| **Forms are named, never sent.** | Requests name a form; a form definition in a request is refused. The server's own thresholds, options, conditionals and permissions always apply. |
| **Every call has a Form.io identity.** | MCP tools, Agent API calls and research all run as the caller. Form.io roles and submission access decide what is allowed. |
| **Engines see the minimum.** | A task's engines receive its criteria, its input, the values listed in `uagContext`, and today's date. Nothing else from the form. |
| **Engines hold no Form.io credential.** | A remote engine receives only its engine server key and, for research, a short-lived scoped token. |

MCP conversations are different in one respect: there the model runs in the client, and the client does hold write tools (`submit_completed_form`, `submission_update`). The form still validates every write and the user's permissions still apply, but the model decides when to call them. Clients should confirm writes with the user; the tool annotations (`readOnlyHint`, `destructiveHint`) let a client gate them.

## Credential modes

### What the UAG itself holds

| Secret | Purpose |
|---|---|
| `PROJECT_KEY` (Enterprise, hosted) or `ADMIN_KEY` (Open Source) | The UAG's administrator credential for the Form.io deployment. Also accepted from callers as an admin credential. |
| `JWT_SECRET` | Signs every token the UAG issues: access tokens, refresh tokens and scoped tokens. Unrelated to the Form.io server's own JWT secret. If unset, the UAG generates a random one at startup, so every token stops working when it restarts, and instances behind a load balancer reject each other's tokens. Always set it, to the same value on every instance. |
| `LICENSE_KEY` (or the deprecated `UAG_LICENSE`) | The license, when one is needed. |
| Model keys (`CLAUDE_API_KEY`, `TYPESAFE_API_KEY`, ...) | Held by the UAG when engines run in it, or only by the engine server when they run there. |
| `UAG_ENGINE_<NAME>_KEY` | The key the UAG sends a remote engine server, at least 32 characters. |

Supply all of these from your platform's secret store, never from a committed file.

### What callers present

| Surface | Credential | Runs as |
|---|---|---|
| `/mcp` | `Authorization: Bearer <UAG access token>` from the browser OAuth (PKCE) flow | The signed-in user, with their Form.io roles |
| `/mcp` | `Authorization: Bearer <UAG access token>` from `client_credentials` (`<project>-x-token` with `PROJECT_KEY`, or `formio-oss-x-admin-key` with `ADMIN_KEY`) | Administrator |
| `/mcp` | `Authorization: Bearer <scoped token>` | The identity the token was issued for, limited to its read-only tools |
| `/agent/*` | `Authorization: Bearer <UAG access token>` | That token's identity |
| `/agent/*` | `x-token: <PROJECT_KEY>` or `x-admin-key: <ADMIN_KEY>` | Administrator. Refused (`401`) on any request with an `Origin` or `Sec-Fetch-Site` header, so a key cannot be used from a browser. |
| `/agent/*` | A scoped token | Refused (`401`). Scoped tokens exist for research calls back into `/mcp` and can never start work. |

Use administrator credentials only for trusted server-side automation: webhooks, back-office jobs, engine servers. Anything acting for a person (a chat app, a form that fills itself in) should present that person's own UAG token, so their permissions apply. Never ship a project or admin key to a browser.

### UAG tokens

- **Access tokens** are signed with `JWT_SECRET` and wrap the Form.io identity they were issued for. They last `JWT_EXPIRE_TIME` minutes (default 3600). Refresh tokens last twice as long and can only be exchanged for a new access token, never used for access.
- **A Form.io token is not trusted on its word.** When the login page posts a user's Form.io token to `/auth/authorize`, and when an access token wrapping it is used, the UAG has the issuing project confirm it (caching the answer for a minute), and takes the user's roles and admin status from Form.io rather than from the token's claims. A token from another project is refused.
- **Authorization codes** are single-use and bound to the PKCE `code_challenge` (`S256`). Redirect URIs with unsafe schemes are refused.

Long `JWT_EXPIRE_TIME` values (the samples use a year) are convenient for demos and wrong for production; a stolen token is valid until it expires.

## Scoped tokens for remote engines

When an engine runs on an [engine server](/developers/engine-server), it may need to call the UAG's tools to research. The UAG gives it a **scoped token** for that one piece of work:

| Property | Value |
|---|---|
| Issued | Only for research (value fields of generate and provide whose task lists `uagTools`). Work that needs no tools gets no token. |
| Identity | The caller's: admin for an admin-key webhook, or the user's own token, which travels inside the scoped token encrypted (AES-256-GCM, with a key derived from `JWT_SECRET`), so a remote engine or a proxy that logs traffic cannot read it. |
| Tools | The task's `uagTools`, filtered to read-only tools. `/mcp` lists and allows only those; a tool that may write is never allowed, even if a token names it. |
| Lifetime | `agentApi.research.timeout`, 120 seconds by default: as long as the research may run, and no longer. |
| Accepted on | `/mcp` only. `/agent/*` refuses it. |

The UAG never sends a remote engine a Form.io key or a user's plain token.

## Research identity

Research tools run with the caller's identity. For a webhook calling `/agent/provide` with the project key, that is administrator access: `find_submissions` in a research step can read any submission in the project.

- List only the tools a task needs. Most tasks need none.
- Prefer tools that are narrow by nature (`find_submissions` on a known form) over broad ones.
- Use research only on forms whose submissions you trust, or call the Agent API with a user's own token so their read permissions bound what research can see.
- In-process engines call tools directly; tool calls are reported in each engine group's `toolCalls` and are checked against the tool's own argument schema first.

## Server-side re-decision

Values decided in a browser can be changed by the user before submit. For decision fields that drive routing, re-decide on the server:

- Add the `agentDecide` action (handler `before`, methods `create` and `update`) to forms saved through the UAG. It re-decides with the caller's identity before the save. See [Workflows](/developers/workflows#re-deciding-on-the-server).
- For submissions saved directly to Form.io, add an after-save webhook to `/agent/provide`, and trigger downstream work on that update.
- Mark fields that must never be set by a client `uagAuthoritative: "true"`. The server's answer always wins; when it is not confident, the field is cleared for a person to decide.

When the engines cannot answer at all (an outage, a timeout, a rate limit), these saves are refused with `503` or `429` rather than clearing authoritative fields as if the server had judged them. An outage fails closed.

## Rate limits

`agentApi.rateLimits` limits callers per operation and engines per instance. A caller over its limit gets `429` with `Retry-After`; an engine over its limit is skipped for the next one. Counters are in memory per process, so each instance of a multi-instance deployment has its own allowance, and all admin-key callers share one counter. MCP tool calls are not rate limited by the UAG; limit spend in the MCP client. See [Agent API](/developers/agent-api#rate-limits).

## Prompt injection

Submissions are untrusted text, and models follow instructions they find in their input. The UAG does not try to detect injection. It limits what an injected instruction can achieve:

| An injected instruction could | The UAG's answer |
|---|---|
| Make a model call a write tool | No model is given one in the Agent API. |
| Make a model write a field outside its task, or another submission | Values for other paths are discarded; the UAG performs every write itself, on one submission. |
| Make a model invent an invalid value | The form validates every value; invalid values are never `confident` and an invalid submission is not saved. |
| Push a closed-set decision to a chosen option | Decision fields only accept their options, and decision engines report a calibrated confidence. Mark sensitive ones `uagAuthoritative`, and route uncertain ones to a person with `uagConfidenceField`. |
| Steer an open value (a summary, a score) within what the form accepts | Possible. Agent-engine values are always `suggested`: treat them as proposals, and validate ranges and formats in the form. |
| Steer what research reads | Possible, within the task's read-only tools and the caller's permissions. List few tools, and avoid admin identity for research on untrusted input. |

The UAG's end-to-end tests include an application essay that tries to change the applicant's GPA, and inputs that tell the model to set other fields. In each case the stored values are only the task's own, validated fields.

> **Note:** Hiding the criteria (`hidden: true`) hides it from the rendered form only. Anyone who can read the form definition can read it, so do not put secrets in criteria.

## Where data goes

Enabling an engine sends submission data to its provider: TypeSafe for `jev`, Anthropic for `claude`, OpenAI (or the server it points at) for `openai`, xAI for `grok`, Google for `gemini`. What is sent is a task's criteria, its input (or, without an input, the whole submission except the fields being answered), its `uagContext` values and today's date, plus whatever research tools return.

- Do not enable an engine for data that must not leave your deployment.
- To keep everything in your network, point the `openai` engine at a local OpenAI-compatible server such as Ollama or vLLM (see [Engines](/developers/engines)).
- To keep model keys and model traffic out of the UAG, run engines on an [engine server](/developers/engine-server) on a private network.
- MCP conversations send whatever the MCP client sends to its model; the UAG sends nothing to a model itself.

`fetch_external_data` calls the URLs configured on the form's select and data source components, from the UAG's network. Treat the right to edit forms as the right to choose what the UAG fetches.

## Production checklist

**Secrets and configuration**

- Change every `CHANGEME`: `ADMIN_KEY`, `JWT_SECRET`, `PORTAL_SECRET`, database and Form.io secrets.
- Keep keys in a secret store, not in Compose files or images.
- Set `JWT_SECRET` explicitly, and choose a `JWT_EXPIRE_TIME` that matches your session policy.
- Treat the project API key in webhook actions as a secret: anyone who can read the project's actions can read it.

**Network**

- Keep the UAG on a private network unless remote agents must connect in. Local MCP clients, webhooks and engine servers all work without a public address.
- When it must be public, terminate TLS in front of it, publish only `/mcp`, `/auth` and `/.well-known` (as the custom module sample's nginx does), and set `BASE_URL` to that HTTPS URL.
- Restrict `CORS`, which defaults permissively for local development, to the origins that call the Agent API from browsers.
- Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` on a deployment reachable from outside your network; it disables certificate checks for every outbound request.
- Keep engine servers, webhook relays and the flow viewer on private networks, and never publish their ports. The flow viewer has no authentication and shows submission data.

**Identity and permissions**

- Authenticate each person with their own token. Reserve admin credentials for server-side automation.
- Scope submission access per role, as the [custom module sample](/developers/connect-claude#roles-and-permissions-govern-the-agent) does. A project reachable only with the API key is a demo, not a deployment.
- Hide agent sections (`hidden: true`) from the rendered form.

**Agents**

- Keep the confirm step in conversational clients, and gate write tools on their annotations.
- Add per-session and per-caller rate limits; every chat turn and every provide call costs model tokens.
- List research tools sparingly; prefer none.
- Use `agentDecide`, `uagAuthoritative` and a review path for decisions that drive sensitive routing.
- Measure decision thresholds on your own data with [`uag-eval`](/developers/evaluation) before relying on them, and pin model versions.

**Operations**

- Raise `PROJECT_TTL` from the samples' 10 seconds; each refresh re-reads the project export.
- Log and keep `X-Request-Id` values; they tie a failing request to the UAG's log.
- Track the latest releases: only the latest published version of each package and image receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Report privately to [security@form.io](mailto:security@form.io), or through GitHub's [private vulnerability reporting](https://github.com/formio/uag/security/advisories/new) for the repository, with the affected package or image and its version. Receipt is acknowledged within five business days. See [SECURITY.md](https://github.com/formio/uag/blob/main/SECURITY.md).
