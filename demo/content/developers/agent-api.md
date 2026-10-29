---
title: Agent API
description: A form's stateless agent operations (extract, decide, generate, and chat for conversation forms) and /agent/capabilities, with URLs, credentials, request bodies, response shapes, streaming, rate limits and error codes, and curl and fetch examples.
section: Build
order: 20
---

The Agent API runs a form's [tasks](/developers/concepts#tasks) inside the UAG. You post text or data to the form's own URL on the UAG, optionally naming a task, and get back validated values with a status, an engine and a reason for each field. The UAG chooses an engine for each field, calls it and checks the answers against the form. Applications call the same endpoints whichever models are behind them.

The Agent API is stateless: it answers from the data in the request, and never reads or saves a stored submission. To run a task on a submission and save its answers, send the submission to the UAG and add an **Agent: Run task** action to the form; see [Workflows](/developers/workflows).

| Endpoint | Saves | Needs | Purpose |
|---|---|---|---|
| [`POST {form}/agent/extract`](#extract) | No | Create or update access | Read free text (the request's `text`, or the task's input fields) and fill the task's fields from it: decisions and open values. Streams on request. |
| [`POST {form}/agent/decide`](#decide) | No | Create or update access | Choose the task's closed-set fields (options, yes/no) from the data already on the form. |
| [`POST {form}/agent/generate`](#generate) | No | Create or update access | Write the task's open values (summaries, rationales, replies) from the data already on the form, researching with `uagTools` if the task lists any. |
| [`POST {form}/agent/chat`](#chat) | No | Create access | One turn of a conversation that fills the form in: the next message, and the values taken from the person's words. What the [chat widget](/developers/chat) calls. No Agentic Formflow license. |
| [`GET /agent/capabilities`](#capabilities) | No | A UAG bearer token or a server key | The enabled engines, the operations they can serve, the edition, the license state, and whether durable runs and remote MCP sign-in are available. |

Every operation except `capabilities` needs at least one enabled engine (`UAG_ENGINES`, see [Engines](/developers/engines)). `extract`, `decide` and `generate` are part of Agentic Formflow, which needs a license (see [Licensing](#licensing)); `chat` is part of conversation forms, and does not.

## URLs

A form's operations are under the form, as its submissions are. `{form}` is the form's URL on the UAG: the form's path, or `form/{formId}`, under the project's URL on the UAG.

| Project on | Project URL on the UAG | Example |
|---|---|---|
| Form.io Open Source | The UAG's root | `https://uag.example.com/supportrequest/agent/extract` |
| Form.io Enterprise, or the hosted service | `/{projectName}`, or `/project/{projectId}` | `https://uag.example.com/myproject/supportrequest/agent/extract`, `https://uag.example.com/project/{projectId}/form/{formId}/agent/extract` |

The form comes from the URL; a `form` in the body is ignored. A form that is not tagged `uag` answers `404`, and so does an operation on a form the project does not have, whatever the letter case of its path; such a request is never passed on to Form.io. `GET /agent/capabilities` describes the deployment, not a form, so it stays at the UAG's root.

The examples on this page use the `supportRequest` form from [Concepts](/developers/concepts#a-complete-example): a `triage` task with an input (`description`), two decision fields (`category`, `urgent`), a confidence companion (`categoryConfidence`) and one value field (`summary`).

## Credentials

A form's operations take the same credentials as the form's submissions, so an application that signs users in with Form.io needs no other token. The credential decides who the operation runs as.

| Header | Runs as | Use from |
|---|---|---|
| `x-jwt-token: <Form.io user token>` | That user, verified with Form.io as for submissions. Form.io roles and permissions apply, including to any research the task does. | Browsers and applications acting for a signed-in user |
| `x-remote-token: <portal remote token>` | The portal team member, with what Form.io grants their team permission (`team_admin` and the owner as administrator; `team_write` may run the operations; `team_read` and `team_access` may not). | The Form.io portal, on a stage connected to the UAG |
| `Authorization: Bearer <UAG access token>` | That user (or, for `client_credentials`, administrator). | Servers, and MCP clients signed in with OAuth |
| `x-token: <PROJECT_KEY>` | Administrator | Servers (Enterprise and hosted projects) |
| `x-admin-key: <ADMIN_KEY>` | Administrator | Servers (Open Source) |

- **Bearer tokens** are the UAG's own access tokens, the same ones `/mcp` accepts: from the `client_credentials` grant at `/auth/token` for a server (which acts as administrator), always available, or, with `MCP_OAUTH`, from the browser OAuth (PKCE) sign-in for a user. See [MCP tools](/developers/mcp-tools#how-agents-connect).
- **Server keys are refused from browsers.** A request carrying `x-token` or `x-admin-key` together with an `Origin` or `Sec-Fetch-Site` header is answered `401`, so a project key cannot be used from a web page even if it leaks into one. Node's `fetch` sends neither header, so servers are unaffected. User and remote tokens are not server keys and work from browsers.
- **Scoped tokens are refused.** The short-lived tokens the UAG gives remote engines for research work only on `/mcp` (`401`: "Scoped tokens can only be used on /mcp.").
- **A request with no credential is refused** (`401`), unless the form opts into anonymous use. A form that sets [`uagAnonymous: "true"`](/developers/form-properties#uaganonymous) answers visitors with no credential, as the Anonymous role, when that role may create its submissions (otherwise `403`). Anonymous requests are limited per client address and in total, counted by each UAG process: `AGENT_ANONYMOUS_RATE_LIMIT` (default 10 a minute) and `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT` (default 100 a minute), or `agentApi.anonymous.rateLimit` and `totalRateLimit`. Over either limit the answer is `429` with `Retry-After`, before any engine is called; either set to `0` turns anonymous use off. See [Anonymous visitors](/developers/security#anonymous-visitors).

`GET /agent/capabilities` takes a UAG bearer token or a server key.

The examples on this page send a user's token as `$FORMIO_TOKEN`: the `x-jwt-token` response header of a Form.io login (`POST {project}/user/login`). From a server, send `-H "x-admin-key: $ADMIN_KEY"` (Open Source) or `-H "x-token: $PROJECT_KEY"` instead.

Every response, refusals included, carries an `X-Request-Id` header (send your own `X-Request-Id` to set it), and the same id is in every JSON body as `requestId`. Search the UAG logs for it when a request fails. Browsers can read the header: it is in the CORS exposed headers. Every error, whatever refused the request, has one shape; see [Errors](#errors).

## Common request fields

| Field | Type | Endpoints | Meaning |
|---|---|---|---|
| `task` | string | extract, decide, generate | The task (the `uag` value) to run. Defaults differ per endpoint; see each one. A body that names 1.x's `persona` and no `task` is refused with `400`, since ignoring it would run every task. Chat reads no task. |
| `data` | object | extract, decide, generate | The submission data to work from, nested as in a Form.io submission (`{ "customer": { "name": "..." } }`). |
| `overwrite` | boolean | extract, decide, generate | Default `false`: only empty fields are answered, and filled ones are listed in `excluded` as `already has a value`. |
| `text` | string | extract | Source text. Replaces the task's input for this call. |

Request bodies are limited to 5 MB; a larger one is answered `413` (`payload_too_large`).

## The result object

Extract, decide and generate answer with the same object:

```json
{
  "requestId": "3285ea93-e7ed-4cba-9ffc-e28ac9642856",
  "tasks": ["triage"],
  "data": { "description": "Billing question about my last invoice", "category": "billing", "categoryConfidence": 0.925, "urgent": true },
  "fields": {
    "category": {
      "path": "category", "task": "triage", "value": "billing", "status": "confident",
      "engine": "jev", "model": "jev-1.13.0", "calibrated": true, "confidence": 0.925,
      "reason": "confidence 0.92 ≥ threshold 0.6"
    },
    "urgent": {
      "path": "urgent", "task": "triage", "value": true, "status": "confident",
      "engine": "jev", "model": "jev-1.13.0", "calibrated": true, "confidence": 0.9,
      "reason": "affirmed 90%, denied 10%"
    },
    "summary": {
      "path": "summary", "task": "triage", "value": "Customer asks about a charge on their last invoice.",
      "status": "suggested", "engine": "claude", "model": "claude-opus-5-5", "calibrated": false,
      "reason": "extracted by an agent engine; not calibrated"
    }
  },
  "errors": [],
  "excluded": [
    { "path": "categoryConfidence", "reason": "holds the confidence of another field", "task": "triage" }
  ],
  "engines": [
    { "kind": "decision", "task": "triage", "engine": "jev", "model": "jev-1.13.0", "latencyMs": 212, "attempts": [] },
    { "kind": "value", "task": "triage", "engine": "claude", "model": "claude-opus-5-5", "latencyMs": 2140, "attempts": [] }
  ]
}
```

| Key | Content |
|---|---|
| `requestId` | The request's id. |
| `tasks` | The tasks that ran. |
| `data` | The request's `data` merged with every value returned, then validated by the form. |
| `fields` | One entry per answered field, by path. |
| `errors` | Validation errors on the merged data: `{ path, label, error }`. A field that fails validation is never `confident`; its `reason` starts with `failed validation`. |
| `excluded` | Target fields left out, with `reason` and `task`: `already has a value`, `hidden by the form's conditionals`, `inside repeating rows`, `not requested`, `holds the confidence of another field`. |
| `engines` | One entry per engine group that ran. |

### Field entries

| Key | Always | Meaning |
|---|---|---|
| `path` | Yes | The field's data path. |
| `task` | Yes | The task it belongs to. |
| `status` | Yes | `confident`, `uncertain`, `suggested` or `missing`. See [Statuses](/developers/concepts#statuses). |
| `engine`, `model` | Yes | The engine instance and model that answered, or `null` when none could. |
| `calibrated` | Yes | `true` only when the confidence comes from a decision engine. Agent engines, including when they answer a decision field as a fallback, are `false`. |
| `value` | When answered | The value, in the shape the component stores (a string, a boolean, an object for select boxes and surveys, an array for multi-value fields). |
| `confidence` | Decision engines | The normalized confidence, 0 to 1. |
| `alternatives` | Uncertain decisions | Up to three `{ value, label, confidence }`, most likely first. |
| `noMatch` | Resource selects | `true` when the input names a record that is not on file. `status` is then `missing`. |
| `newRecordName` | Resource selects | The name the input used for that record, when an agent engine is enabled, so your app can offer to create it. |
| `reason` | Usually | Why the field got its status, for example `not mentioned (mention check 4%)`, `the answer changed when the options were reversed`, or an engine's failure. |

### Engine entries

| Key | Meaning |
|---|---|
| `kind` | `decision` or `value`: which kind of fields the group held. |
| `task` | The group's task. |
| `engine`, `model` | Who answered, or `null` when no engine could. |
| `latencyMs` | Time for the group, including engines that were passed over. |
| `attempts` | Engines tried before the one that answered, each `{ engine, error }`: down, timed out, over its rate limit, or unable to use tools. |
| `toolCalls` | For research groups, the tools the engine called, in order: `{ name, isError }`. |

A group whose engines all failed does not fail the request: the answer is still `200`, the group's fields are `missing` with `engine: null` and a `reason` naming each engine's failure, and the other groups' values are returned.

An engine's own error messages (which can contain account details) are not passed through; `attempts` says `the engine failed (see the logs for request <id>)` and the full error is in the UAG log.

## Extract

`POST {form}/agent/extract`

Fills a task's fields from free text: decision fields go to a decision engine, open values to an agent engine, concurrently. Extraction gives models no tools. Nothing is saved.

| Field | Required | Meaning |
|---|---|---|
| `task` | No | The task. Without it: every task with an input, or every task when `text` is given. |
| `text` | One of `text`, or a task input in `data` | The source text. |
| `data` | No | The current data. The task's input field is read from here when `text` is absent. |
| `overwrite` | No | Answer filled fields too. |

```bash
curl -s -X POST https://uag.example.com/supportrequest/agent/extract \
  -H "x-jwt-token: $FORMIO_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "task": "triage",
        "data": { "description": "My internet has been completely down since last night", "accountNumber": "12345678" } }'
```

A task named without an input, and with no `text`, is refused with `400` (`The task "<task>" has no input, and the request gave no "text". Send "text", or flag the component(s) holding the source text with uag: "<task>" and uagField: "input".`).

### Streaming

Send `Accept: text/event-stream` to receive each engine group's results as soon as it finishes. Decision engines usually answer in a few hundred milliseconds and agent engines in seconds, so a client can apply decisions (and the conditional pages they turn on) before the slower values arrive.

| Event | Data | When |
|---|---|---|
| `result` | `{ kind, task, engine, model, latencyMs, attempts, fields, patch, toolCalls? , error? }` | Each engine group, as it finishes. `patch` holds the values to apply, including `uagConfidenceField` companions. |
| `error` | `{ kind, task, error, attempts }` | After the `result` of a group whose engines all failed. |
| `done` | The full [result object](#the-result-object) | Last. Then the stream closes. |

```
event: result
data: {"kind":"decision","task":"triage","engine":"jev","model":"jev-1.13.0","latencyMs":212,"attempts":[],"fields":{"category":{...},"urgent":{...}},"patch":{"category":"outage","categoryConfidence":0.91,"urgent":true}}

event: result
data: {"kind":"value","task":"triage","engine":"claude","model":"claude-opus-5-5","latencyMs":2140,"attempts":[],"fields":{"summary":{...}},"patch":{"summary":"Internet service fully down since last night."}}

event: done
data: {"requestId":"b1ff8531-...","tasks":["triage"],"data":{...},"fields":{...},"errors":[],"excluded":[...],"engines":[...]}
```

The stream opens only once the request is planned, so a request that is refused (bad credentials, unknown form or task, no engine, no license) gets an ordinary JSON error with its status. A failure after the stream opened arrives as a final `error` event carrying `{ requestId, error, code }`.

`EventSource` cannot send a POST body, so read the stream with `fetch`:

```js
// formUrl: the form's URL on the UAG, e.g. https://uag.example.com/supportrequest
async function extract({ formUrl, token, task, data, onResult }) {
  const response = await fetch(`${formUrl}/agent/extract`, {
    method: 'POST',
    headers: { 'x-jwt-token': token, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ task, data }),
  });
  if (!response.ok) {
    const { error, requestId } = await response.json();
    throw new Error(`${response.status}: ${error} (request ${requestId})`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const payload = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || 'null');
      if (event === 'result') onResult?.(payload);       // apply payload.patch as it arrives
      if (event === 'error' && !payload.kind) throw new Error(payload.error);
      if (event === 'done') return payload;              // the full result object
    }
  }
}
```

[`@formio/uag-js`](/developers/renderer) does this for a formio.js form or wizard, and never overwrites what the user typed.

## Decide

`POST {form}/agent/decide`

Decides a task's closed-set fields from in-flight data, quickly, with a calibrated confidence for each. Value fields are listed in `excluded` as `not requested`. Decision models are given no tools. Nothing is saved, and the response is always plain JSON.

| Field | Required | Meaning |
|---|---|---|
| `task` | No | The task. Without it: every task, each with its own criteria. |
| `data` | No | The data to decide from. |
| `overwrite` | No | Re-decide filled fields too. |

```bash
curl -s -X POST https://uag.example.com/supportrequest/agent/decide \
  -H "x-jwt-token: $FORMIO_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "data": { "description": "Billing question about my last invoice" } }'
```

A `submissionId` is refused with `400` ("Decide works on the data in the request and saves nothing."): decide never reads a stored submission. To decide a submission's fields on the server and save them, add an "Agent: Run task" action that answers its decision fields only, before the save; see [Re-deciding on the server](/developers/workflows#re-deciding-on-the-server).

With no decision engine enabled, decision fields fall back to an agent engine, reported `suggested` and `calibrated: false`.

## Generate

`POST {form}/agent/generate`

Writes a task's open values (text, dates, amounts, scores) from in-flight data with an agent engine. Decision fields are listed in `excluded` as `not requested`. When the task's criteria lists read-only tools in `uagTools`, the engine may research with them first, as the caller. Nothing is saved, and the response is always plain JSON.

| Field | Required | Meaning |
|---|---|---|
| `task` | No | The task. Without it: every task. |
| `data` | No | The data to work from. |
| `overwrite` | No | Generate filled fields too. |

```bash
curl -s -X POST https://uag.example.com/supportrequest/agent/generate \
  -H "x-jwt-token: $FORMIO_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "task": "triage", "data": { "description": "Billing question about my last invoice" } }'
```

A task whose `uagTools` names a tool that may write, or does not exist, is refused with `400`.

To get decisions and values for the same data, call `decide` and `generate` at the same time. Decisions come back first, without waiting for the slower model.

## Chat

`POST {form}/agent/chat`

One turn of a conversation that fills the form in. The client sends the conversation so far and the form's current data; one agent engine reads them, with the form's fields, rules and options, and returns the values the person gave and the next message to them. The UAG checks every value against the form, and answers with the reply, the values it accepted, and what the form still needs. Nothing is stored and nothing is saved: the client keeps the conversation and the data, and submits the form itself (to the UAG, so its actions run) once the person confirms. The [chat widget](/developers/chat) in `@formio/uag-js` does all of this for you.

Chat is part of conversation forms, like the MCP tools: it needs an agent engine but no Agentic Formflow license. It runs on Form.io Open Source and on the hosted service with an unlicensed UAG; a self-hosted Enterprise project needs a license that includes the UAG to be served at all (see [Editions](/developers/deployment#editions)), and nothing more for chat.

| Field | Required | Meaning |
|---|---|---|
| `messages` | Yes | The conversation: 1 to `agentApi.chat.maxMessages` (default 40) entries of `{ "role": "user" \| "assistant", "content": "<text>" }`, each at most `agentApi.chat.maxMessageLength` characters (default 2000), ending with the person's (`user`). The engine is sent the newest messages within `agentApi.chat.maxTranscriptChars` (default 24000), starting at one the person wrote. |
| `data` | No | The form's current data, nested as in a submission. |
| `locked` | No | Field paths the person set in the form itself (at most 500). The turn neither asks for nor changes them; their values are shown to the engine as collected. The chat widget sends the fields the person edited in the form view. |

```bash
curl -s -X POST https://uag.example.com/servicerequest/agent/chat \
  -H "x-jwt-token: $FORMIO_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "messages": [{ "role": "user", "content": "I am Marcus Webb, marcus@example, and my internet is completely down" }],
        "data": {} }'
```

```json
{
  "requestId": "4b1f0c2e-…",
  "reply": "Sorry to hear that, Marcus. That email doesn't look complete. Could you type it again?",
  "patch": { "fullName": "Marcus Webb", "category": "internet", "urgency": "high" },
  "data": { "fullName": "Marcus Webb", "category": "internet", "urgency": "high" },
  "fields": {
    "fullName": { "path": "fullName", "label": "Full Name", "status": "suggested", "value": "Marcus Webb" },
    "email": { "path": "email", "label": "Email", "status": "invalid", "value": "marcus@example", "error": "Email must be a valid email." },
    "category": { "path": "category", "label": "Category", "status": "suggested", "value": "internet" },
    "urgency": { "path": "urgency", "label": "Urgency", "status": "suggested", "value": "high" }
  },
  "errors": [],
  "remaining": {
    "required": [{ "path": "email", "label": "Email" }, { "path": "serviceAddress", "label": "Service Address" }, { "path": "description", "label": "Description of the Problem" }],
    "optional": [{ "path": "callbackTime", "label": "Best Callback Time" }],
    "unsupported": []
  },
  "complete": false,
  "confirmed": false,
  "engine": { "name": "claude", "model": "claude-sonnet-5-5", "latencyMs": 2140, "toolCalls": [], "usage": { "inputTokens": 1820, "outputTokens": 140 } }
}
```

| Key | Meaning |
|---|---|
| `reply` | The assistant's next message to the person, at most `agentApi.chat.maxMessageLength` characters, so the client can send it back with the next turn. |
| `patch` | The values accepted this turn, by data path: new or changed values the form accepts. Write them into the form. |
| `data` | The request's data with `patch` applied. |
| `fields` | Each value the engine gave this turn: `suggested` (accepted, in `patch`) or `invalid` (refused, with the form's `error`; the data keeps its earlier value). |
| `errors` | The validation errors the merged data still has, other than missing required values. |
| `remaining` | What the form still needs on the merged data, conditionals applied: empty `required` and `optional` fields, and `unsupported` ones (`path`, `label`, `required`, `empty`) the chat cannot collect, which the person fills in the form. |
| `complete` | `true` when no required field is empty (`unsupported` ones included) and there are no `errors`: the form can be submitted. |
| `confirmed` | `true` when the person's last message confirms the answers they were shown, the request's data was already complete, and this turn neither changed nor refused a value. The client may then submit. The UAG never does. |
| `engine` | The engine that answered: `name`, `model`, `latencyMs`, the `check_values` calls it made (`toolCalls`), and its token `usage`, for your own accounting. |

### What a turn collects

A turn asks for, and accepts, only the form's visible input fields a person may enter. It never sets a [task](/developers/concepts#tasks)'s decision or value fields (a task's input is asked like any field), `uagAuthoritative` fields, hidden or disabled fields, fields inside a hidden panel or container, fields hidden by a conditional, calculated fields (unless they allow overrides) or fields that are not persisted; values the engine returns for them are dropped, and values the request's `data` holds for them are passed through untouched. Data grids, edit grids, data tables, dynamic wizards, tag pads, nested forms, data maps, addresses, file uploads, signatures, sketch pads, data sources, passwords, CAPTCHAs, selects whose options come from a URL or a resource, and any other component that holds rows or a nested object (a `tree` component, or one whose data is an array of rows, a nested submission or a map) are reported in `remaining.unsupported`. Values are checked for their shape (numbers, booleans, options, the keys of select boxes and surveys) before the form's validation. See [The fields a chat collects](/developers/chat#the-fields-a-chat-collects).

### How a turn is answered

1. The UAG reads the form's collectable fields on the request's data, each with the label, description, format, options and value rule the MCP tools give agents.
2. It calls one agent engine through the ordinary agent-engine `extract` contract (see [Engine SDK](/developers/engine-sdk#agent-engines)): the instructions are the UAG's chat instructions, the form's title and description, and the form's [`uagChatInstructions`](/developers/form-properties#uagchatinstructions); the state carries the conversation, what is already collected and what is still needed; the fields are the collectable ones plus two of the turn's own, `-reply` (the next message) and `-confirmed`. No engine needs anything new to serve chat.
3. Agent engines that run in the UAG and declare `toolUse` also get one read-only tool, `check_values`, which validates values against the form before the engine answers, so its reply can explain a refusal. It saves nothing.
4. The UAG normalizes the values as `collect_field_data` does, merges them into the data and validates the result with the form's own rules. A refused value is put back and reported `invalid`. When a value was refused and the engine did not check it first (remote engines, and engines without `toolUse`), the UAG asks the same engine once more for the reply alone, with the refusals, so the reply never says something was recorded when it was not.

The conversation is the person's words, not instructions: the engine is told so, it has no tool that writes, its values are limited to fields the person could have entered themselves and checked against the form, and it cannot submit. See [Security](/developers/security#chat).

### Engines, timeouts and failures

Engines are tried in the order of `agentApi.chat.engines` (default `['agent']`: every agent engine, in registration order), each within `agentApi.chat.timeout` (default: the engine's routing timeout) and the engine rate limits. On a failure, a timeout or a rate limit, the next engine is tried. With no agent engine enabled the answer is `503`; when every engine fails, `502` (the engines' own errors are logged with the request id, not returned); when every engine was over its rate limit, `429` with `Retry-After`.

### Chat settings

| Setting (`config`) | Default | Meaning |
|---|---|---|
| `agentApi.chat.engines` | `['agent']` | Engine names, or `agent` for every agent engine, in the order to try them. |
| `agentApi.chat.timeout` | the engine's routing timeout | Milliseconds to wait for one engine before trying the next. |
| `agentApi.chat.maxIterations` | `3` | Rounds of `check_values` calls an engine may make before it answers. |
| `agentApi.chat.maxMessages` | `40` | The most messages a turn may carry. |
| `agentApi.chat.maxMessageLength` | `2000` | The most characters in one message. |
| `agentApi.chat.maxTranscriptChars` | `24000` | The most characters of conversation sent to the engine; older messages are left out. |

A form can turn chat off with [`uagChat: "false"`](/developers/form-properties#uagchat) (its turns answer `403`).

## Capabilities

`GET /agent/capabilities`

Lists the enabled engines, which operations each can serve, the edition, whether Agentic Formflow may run, and which of the features that need the UAG's database are on. It always answers, licensed or not, so a client can check before calling anything else.

```bash
curl -s https://uag.example.com/agent/capabilities -H "Authorization: Bearer $TOKEN"
```

```json
{
  "requestId": "f79dcf1c-11d7-4387-be12-e6c54527e2a6",
  "engines": [
    { "name": "jev", "kind": "decision", "model": "jev-1.13.0", "type": "jev", "package": "@formio/uag-jev", "version": "2.0.0" },
    { "name": "claude", "kind": "agent", "model": "claude-opus-5-5", "type": "claude", "package": "@formio/uag-claude", "version": "2.0.0" }
  ],
  "operations": {
    "extract": { "available": true, "engines": ["jev", "claude"] },
    "decide": { "available": true, "engines": ["jev", "claude"] },
    "generate": { "available": true, "engines": ["claude"] },
    "chat": { "available": true, "engines": ["claude"] }
  },
  "edition": "enterprise",
  "formflow": { "licensed": true, "allowed": true, "reason": "licensed" },
  "durableRuns": true,
  "mcpOAuth": false
}
```

| Key | Meaning |
|---|---|
| `engines` | Each instance: `name` (as named in `UAG_ENGINES`), `kind` (`decision` or `agent`), `model`, and the `type`, `package` and `version` it came from. Never its settings. |
| `operations` | For each operation, whether it can be served (`available`: licensed or allowed, and at least one engine can do its work) and the engines that would. Agent engines appear under `decide` because they are the fallback for decision fields. `chat` needs no Agentic Formflow license: it is available whenever an agent engine is enabled, and lists the engines `agentApi.chat.engines` names. |
| `edition` | `enterprise` when a license verified or the project is on Form.io's hosted SaaS, otherwise `open-source`. |
| `formflow.reason` | `licensed`, `hosted`, `stub-engines` or `unlicensed`. See [Licensing](#licensing). |
| `durableRuns` | `true` when the UAG's database is in use: Run task runs are recorded, and runs after the save that act with an agent role survive a restart. `false` means runs after the save are kept in memory, best effort. |
| `mcpOAuth` | `true` when remote MCP clients can sign in with OAuth: `MCP_OAUTH=true` and the UAG's database is in use. |

## Errors

Every error from a form's agent operations and `/agent/capabilities` is JSON in one shape, whatever refused the request (the operation, the credential check, the project's authentication, the body parser):

```json
{ "requestId": "b1ff8531-...", "error": "Chat is turned off for the form \"servicerequest\".", "code": "chat_disabled" }
```

`requestId` equals the `X-Request-Id` header. `error` is for people and may change; branch on `code`, which is stable. A `license_required` error also carries `edition`. A `500` never carries details: its `error` is "The request failed. See the UAG logs for this request id."

| Status | `code` | Cause |
|---|---|---|
| `400` | `invalid_request` | An unknown task (the message lists the form's tasks); a form with no tasks; extract with no `text` for a task with no input; `persona` with no `task`; `submissionId` sent to decide; a task whose `uagTools` names a tool that may write or does not exist (generate); a body that is not JSON; a chat turn whose `messages` are missing, too many, too long, malformed or do not end with the person's, whose `data` is not an object, or whose `locked` is not a list of at most 500 paths. |
| `401` | `unauthorized` | No valid credential: an invalid or expired `x-jwt-token`, `x-remote-token` or bearer token; a wrong server key, or one sent with an `Origin` or `Sec-Fetch-Site` header; a scoped token; a portal team member whose permission does not allow writes. |
| `401` | `sign_in_required` | No credential, on a form that does not allow anonymous use (`uagAnonymous`, and anonymous limits not `0`). |
| `403` | `license_required` | Agentic Formflow is not licensed. The license is checked before the form's tasks are read, so an unlicensed deployment answers it for `extract`, `decide` and `generate` on every form, tagged `uag` or not. Chat never needs a license. |
| `403` | `forbidden` | The caller lacks the form access the operation needs (for an anonymous visitor, the Anonymous role may not create the form's submissions). |
| `403` | `chat_disabled` | Chat: the form sets `uagChat: "false"`. |
| `404` | `form_not_found` | The form does not exist or is not tagged `uag`. The operations at the UAG's root (`/agent/extract`, `/agent/decide`, `/agent/generate`) no longer exist. |
| `413` | `payload_too_large` | The request body is larger than 5 MB. |
| `429` | `rate_limited` | The caller is over its rate limit, an anonymous visitor is over the anonymous limits, or every engine that could answer is. Carries `Retry-After` in seconds when the caller is limited, and, for chat, when every engine is. |
| `500` | `internal_error` | An unexpected failure; see the UAG's log under the request id. |
| `502` | `engines_failed` | Chat: every engine that could answer failed or timed out. The engines' errors are in the UAG's logs, under the request id. |
| `503` | `no_engine` | No enabled engine can serve the operation ("Enable one with UAG_ENGINES"); for chat, no agent engine is enabled. |

The project's Form.io routes (forms, submissions, login) keep Form.io's answers, so formio.js shows them as it does Form.io's: a submission refused by a Run task before the save is `{ name, message, code }` (see [Workflows](/developers/workflows#failures)). `/auth/token` answers OAuth errors (see [MCP tools](/developers/mcp-tools#how-agents-connect)).

## Rate limits

Callers and engines can be limited with `agentApi.rateLimits` in the UAG configuration (a [module](/developers/modules)'s `config`, or `new UAGServer(config)`):

```js
module.exports = {
  config: {
    agentApi: {
      rateLimits: {
        caller: { extract: { limit: 30, windowMs: 60000 }, generate: { limit: 10 }, default: { limit: 60 } },
        engine: { claude: { limit: 100, windowMs: 60000 }, default: { limit: 300 } }
      }
    }
  }
};
```

| Setting | Keyed by | Behavior |
|---|---|---|
| `caller` | Operation: `extract`, `decide`, `generate`, `chat`, `capabilities`, or `default` | Counted per caller (the user's id) before anything else runs. Over the limit: `429` with `Retry-After`. |
| `engine` | Engine instance name, or `default` | An engine over its limit is skipped and the next engine in the routing list is tried. `429` only when every engine that could answer is over its limit. |

Each limit is `{ limit, windowMs }`, a fixed window (`windowMs` defaults to 60000). A scope with no limit, and no `default`, is unlimited. Counters are kept in memory per process, so each instance of a multi-instance deployment has its own allowance.

> **Note:** Callers without a user of their own share a counter: every request with a server key (`x-token`, `x-admin-key`) and every anonymous visitor count as one caller, and all `client_credentials` tokens as another. Size `caller` limits for servers with that in mind.

## Licensing

The Agent API's `extract`, `decide` and `generate`, the "Agent: Run task" action, the `agent_decide` and `agent_provide` MCP tools and `uag-eval` together are **Agentic Formflow**. They need a license (`LICENSE_KEY`) that includes the UAG (see [Licensing](/developers/deployment#licensing)) and allows the project's endpoint (any license allows `localhost`), or a project on Form.io's hosted SaaS (`https://<project>.form.io`), which runs under Form.io's own license (`reason: "hosted"`). With such a license they run on Form.io Open Source as well as Enterprise. A project on the UAG's own machine needs a license too. Conversation forms need neither, and run on Form.io Open Source with an unlicensed UAG.

The one other allowance is the built-in stub engines, `UAG_ENGINES=stub-decision,stub-agent` (`reason: "stub-engines"`), which answer with placeholders so you can build against the API's shape. It covers work that calls engines; `agent_decide` and `agent_provide`, which call none, still need a license or a hosted project.

Otherwise every Agentic Formflow request is refused with `403`:

```json
{ "requestId": "...", "error": "Agentic Formflow requires a license (LICENSE_KEY) that includes the UAG ...", "code": "license_required", "edition": "open-source" }
```

The other MCP tools and conversation forms never need a license, and neither does a form's [chat](#chat) (`agent/chat`), which is part of conversation forms. See [Deployment](/developers/deployment#licensing) for where licenses apply.

## Configuration reference

| Setting (`config`) | Default | Meaning |
|---|---|---|
| `engines` | `UAG_ENGINES` | Engine instances to enable. See [Engines](/developers/engines). |
| `routing.decision`, `routing.value` | `['decision', 'agent']`, `['agent']` | Engine preference lists, tried in order. |
| `routing.timeouts[engine]` | `agentApi.timeout` | Milliseconds before one engine is abandoned and the next tried. |
| `agentApi.timeout` | `30000` | Default engine timeout. |
| `agentApi.research.timeout` | `120000` | Milliseconds a researching agent engine may take, and its scoped token's lifetime. |
| `agentApi.research.maxIterations` | `10` | Tool-use round trips before a researching engine must answer. |
| `agentApi.threshold` | `0.5` | Default `uagThreshold`. |
| `agentApi.uncertainBand` | `[0.2, 0.8]` | Default `uagUncertainBand`. |
| `agentApi.rateLimits` | none | See [Rate limits](#rate-limits). |
| `agentApi.anonymous.rateLimit` | `AGENT_ANONYMOUS_RATE_LIMIT`, else `10` | Anonymous requests a minute per client address. `0` turns anonymous use off. |
| `agentApi.anonymous.totalRateLimit` | `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT`, else `100` | Anonymous requests a minute in total. `0` turns anonymous use off. |
| `agentApi.chat.*` | | A form's chat: its engines, timeout and bounds. See [Chat settings](#chat-settings). |
