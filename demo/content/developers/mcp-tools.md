---
title: MCP tools
description: How agents connect to the UAG's MCP endpoint, how they authenticate, every built-in tool with its arguments and annotations, and a complete MCP client in JavaScript.
section: Build
order: 10
---

The UAG serves the [Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`. Any MCP client can connect: Claude Desktop, claude.ai connectors, Claude Code, or an application you write with an MCP SDK. The tools turn your `uag`-tagged forms into context a model can use, and they are the only way an MCP agent can write to Form.io: every write goes through the form's validation and the caller's permissions.

To offer a conversation on a web page without running an MCP client and a model yourself, use the [chat widget](/developers/chat) instead: the UAG runs each turn of one form's chat with its own agent engine.

> **Note:** This is the endpoint agents use to fill in your forms. The Form.io MCP server in the [Agentic Coding Plugin](https://github.com/formio/ai) is a separate one: coding agents use it to build forms.

## The endpoint

| | |
|---|---|
| **URL** | `/mcp` on the UAG, for example `http://localhost:3200/mcp` |
| **Transport** | Streamable HTTP. `POST` for JSON-RPC requests, `GET` for the server stream. |
| **Sessions** | None. The UAG runs in stateless mode and builds a fresh MCP server for every request, so requests are independent and can run concurrently. A client does not need to keep a session id. |
| **Server info** | `name: "formio-uag"` |
| **Authentication** | `Authorization: Bearer <UAG access token>` on every request. Without a valid token the UAG answers `401` with `WWW-Authenticate: Bearer realm="uag-server"` (RFC 6750): when a token was sent, the header adds `error="invalid_token"` and its reason, and the body is `{ "error": "invalid_token", "error_description": "..." }`; with no token, the body's `error` is `unauthorized`. When OAuth sign-in for remote clients is on (`MCP_OAUTH`, with the UAG's database), the header also names `resource_metadata`, the UAG's `/.well-known/oauth-protected-resource`. |
| **Capabilities** | Tools. The tool list is built per request from the forms currently registered, plus any custom tools from a [module](/developers/modules). |

The `form_name` argument of every tool is an enumeration of the registered form names, so a client sees exactly which forms exist in the tool schema, and a call naming any other form fails argument validation.

## How agents connect

Decide first which side opens the connection. It determines whether the UAG needs a public address.

| Connection | Who runs the MCP client | Public URL needed? | Authentication |
|---|---|---|---|
| **Local client** | Your application, integration, or engine server, running alongside the UAG | No. `http://localhost:3200` or a private network name is enough. | `client_credentials` grant at `/auth/token` with a server-side key. Always on; needs no other setting. |
| **Remote client** | A client that runs the browser sign-in: claude.ai connectors, Claude Desktop custom connectors, the Anthropic MCP connector, and `mcp-remote` | For connectors, yes: `/mcp`, `/auth/*` and `/.well-known/*` must be reachable over HTTPS. `mcp-remote` runs on your machine, so a local URL works. | Browser-based OAuth 2.0 authorization code flow with PKCE. Needs `MCP_OAUTH=true` and the UAG's database (`MONGO`). |

With a local client nothing dials into your network: your code connects out to the UAG, calls the tools, and passes the results to whichever model it uses. This is the recommended model for server-to-server automation, and it keeps the whole stack inside your security boundary. Both models can be used against one deployment at the same time.

```sequence
participants: Your app (MCP client), Model API, UAG*, Remote agent
Your app (MCP client) -> UAG: inside your network: /mcp with a client_credentials token
Your app (MCP client) -> Model API: outbound only: the conversation and tool results
Remote agent -> UAG: from the internet: HTTPS to /mcp, /auth and /.well-known
note UAG: both are held to the caller's permissions
```

### Local clients: `client_credentials`

A server-side client has no browser, so it exchanges a key for a UAG access token at `/auth/token`. The `client_id` is the project name, a hyphen, and the credential type:

