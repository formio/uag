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
| **No model holds a write tool.** | In the Agent API, extract and decide give models no tools at all; generate, and "Agent: Run task" for a whole task, give an agent engine only the read-only tools its task lists in `uagTools`, none by default. A tool that may write is refused when the task is planned, and a scoped token can never carry one. The UAG writes, once, after validating. |
| **The form validates every value.** | Every proposed value goes through the form's own processing and validation on the server. A value that fails is never `confident`, and a submission that would be invalid is not saved (`422`). |
| **A task fills only its own fields.** | Engines are asked for the task's fields and nothing else, and values for any other path are discarded. Text in a submission cannot make a model write a field the task does not own, or touch another submission. |
| **Forms are named, never sent.** | Requests name a form; a form definition in a request is refused. The server's own thresholds, options, conditionals and permissions always apply. |
| **Every call has a Form.io identity.** | MCP tools, Agent API calls and research all run as the caller. Form.io roles and submission access decide what is allowed. |
| **Form.io decides every save.** | The UAG forwards every submission to Form.io with the caller's credential, and Form.io applies its own permissions and runs its own actions. See [Proxy mode](#proxy-mode). |
| **A client cannot set a field a task owns.** | Fields a task owns and marks `uagAuthoritative: "true"` are removed from what a client sends to the UAG; on an update they keep their stored value. See [Fields the server owns](#fields-the-server-owns). |
| **Engines see the minimum.** | A task's engines receive its criteria, its input, the values listed in `uagContext`, and today's date. Nothing else from the form. |
| **Engines hold no Form.io credential.** | A remote engine receives only its engine server key and, for research, a short-lived scoped token. |

MCP conversations are different in one respect: there the model runs in the client, and the client does hold write tools (`submit_completed_form`, `submission_update`). The form still validates every write and the user's permissions still apply, but the model decides when to call them. Clients should confirm writes with the user; the tool annotations (`readOnlyHint`, `destructiveHint`) let a client gate them.

## Proxy mode

The UAG is an extension of a Form.io project, not a second copy of it. Applications can point their project URL at the UAG instead of Form.io, and Form.io stays in charge:

- **Every submission is forwarded to Form.io**, as a fixed step of each submission request. The response the caller gets is Form.io's.
- **The UAG runs only its own actions**: "Agent: Run task", and a [module's](/developers/modules) actions. Form.io's actions (Save Submission, Login, Role Assignment, Webhook, Email, Group and the rest) run at Form.io on the forwarded request, so nothing runs twice.
- **Form.io's permissions apply.** A submission is forwarded with the caller's own credential, and Form.io's roles and submission access decide whether it is allowed. Login and registration are forwarded to Form.io, and its response, with its `x-jwt-token`, is passed back.
- **Form.io user tokens are forwarded unchanged.** A token the UAG cannot verify with its own secret is verified with Form.io's `/current` (the answer is cached for 60 seconds, a refusal for 10), and forwarded as the caller sent it, never re-signed. A token tied to a Form.io session (one with a `jti` claim) is always checked with Form.io, even when the UAG shares Form.io's `JWT_SECRET`, so a logout takes effect at once, apart from that cache.

Tasks run only on submissions sent to the UAG. A submission sent straight to Form.io runs no task, and the UAG cannot keep its owned fields from the client; only Form.io's permissions can (see [Fields the server owns](#fields-the-server-owns)).

## Credential modes

### What the UAG itself holds

| Secret | Purpose |
|---|---|
| `PROJECT_KEY` (Enterprise, hosted) or `ADMIN_KEY` (Open Source) | The UAG's administrator credential for the Form.io deployment. The UAG uses it on its own account only to read the project (its export, at startup and on each `PROJECT_TTL` refresh) and for template sync. It is also accepted from callers as an admin credential. An admin caller's requests are forwarded to Form.io as administrator, so a task such a caller starts without an agent role acts as administrator too. A task never uses it for anyone else. |
| `JWT_SECRET` | Signs every token the UAG issues: access tokens, refresh tokens and scoped tokens. Set it to the Form.io Enterprise server's own `JWT_SECRET` to let a Run task act with an agent role (see [Acting on behalf of users](#acting-on-behalf-of-users)); it is then equivalent to administrator access to Form.io. If unset, the UAG generates a random one at startup, so every token stops working when it restarts, and instances behind a load balancer reject each other's tokens. Always set it, to the same value on every instance. |
| `PORTAL_SECRET` | Lets a Form.io Enterprise portal stage connect to the UAG. |
| `MONGO` | The connection string of the UAG's own database, when it has one. |
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
| Project routes (forms, submissions, login) | `x-jwt-token: <Form.io user token>` | That Form.io user, exactly as at Form.io. The token is forwarded unchanged. |
| Project routes | `x-remote-token: <portal remote token>`, from a portal stage connected to the UAG | The portal team member, with what Form.io grants their team permission (see [Portal team members](#portal-team-members)) |
| A form's agent operations (`{form}/agent/*`) | Any credential of the project routes (`x-jwt-token`, `x-remote-token`), or `Authorization: Bearer <UAG access token>` | That user or team member |
| A form's agent operations, `/agent/capabilities` | `x-token: <PROJECT_KEY>` or `x-admin-key: <ADMIN_KEY>` | Administrator. Refused (`401`) on any request with an `Origin` or `Sec-Fetch-Site` header, so a key cannot be used from a browser. |
| A form's agent operations, `/agent/capabilities` | A scoped token | Refused (`401`). Scoped tokens exist for research calls back into `/mcp` and can never start work. |

Use administrator credentials only for trusted server-side automation: back-office jobs and integrations. Anything acting for a person (a chat app, a form that fills itself in) should present that person's own Form.io token or UAG token, so their permissions apply. Never ship a project or admin key to a browser.

### Anonymous visitors

A visitor with no credential may use a form's agent operations only when the form sets [`uagAnonymous: "true"`](/developers/form-properties#uaganonymous) and lets the Anonymous role create submissions. Each such request may call a model at your expense, so anonymous use is limited per client address and in total (`AGENT_ANONYMOUS_RATE_LIMIT`, default 10 a minute, and `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT`, default 100 a minute). The counts are kept by each UAG process, so with several replicas the deployment allows that many times more. Behind a reverse proxy, set `TRUST_PROXY`, or every visitor shares the proxy's address. Values the operations return are suggestions in the visitor's browser: re-decide anything that routes or approves on the server with Run task and `uagAuthoritative`.

### Portal team members

A Form.io portal stage connected to the UAG sends each request with the team member's remote token (`x-remote-token`), signed with `PORTAL_SECRET`. Form.io does not verify these tokens itself, so the UAG checks the token, applies Form.io's team rules, and forwards what they allow with the project's credential:

| Permission | Through the UAG |
|---|---|
| Owner, `team_admin` | Everything, as an administrator. |
| `team_write` | Every method on the project, forms, submissions (including Run task and the agent operations), roles and actions, except deleting the project. |
| `team_read` | Reads (`GET`) of those only. |
| `team_access` | A read of the project only. |

Below `team_admin`, the project's `settings` (keys and secrets), `settings_encrypted` and `billing` are removed from what the UAG returns and from what it forwards, as Form.io does. A path the UAG cannot attribute to one of those, or one with `.` or `..` segments, is refused. Form.io's own logs show the project credential, not the member; the UAG logs the member and permission at debug level (`DEBUG=formio:auth:team`).

`PORTAL_SECRET` is what a remote token's trust rests on: as in Form.io, a token is not tied to one project, and anyone who holds the secret can sign one with any permission. Give each UAG its own long random secret, and share it only with the stages connected to it.

### UAG tokens

- **Access tokens** are signed with `JWT_SECRET` and wrap the Form.io identity they were issued for. They last `JWT_EXPIRE_TIME` minutes (default 60), and never longer than the Form.io login they wrap. Refresh tokens, issued only for OAuth sign-in, last at most twice as long, never past that login, and can only be exchanged for a new access token, never used for access. `client_credentials` returns none.
- **How a Form.io token is trusted.** When the login page posts a user's Form.io token to `/auth/authorize`, and when an access token wrapping it is used, a token signed with the UAG's own `JWT_SECRET` (on Form.io Enterprise with a shared secret) is trusted as issued, with the roles its claims give. Any other token is trusted only once the issuing project confirms it, and then the user's roles and admin status come from Form.io rather than from the token's claims; a user of another project is refused. The answer is cached for a minute.
- **Logouts.** A Form.io session token sent as `x-jwt-token`, or carried in a scoped token, is always checked with Form.io, so a logout takes effect within a minute. An access token is not: with a shared secret, one issued from a session token is honored until it, or the Form.io token inside it, expires, whatever happens to the session. Keep `JWT_EXPIRE_TIME` short where that matters.
- **OAuth sign-in for remote MCP clients is off by default.** It needs `MCP_OAUTH=true` and the UAG's database. `/auth/token` with `client_credentials` and refresh tokens is always on.
- **Authorization codes** are single-use, bound to the PKCE `code_challenge` (`S256`), and expire after 10 minutes. The UAG's database stores them by their SHA-256 hash, with the token each one exchanges for sealed under a key derived from the code, so it never holds a usable code or token. Redirect URIs with unsafe schemes are refused.

Long `JWT_EXPIRE_TIME` values (the samples use a year) are convenient for demos and wrong for production; a stolen token is valid until it expires.

## Scoped tokens for remote engines

When an engine runs on an [engine server](/developers/engine-server), it may need to call the UAG's tools to research. The UAG gives it a **scoped token** for that one piece of work:

| Property | Value |
|---|---|
| Issued | Only for research (value fields of generate, or of a Run task that answers the whole task, whose task lists `uagTools`). Work that needs no tools gets no token. |
| Identity | The caller's: admin for an admin-key caller, or the user's own token (their `Authorization` bearer token or Form.io `x-jwt-token`, or for a Run task the short-lived token the UAG signs for the submitter), which travels inside the scoped token encrypted (AES-256-GCM, with a key derived from `JWT_SECRET`), so a remote engine or a proxy that logs traffic cannot read it. `/mcp` verifies that token again on every call, as the project verifies `x-jwt-token` for submissions, and never as an administrator. Anonymous callers and portal team members below team admin carry no user token, so `/mcp` refuses their research calls. |
| Tools | The task's `uagTools`, filtered to read-only tools. `/mcp` lists and allows only those; a tool that may write is never allowed, even if a token names it. |
| Project | Its own. A scoped token names the project it was issued for, and any other project's `/mcp` refuses it, even on UAGs that share one `JWT_SECRET`. |
| Lifetime | `agentApi.research.timeout`, 120 seconds by default: as long as the research may run, and no longer. |
| Accepted on | `/mcp` only. The agent operations refuse it. |

The UAG never sends a remote engine a Form.io key or a user's plain token.

## Research identity

Research tools run with the caller's identity. For an Agent API call made with the project key, that is administrator access: `find_submissions` in a research step can read any submission in the project. A Run task researches as the user who submitted, never as its agent role, so research never sees more than that user may.

- List only the tools a task needs. Most tasks need none.
- Prefer tools that are narrow by nature (`find_submissions` on a known form) over broad ones.
- Use research only on forms whose submissions you trust, or call the Agent API with a user's own token so their read permissions bound what research can see.
- In-process engines call tools directly; tool calls are reported in each engine group's `toolCalls` and are checked against the tool's own argument schema first.

## Fields the server owns

Values decided in a browser can be changed by the user before submit. For fields that drive routing, let the server decide them:

- Mark each field a task writes that a client must never set `uagAuthoritative: "true"`. This works for decision fields and value fields, and covers their confidence fields too. For every "Agent: Run task" action on the form, whatever its method, conditions or timing, the UAG removes these values from what a client sends; on an update they keep their stored value. Fields without it stay editable, so a person's correction is kept.
- Add a Run task action that runs **before the save** on create and update, answering **its decision fields only**. It re-decides with the caller's identity, and Form.io stores the result as the one save. See [Workflows](/developers/workflows).
- Point the application at the UAG. A submission sent straight to Form.io runs no task, and the UAG never sees it. To keep users off the owned fields at Form.io too, give the action an agent role and set the form's permissions so users cannot create or update submissions themselves ([Project setup for agents](/developers/project-setup)).

When the engines cannot answer at all (an outage, a timeout, a rate limit), a decisions-only Run task before the save refuses the submission with `503` (or `429` when every engine was over its limit) and stores nothing, rather than clearing the owned fields as if the server had judged them. An outage fails closed. A whole-task run before the save forwards the submission without the answers it could not get; a run after the save never affects the submitter's response, and its failure is logged.

## Acting on behalf of users

On a self-hosted Form.io Enterprise project, a Run task action can name an **agent role**: the UAG then saves the task's results, and creates submissions users may not create themselves, as that role on the user's behalf. [Project setup for agents](/developers/project-setup) sets it up. The security properties:

- **`JWT_SECRET` must be the Form.io server's own**, and is then equivalent to administrator access to Form.io: anyone who holds it can sign any token. Keep it in the same secret store as the Form.io server's.
- **The UAG signs only short-lived tokens.** They are Form.io "external" tokens that name the user the agent acts for and expire after 5 minutes: to save, one that carries only the agent role; to research, one with the roles the user had when they submitted. The UAG never signs a token that marks its holder an administrator, nor one with an admin role, and the action's settings offer no admin role. Agent-role tokens are never logged, stored or given to an engine; a research token reaches a remote engine only sealed inside a [scoped token](#scoped-tokens-for-remote-engines).
- **Never the project key for a user.** Without an agent role, a task acts as the caller: with the user's own token, or as administrator for a caller that presented an admin credential. With an agent role, it acts with the tokens above. A run after the save without an agent role keeps the caller's token in memory only, and fails if Form.io no longer accepts it.
- **Research is the user's.** Engines research as the user who submitted, never as the agent role.
- **Not on the hosted service.** Form.io's hosted service does not share its secret, so there every task acts as the caller.

## The database

The optional database (`MONGO`) holds only the UAG's own state, in collections named `uag-*`. It never holds submissions:

- authorization codes for remote MCP sign-in, by their SHA-256 hash, with their tokens sealed;
- run records: the form, submission, task, state, engines, the paths of the fields written (never their values), any error, and the user acted for (id, roles and email). Never a token;
- when the license server became unreachable.

Give the `MONGO` user the `readWrite` role on `UAG_DATABASE` only. Run records name users and submissions, so treat the database as you treat Form.io's, and set `TASK_RUN_RETENTION_DAYS` to your retention policy. See [Deployment](/developers/deployment#the-database).

## Rate limits

`agentApi.rateLimits` limits callers per operation and engines per instance. A caller over its limit gets `429` with `Retry-After`; an engine over its limit is skipped for the next one. Counters are in memory per process, so each instance of a multi-instance deployment has its own allowance. Requests with a server key and anonymous visitors share one counter, and `client_credentials` tokens another. Anonymous visitors have limits of their own as well (see [Anonymous visitors](#anonymous-visitors)). MCP tool calls are not rate limited by the UAG; limit spend in the MCP client. See [Agent API](/developers/agent-api#rate-limits).

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

## Chat

A form's [chat](/developers/chat) (`{form}/agent/chat`) puts a model in front of the people who fill the form in, so its transcript is untrusted text, written by them. The UAG limits what that text can achieve:

| A message could | The UAG's answer |
|---|---|
| Make the model call a tool that writes | The only tool a turn offers is `check_values`, which validates values and saves nothing, and only to agent engines that run in the UAG process. |
| Make the model set a field the person should not | Values are kept only for the form's visible input fields a person may enter. A task's decision and value fields, `uagAuthoritative` fields, hidden, disabled and calculated fields, and fields inside a hidden panel or container are never set; values for them are dropped. Fields the person set in the form itself (`locked`) are never changed. |
| Make the model invent an invalid value | Every value is checked for its shape (numbers, booleans, options, the keys of select boxes and surveys), then validated with the form's own rules; a refused value is put back and reported `invalid`. |
| Submit the form, or someone else's | The UAG never submits. The person's browser submits the form after they confirm, through the UAG, with their own permissions and the form's actions. |
| Steer the reply | Possible, within the person's own conversation. The reply is shown only to them, as text unless the page renders markdown, which the widget sanitizes, and is cut to `agentApi.chat.maxMessageLength`. |

So the most an injected instruction can do is put values the person could have typed into fields they could have typed in. The conversation is held by the client and sent with each turn: a client can send any history it likes, but only for its own conversation.

- **Credentials.** A turn takes the same credentials as the form's other agent operations: the person's Form.io token in a browser. Project and admin keys are refused on browser requests, so a key can only be used from a server, such as a relay of your own.
- **Cost.** Every turn calls a model at your expense. On a public form (`uagAnonymous`), anonymous turns count against the anonymous limits with the form's other agent operations; signed-in callers against `agentApi.rateLimits.caller.chat`; each turn is bounded by `agentApi.chat.maxMessages`, `maxMessageLength` and `maxTranscriptChars`, and what it sends the engine from the form's data is bounded too (see [Where data goes](#where-data-goes)), so a large request body does not make a large prompt. Each response reports the engine's token `usage`, for a relay that keeps a budget.
- **Licensing.** Chat is part of conversation forms and needs no Agentic Formflow license, so a deployment with an agent engine offers it on every form tagged `uag`, whether or not Agentic Formflow is licensed. Turn it off per form with [`uagChat: "false"`](/developers/form-properties#uagchat).

## Where data goes

Enabling an engine sends submission data to its provider: TypeSafe for `jev`, Anthropic for `claude`, OpenAI (or the server it points at) for `openai`, xAI for `grok`, Google for `gemini`. What is sent is a task's criteria, its input (or, without an input, the whole submission except the fields being answered), its `uagContext` values and today's date, plus whatever research tools return.

- Do not enable an engine for data that must not leave your deployment.
- To keep everything in your network, point the `openai` engine at a local OpenAI-compatible server such as Ollama or vLLM (see [Engines](/developers/engines)).
- To keep model keys and model traffic out of the UAG, run engines on an [engine server](/developers/engine-server) on a private network.
- MCP conversations send whatever the MCP client sends to its model; the UAG sends nothing to a model itself.
- A form's chat sends its agent engine: the UAG's chat instructions, the form's title, description and `uagChatInstructions`; the conversation (the newest messages within `agentApi.chat.maxTranscriptChars`); for each field the chat may collect, its path, label, type, description, placeholder, value rule, format and static options, and its current value (each value cut to 500 characters, all of them within `maxTranscriptChars`); the labels of the fields still needed, the optional ones and those to finish in the form; and today's date. Nothing else from the request's `data` is sent: not task fields, hidden fields or fields the chat cannot collect.

`fetch_external_data` calls the URLs configured on the form's select and data source components, from the UAG's network. Treat the right to edit forms as the right to choose what the UAG fetches.

## Production checklist

**Secrets and configuration**

- Change every `CHANGEME`: `ADMIN_KEY`, `JWT_SECRET`, `PORTAL_SECRET`, database and Form.io secrets.
- Keep keys in a secret store, not in Compose files or images.
- Set `JWT_SECRET` explicitly, and choose a `JWT_EXPIRE_TIME` that matches your session policy.
- When `JWT_SECRET` is the Form.io server's, guard it as administrator access to Form.io.

**Network**

- Keep the UAG on a private network unless remote agents must connect in. Local MCP clients, applications and engine servers all work without a public address.
- When it must be public for remote MCP clients, terminate TLS in front of it, publish only `/mcp`, `/auth` and `/.well-known` (as the custom module sample's nginx does), and make sure the OAuth documents name that HTTPS URL (`TRUST_PROXY` behind the proxy, or `BASE_URL`). Leave `MCP_OAUTH` off when no remote client needs it.
- Restrict `CORS`, which defaults permissively for local development, to the origins that call the Agent API from browsers.
- Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` on a deployment reachable from outside your network; it disables certificate checks for every outbound request.
- Keep engine servers and the flow viewer on private networks, and never publish their ports. The flow viewer has no authentication and shows submission data.

**Identity and permissions**

- Authenticate each person with their own token. Reserve admin credentials for server-side automation.
- Scope submission access per role, as the [custom module sample](/developers/connect-claude#roles-and-permissions-govern-the-agent) does. A project reachable only with the API key is a demo, not a deployment.
- Hide agent sections (`hidden: true`) from the rendered form.

**Agents**

- Keep the confirm step in conversational clients, and gate write tools on their annotations.
- Add per-session and per-caller rate limits; every chat turn and every task run costs model tokens.
- On public forms with a chat, set the anonymous limits for what you are prepared to pay, set a spend limit at the model provider, and turn chat off (`uagChat: "false"`) on forms that should not offer it.
- List research tools sparingly; prefer none.
- Use "Agent: Run task" with an agent role, `uagAuthoritative` and a review path for decisions that drive sensitive routing.
- Measure decision thresholds on your own data with [`uag-eval`](/developers/evaluation) before relying on them, and pin model versions.

**Operations**

- Raise `PROJECT_TTL` from the samples' 10 seconds; each refresh re-reads the project export.
- Log and keep `X-Request-Id` values; they tie a failing request to the UAG's log.
- Track the latest releases: only the latest published version of each package and image receives security fixes.

## Reporting a vulnerability

Do not open a public issue. Report privately to [security@form.io](mailto:security@form.io), or through GitHub's [private vulnerability reporting](https://github.com/formio/uag/security/advisories/new) for the repository, with the affected package or image and its version. Receipt is acknowledged within five business days. See [SECURITY.md](https://github.com/formio/uag/blob/main/SECURITY.md).