| Deployment | `client_id` | `client_secret` |
|---|---|---|
| Form.io Open Source | `formio-oss-x-admin-key` (the project name is always `formio-oss`) | The Form.io server's `ADMIN_KEY` |
| Form.io Enterprise, hosted SaaS | `<project name>-x-token`, for example `claims-x-token` | The project API key, `PROJECT_KEY` |

The token endpoint is `/auth/token` on every edition, and it is always on: it needs no `BASE_URL`, `MONGO` or `MCP_OAUTH`. Against an Enterprise or hosted project, the project's routes are also served under its name, so `/<project name>/auth/token` works too.

```http
POST /auth/token
Content-Type: application/json

{ "grant_type": "client_credentials", "client_id": "formio-oss-x-admin-key", "client_secret": "CHANGEME" }
```

```json
{ "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600, "scope": "formio" }
```

| Response | Cause |
|---|---|
| `200` | A token. `expires_in` is in seconds: `JWT_EXPIRE_TIME` minutes times 60. |
| `400` | An OAuth error (RFC 6749, section 5.2), `{ "error": "...", "error_description": "..." }`: `invalid_request` (a parameter is missing), `invalid_client` (a wrong project-name prefix or secret), `invalid_grant` (an unknown, used or expired code, a wrong `code_verifier`, or a refresh token whose sign-in expired), `unsupported_grant_type` (an unknown grant, or `authorization_code` while OAuth sign-in is off). Token responses and errors carry `Cache-Control: no-store`. |

A `client_credentials` token acts as the project administrator. Every tool call can then read and write anything in the project, so use it for trusted automation only. To act as a particular person, authenticate that person and use their token instead (see [Security](/developers/security#credential-modes)).

Cache the token and request a new one with `client_credentials` shortly before `expires_in` runs out. A `client_credentials` exchange returns no refresh token (RFC 6749, section 4.4.3).

A token from OAuth sign-in wraps the user's Form.io login token, so neither it nor its `refresh_token` outlives that login: `expires_in` is the shorter of `JWT_EXPIRE_TIME` and the login's own lifetime (Form.io's `jwt.expireTime`, 240 minutes by default). After that the client signs the user in again.

### Remote clients: OAuth with PKCE

Remote MCP clients discover the UAG's authorization server and run the standard OAuth 2.0 authorization code flow with PKCE (`S256`). The user signs in with the project's own login form, so whatever authentication the project uses (Form.io accounts, SAML, OIDC, custom) applies.

This sign-in is off by default. Turn it on with `MCP_OAUTH=true`, and give the UAG its own database (`MONGO`), where it keeps the one-time authorization codes. Using the database needs a license that includes the UAG, unless the project and the database are both on development hosts (`localhost`, `*.localhost`, `lvh.me`, `*.local`); see [Deployment](/developers/deployment#the-database). Without a usable database the UAG starts with OAuth sign-in off and says why in its log, the endpoints below other than `POST /auth/token` answer `404`, and `GET /agent/capabilities` reports `mcpOAuth: false`.

```sequence
participants: MCP client, Browser, UAG*, Form.io
MCP client -> UAG: POST /mcp
UAG --> MCP client: 401 with resource_metadata
MCP client -> UAG: /.well-known/oauth-protected-resource and oauth-authorization-server
MCP client -> UAG: POST /auth/register
MCP client -> Browser: opens /auth/authorize?code_challenge=...
Browser -> Form.io: the LOGIN_FORM login
Browser -> UAG: Form.io JWT and code_challenge
UAG --> Browser: redirect with the authorization code
MCP client -> UAG: POST /auth/token with the code_verifier
UAG --> MCP client: access token for /mcp
```

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-protected-resource` | Names the resource (the UAG's `/mcp`) and its authorization server (the UAG). |
| `GET /.well-known/oauth-authorization-server` | Authorization, token and registration endpoints; `code_challenge_methods_supported: ["S256"]`. |
| `POST /auth/register` | Dynamic client registration. Returns a `client_id` for the client. |
| `GET /auth/authorize` | The login page. It loads the form at `LOGIN_FORM` (default `{PROJECT}/user/login`) in the user's browser. |
| `POST /auth/authorize` | Called by the login page with the user's Form.io token and the `code_challenge`. Issues a one-time code and redirects to the client's `redirect_uri`. Refusals are OAuth errors (`invalid_request`, `access_denied`), which the login page shows to the person. |
| `POST /auth/token` | `authorization_code` (with `code_verifier`), `refresh_token`, or `client_credentials`. |

A Form.io token signed with the UAG's own `JWT_SECRET` (on Form.io Enterprise with a shared secret) is trusted as issued, without asking Form.io, so a Form.io logout does not end the access token wrapping it before it expires. Any other is trusted only after the project that issued it confirms it, and then the user's roles come from Form.io, never from the token's claims; a user of another project is refused. Every later tool call runs as that user, with that user's permissions.

Everything the flow advertises is built from the UAG's public URL. The UAG derives it from each request: the `Host` header, or, when `TRUST_PROXY` is set, the reverse proxy's `X-Forwarded-Proto` and `X-Forwarded-Host`. `BASE_URL` overrides it. If the advertised URL is one the client cannot reach (`http` behind a TLS proxy without `TRUST_PROXY`, for example), authentication fails even though the UAG is running. [Connect Claude](/developers/connect-claude) walks through both Claude clients.

## The tools

Every built-in tool carries [MCP annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) so a client can tell reads from writes. They come from three presets:

| Preset | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
|---|---|---|---|---|
| Reads | `true` | `false` | `true` | `true` |
| Creates | `false` | `false` | `false` | `true` |
| Overwrites | `false` | `true` | `true` | `true` |

`openWorldHint` is `true` throughout because every result depends on the Form.io deployment. The read-only annotation also decides which tools a task may give a model for research (`uagTools`): only tools marked `readOnlyHint: true` qualify.

| Tool | Annotation | What it does |
|---|---|---|
| [`get_forms`](#getforms) | Reads | Lists the tagged forms and the caller's permissions on each. |
| [`get_form_fields`](#getformfields) | Reads | An overview of a form's fields, with data paths and value rules. |
| [`get_field_info`](#getfieldinfo) | Reads | Full detail for chosen fields: required, format, options, validation. |
| [`collect_field_data`](#collectfielddata) | Reads | Validates collected values and says what is still needed. Saves nothing. |
| [`confirm_form_submission`](#confirmformsubmission) | Reads | A summary of the collected data for the user to approve. |
| [`submit_completed_form`](#submitcompletedform) | Creates | Creates the submission. |
| [`find_submissions`](#findsubmissions) | Reads | Searches submissions, counts them, or loads one. |
| [`submission_update`](#submissionupdate) | Overwrites | Changes fields of an existing submission. |
| [`agent_provide`](#agentprovide) | Reads | A task's criteria, a submission's values and the task's fields, as instructions. |
| [`agent_decide`](#agentdecide) | Reads | A task's decision questions as structured JSON. |
| [`fetch_external_data`](#fetchexternaldata) | Reads | Options or data for a URL, resource or data source component. |

Results are Markdown text in a single `text` content block, rendered from [response templates](/developers/modules) a module can override. A result that reports a problem (an unknown form, a validation failure, a missing submission) sets `isError: true`. `agent_decide`, and `collect_field_data` with `as_json`, return JSON text plus the same object as `structuredContent`.

All tools run with the caller's identity. A form the caller cannot access is still listed by `get_forms`, marked as having no access, and Form.io refuses the operations the caller is not permitted.

### Data paths and `form_data`

Tools address fields by **data path**: the field's full key path in the submission data, such as `customer.firstName` or `children[1].age`. `get_form_fields` reports each field's `data_path`.

`form_data` is the conversation's state, kept by the client and sent back on every call: a flat object of data path to value.

```json
{ "firstName": "Joe", "company.name": "Acme Corp", "children[0].name": "Tom", "children[0].age": 5 }
```

The UAG converts it into a submission: comma-separated strings become arrays for multi-value fields, and objects for select boxes.

Nested forms, Data Grids and Edit Grids are collected separately. `get_field_info` marks them **Has Nested Components**; pass their data path as `parent_path` to `get_form_fields` and `collect_field_data` to work inside them.

### `get_forms`

Lists every registered form and resource with its title, name, description and the caller's permissions (create, read, update). Call it first in any conversation.

| Argument | Type | Required | Description |
|---|---|---|---|
| none | | | |

### `get_form_fields`

An overview of the fields a form needs, with each field's label, `data_path`, type, description and value rule, plus the formatting rules for each field type present. Conditionally hidden fields are left out.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum of form names | Yes | The form. |
| `criteria` | `"all"`, `"required"`, `"optional"` | No, default `"required"` | Which fields to list. A conversation usually starts with the required ones. |
| `parent_path` | string | No | The data path of a nested form, Data Grid or Edit Grid, to list the fields inside it. |

### `get_field_info`

Full detail for the fields the user is answering: required or not, whether it has nested components, description, placeholder (as **Prompt**), format, options, and validation (`minLength`, `maxLength`, `pattern`, `min`, `max`). For selects fed by a URL or a resource, the options say to call `fetch_external_data`.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `field_paths` | string[] | Yes | The data paths to describe. |
| `parent_path` | string | No | The containing nested component, if any. |

### `collect_field_data`

Applies `updates` to `form_data`, runs the form's processing and validation, and reports validation errors, or the required fields still missing, or that every required field is collected, with a summary of the data so far. It saves nothing: the client keeps `form_data` and passes it back next time.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `form_data` | object | No, default `{}` | Everything collected so far, without the updates applied. |
| `updates` | `{ data_path, new_value }[]` | Yes | The values the user just gave. Several fields can come from one message. |
| `parent_path` | string | No | The nested component being collected. |
| `as_json` | boolean | No, default `false` | Return the processed submission (or the errors) as JSON instead of text. |

### `confirm_form_submission`

Validates the complete `form_data` and returns a summary to show the user before submitting. If required fields are still missing, it lists them instead.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `form_data` | object | No, default `{}` | Everything collected. |

### `submit_completed_form`

Validates the submission and sends it to Form.io, as any submission to the UAG: the UAG runs its own actions (such as "Agent: Run task"), and Form.io saves it and runs its actions (Save Submission, Webhook, Email and the rest). Returns the submission id and a summary, or the validation errors (`isError: true`, nothing saved). A form with no Save Submission action (email or webhook only) succeeds without an id.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `form_data` | object | No, default `{}` | Everything collected. |

The tool description tells the model to call it only after the user explicitly confirms. Clients that can gate write tools on the annotations should do so.

### `find_submissions`

Searches a form's submissions. With no `search_query` and no `submission_id`, it returns the total count only.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `search_query` | `{ data_path, operator, search_value }[]` | No | Criteria, all of which must match. |
| `fields_requested` | string[] | No | Data paths whose values to return. Without it, only ids and timestamps come back. |
| `limit` | number | No, default `5` | Maximum results. |
| `submission_id` | string | No | Load this submission directly. |
| `submission_id_partial` | string | No | The last four characters of an id, to choose among several matches. |

`operator` defaults to `contains`:

| Operator | Matches |
|---|---|
| `equals`, `not_equals` | Exact value, or not |
| `contains`, `starts_with`, `ends_with` | Case-insensitive literal text; regular expression characters are escaped |
| `regex` | A case-insensitive regular expression. An invalid pattern is reported, not ignored. |
| `in`, `nin` | One of, or none of, comma-separated values |
| `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal` | Numeric comparison |

### `submission_update`

Applies `updates` to an existing submission and saves it through Form.io, with full validation. Returns each field's previous and new value, or the validation errors with nothing saved. Annotated destructive: previous values are gone once it returns.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `submission_id` | string | Yes in practice | The full id, from `find_submissions`. |
| `updates` | `{ data_path, new_value }[]` | Yes | The new values. |

### `agent_provide`

Returns a task's criteria, the submission's values and the task's fields as one prompt, instructing the agent to work out the values and write them with `submission_update`. It only reads; the write is the client's own `submission_update` call. This is how an MCP client can run a task with its own model. For automation, prefer the "Agent: Run task" action, which runs the task inside the UAG on each save without giving any model a write tool (see [Workflows](/developers/workflows)).

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `submission_id` | string | Yes in practice | The submission to process. |
| `task` | string | No | The task name (its `uag` value). Default: the form's first task. |

It refuses a task without criteria or without fields. Like `agent_decide`, it is part of Agentic Formflow: without a license that includes the UAG, or a project on Form.io's hosted service, it returns `{ error, code: "license_required" }`.

### `agent_decide`

Returns a task's decision questions as JSON, so the client can answer them with any decision model and write the values with `submission_update`. It calls no model itself, and is listed whether or not an engine is enabled. It is part of Agentic Formflow, so it needs a `LICENSE_KEY` that includes the UAG unless the project is on Form.io's hosted service; otherwise it returns `{ error, code: "license_required" }`.

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `submission_id` | string | One of these | A stored submission. Filled and hidden decision fields are included, for re-deciding. |
| `form_data` | object | One of these | In-flight data, nested by data path. |
| `task` | string | No | The task. Default: the form's first task. |

```json
{
  "form": "supportRequest",
  "task": "triage",
  "state": { "input": { "What happened?": "Internet down" }, "today": "Friday, October 23, 2026 (2026-10-23)", "instructions": "You triage support requests..." },
  "fields": [
    { "path": "category", "label": "Category", "type": "radio", "shape": "choice", "questions": ["choice:category", "choice-reversed:category", "mention:category"] }
  ],
  "questions": { "choice:category": { "type": "choice", "instructions": "Based on `input`, which Category applies?", "options": { "Billing": null, "Outage": null, "Other": null } } },
  "mappings": { "choice:category": { "path": "category", "role": "choice", "values": { "Billing": "billing", "Outage": "outage", "Other": "other" } } }
}
```

Question ids start with their role (`choice`, `choice-reversed`, `score`, `mention`, `affirm`, `deny`). `mappings` turns each answer back into a field value. [Concepts](/developers/concepts#how-decisions-are-asked) explains how the answers combine.

### `fetch_external_data`

Loads what a field needs from outside the form: the options of a select whose data source is a URL or a Form.io resource, or the value of a Data Source component. URL and header templates such as `{{ data.country }}` are resolved from `form_data`. Results are limited to the component's `limit` (default 100).

| Argument | Type | Required | Description |
|---|---|---|---|
| `form_name` | enum | Yes | The form. |
| `data_path` | string | Yes | The component's data path. |
| `form_data` | object | No | The data collected so far, for interpolation. |
| `search_value` | string | No | Filters options server-side, when the component has a `searchField`. |

For a select it returns each option's label and value; the agent must use the value. For a Data Source it returns the form data with the fetched value in place.

## The conversation sequence

A conversation that creates a record usually calls the tools in this order. It is what the system prompt of a form-driven chat app should describe, as a process rather than a form:

1. `get_forms`: choose the form that matches what the user wants.
2. `get_form_fields`: learn which fields it needs.
3. `get_field_info`: before asking about a field, learn its type, rules and exact options.
4. `collect_field_data`: record each answer, several at once when the user gives them.
5. `confirm_form_submission`: show a summary and ask for confirmation.
6. `submit_completed_form`: only after the user confirms.

To change a record: `find_submissions`, then `submission_update` after the user confirms.

## A minimal MCP client

This is a complete chat client in about 100 lines: it gets a token, connects to `/mcp`, offers the UAG's tools to Claude, and runs the tool loop until Claude answers in text. It contains no form-specific knowledge; change the form and the conversation changes. To offer a conversation on a web page without running this loop yourself, use the [chat widget](/developers/chat), whose turns the UAG runs with its own agent engine.

```bash
npm install @anthropic-ai/sdk @modelcontextprotocol/sdk
```

```js
// chat.mjs: node chat.mjs "I need to report that my internet is down"
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const UAG_URL = process.env.UAG_URL || 'http://localhost:3200';
const CLIENT_ID = process.env.UAG_CLIENT_ID || 'formio-oss-x-admin-key'; // <project>-x-token for Enterprise
const CLIENT_SECRET = process.env.UAG_CLIENT_SECRET;                      // ADMIN_KEY or PROJECT_KEY
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 15;

const SYSTEM = `You help a customer complete a request over chat, using the tools available.
1. Call get_forms and pick the form that matches what the customer wants. Never assume a form exists.
2. Call get_form_fields, then get_field_info before asking about a field, so you know its rules and allowed values.
3. Ask one question at a time. Never show field keys, JSON or tool names to the customer.
4. Record answers with collect_field_data as they arrive. Never invent a value.
5. When every required field is collected, call confirm_form_submission, show the summary and ask to confirm.
6. Only after the customer confirms, call submit_completed_form.`;

let token = null; // { value, expiresAt }

async function getToken() {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const response = await fetch(`${UAG_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  if (!response.ok) {
    throw new Error(`Token request failed (${response.status}). Check the client id and secret.`);
  }
  const body = await response.json();
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function connect() {
  const mcp = new Client({ name: 'uag-chat-example', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${UAG_URL}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${await getToken()}` } },
  });
  await mcp.connect(transport);
  return mcp;
}

/** One user turn: send the history to Claude and run every tool call it makes against the UAG. */
async function turn(anthropic, mcp, tools, messages, userText) {
  messages.push({ role: 'user', content: userText });
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools,
      messages,
    });
    // Keep the full content: tool_use blocks must stay in the history.
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    }

    // Run every tool call from this response, and return all results in one user message.
    const calls = response.content.filter((b) => b.type === 'tool_use');
    const results = await Promise.all(calls.map(async (call) => {
      try {
        const result = await mcp.callTool({ name: call.name, arguments: call.input });
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          content: (result.content || []).map((c) => ({ type: 'text', text: c.type === 'text' ? c.text : JSON.stringify(c) })),
          is_error: !!result.isError,
        };
      } catch (error) {
        return { type: 'tool_result', tool_use_id: call.id, content: `Tool call failed: ${error.message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
  return 'I could not finish that. Could you rephrase?';
}

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
const mcp = await connect();
try {
  // The UAG's tool schemas are JSON Schema already, so they pass straight to the Messages API.
  const { tools } = await mcp.listTools();
  const claudeTools = tools.map((t) => ({ name: t.name, description: t.description || '', input_schema: t.inputSchema }));

  const messages = [];
  console.log(await turn(anthropic, mcp, claudeTools, messages, process.argv[2] || 'What can you help me with?'));
} finally {
  await mcp.close();
}
```

Run it against the [Quickstart](/developers/quickstart) stack:

```bash
UAG_CLIENT_SECRET=CHANGEME ANTHROPIC_API_KEY=sk-ant-... node chat.mjs "I need to report that my internet is down"
```

To hold a conversation, keep `messages` per user session and call `turn` once per message; the UAG holds no conversation state, so the client must. Before you expose anything like this:

- **Authenticate each user.** This client uses an administrator credential, so the agent can read and write anything in the project. Give each user their own UAG token (through the PKCE flow, with `MCP_OAUTH`) so their roles apply to every tool call.
- **Keep the confirm step.** The form constrains what is collected and what is valid; it does not stop a model from submitting early. Require explicit confirmation before `submit_completed_form`, and consider gating write tools in your own code using the annotations.
- **Limit spend.** Every turn is a full tool loop. Rate-limit sessions.
- **Handle refusals and stop reasons.** Check `stop_reason` for `max_tokens` and `refusal` as well as `tool_use` and `end_turn`.

To use the UAG's tools without a model at all, call them directly: `await mcp.callTool({ name: 'get_forms', arguments: {} })`.
