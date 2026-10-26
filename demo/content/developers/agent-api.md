---
title: Agent API
description: Every /agent endpoint, with request bodies, response shapes, streaming, credentials, rate limits and error codes, and curl and fetch examples.
section: Build
order: 20
---

The Agent API runs a form's [tasks](/developers/concepts#tasks) inside the UAG. You name a form and a task, send text or data, and get back validated values with a status, an engine and a reason for each field. The UAG chooses an engine for each field, calls it, checks the answers against the form, and, for `provide`, saves them. Applications call the same endpoints whichever models are behind them.

| Endpoint | Saves | Needs | Purpose |
|---|---|---|---|
| [`POST /agent/extract`](#post-agentextract) | No | Create or update access | Read free text (the request's `text`, or the task's input fields) and fill the task's fields from it: decisions and open values. Streams on request. |
| [`POST /agent/decide`](#post-agentdecide) | No | Create or update access | Choose the task's closed-set fields (options, yes/no) from the data already on the form. |
| [`POST /agent/generate`](#post-agentgenerate) | No | Create or update access | Write the task's open values (summaries, rationales, replies) from the data already on the form, researching with `uagTools` if the task lists any. |
| [`POST /agent/provide`](#post-agentprovide) | Yes, once | Update access | Fill a task in on a stored submission. For webhooks. |
| [`GET /agent/capabilities`](#get-agentcapabilities) | No | Any credential | The enabled engines, the operations they can serve, the edition and the license state. |

Every operation except `capabilities` needs at least one enabled engine (`UAG_ENGINES`, see [Engines](/developers/engines)) and is part of Agentic Formflow, which needs a license (see [Licensing](#licensing)).

The examples on this page use the `supportRequest` form from [Concepts](/developers/concepts#a-complete-example): a `triage` task with an input (`description`), two decision fields (`category`, `urgent`), a confidence companion (`categoryConfidence`) and one value field (`summary`).

## Credentials

Every endpoint authenticates first. The credential decides who the operation runs as.

| Header | Runs as | Use from |
|---|---|---|
| `Authorization: Bearer <UAG access token>` | That user. Form.io roles and permissions apply, including to any research the task does. | Browsers and applications acting for a user |
| `x-token: <PROJECT_KEY>` | Administrator | Servers and Form.io webhooks (Enterprise) |
| `x-admin-key: <ADMIN_KEY>` | Administrator | Servers (Open Source) |

- **Bearer tokens** are the UAG's own access tokens, the same ones `/mcp` accepts: from the browser OAuth (PKCE) flow for a user, or from the `client_credentials` grant for a server (which acts as administrator). See [MCP tools](/developers/mcp-tools#how-agents-connect).
- **Admin credentials are refused from browsers.** A request carrying `x-token` or `x-admin-key` together with an `Origin` or `Sec-Fetch-Site` header is answered `401`, so a project key cannot be used from a web page even if it leaks into one. Node's `fetch` sends neither header, so servers are unaffected.
- **Scoped tokens are refused.** The short-lived tokens the UAG gives remote engines for research work only on `/mcp` (`401`: "Scoped tokens can only be used on /mcp.").

A refused credential is answered `401` with `{ "detail": "..." }`. Every response after authentication carries an `X-Request-Id` header (send your own `X-Request-Id` to set it), and the same id is in every JSON body as `requestId`. Search the UAG logs for it when a request fails. Browsers can read the header: it is in the CORS exposed headers.

## Common request fields

| Field | Type | Endpoints | Meaning |
|---|---|---|---|
| `form` | string | All | The form's name or path. A form definition is refused (`400`): forms are always named, so the server's own thresholds, options and permissions apply. |
| `task` | string | All | The task (the `uag` value) to run. Defaults differ per endpoint; see each one. |
| `data` | object | extract, decide, generate | The submission data to work from, nested as in a Form.io submission (`{ "customer": { "name": "..." } }`). |
| `overwrite` | boolean | extract, decide, generate | Default `false`: only empty fields are answered, and filled ones are listed in `excluded` as `already has a value`. |
| `text` | string | extract | Source text. Replaces the task's input for this call. |
| `submissionId` | string | provide | The stored submission. |

`persona` is accepted for `task`, and `formName` for `form` on `/agent/provide`, for 1.x webhooks. Sending both names with different values is refused with `400`. Request bodies are limited by the UAG's `MAX_BODY_SIZE` (default `100mb`).

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

In extract, decide and generate, a group whose engines all failed does not fail the request: the answer is still `200`, the group's fields are `missing` with `engine: null` and a `reason` naming each engine's failure, and the other groups' values are returned. Only `provide` refuses to save in that case.

An engine's own error messages (which can contain account details) are not passed through; `attempts` says `the engine failed (see the logs for request <id>)` and the full error is in the UAG log.

## `POST /agent/extract`

Fills a task's fields from free text: decision fields go to a decision engine, open values to an agent engine, concurrently. Extraction gives models no tools. Nothing is saved.

| Field | Required | Meaning |
|---|---|---|
| `form` | Yes | The form. |
| `task` | No | The task. Without it: every task with an input, or every task when `text` is given. |
| `text` | One of `text`, or a task input in `data` | The source text. |
| `data` | No | The current data. The task's input field is read from here when `text` is absent. |
| `overwrite` | No | Answer filled fields too. |

```bash
curl -s -X POST https://uag.example.com/agent/extract \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "form": "supportRequest", "task": "triage",
        "data": { "description": "My internet has been completely down since last night", "accountNumber": "12345678" } }'
```

A task named without an input, and with no `text`, is refused with `400` ("has no input, and the request gave no text").

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

The stream opens only once the request is planned, so a request that is refused (bad credentials, unknown form or task, no engine, no license) gets an ordinary JSON error with its status. A failure after the stream opened arrives as a final `error` event carrying `{ requestId, error }`.

`EventSource` cannot send a POST body, so read the stream with `fetch`:

```js
async function extract({ baseUrl, token, form, task, data, onResult }) {
  const response = await fetch(`${baseUrl}/agent/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ form, task, data }),
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

The [renderer plugin](/developers/renderer) does this for a formio.js form or wizard, and never overwrites what the user typed.

## `POST /agent/decide`

Decides a task's closed-set fields from in-flight data, quickly, with a calibrated confidence for each. Value fields are listed in `excluded` as `not requested`. Decision models are given no tools. Nothing is saved, and the response is always plain JSON.

| Field | Required | Meaning |
|---|---|---|
| `form` | Yes | The form. |
| `task` | No | The task. Without it: every task, each with its own criteria. |
| `data` | No | The data to decide from. |
| `overwrite` | No | Re-decide filled fields too. |

```bash
curl -s -X POST https://uag.example.com/agent/decide \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "form": "supportRequest", "data": { "description": "Billing question about my last invoice" } }'
```

`submissionId` is refused with `400`: decide never touches a stored submission. To decide and save, use `provide`.

With no decision engine enabled, decision fields fall back to an agent engine, reported `suggested` and `calibrated: false`.

## `POST /agent/generate`

Writes a task's open values (text, dates, amounts, scores) from in-flight data with an agent engine. Decision fields are listed in `excluded` as `not requested`. When the task's criteria lists read-only tools in `uagTools`, the engine may research with them first, as the caller. Nothing is saved, and the response is always plain JSON.

| Field | Required | Meaning |
|---|---|---|
| `form` | Yes | The form. |
| `task` | No | The task. Without it: every task. |
| `data` | No | The data to work from. |
| `overwrite` | No | Generate filled fields too. |

```bash
curl -s -X POST https://uag.example.com/agent/generate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "form": "supportRequest", "task": "triage", "data": { "description": "Billing question about my last invoice" } }'
```

A task whose `uagTools` names a tool that may write, or does not exist, is refused with `400`.

To get decisions and values for the same data, call `decide` and `generate` at the same time. Decisions come back first, without waiting for the slower model.

## `POST /agent/provide`

Fills a task in on a stored submission and saves it once. This is the endpoint Form.io webhooks call; see [Workflows](/developers/workflows).

| Field | Required | Meaning |
|---|---|---|
| `form` | Yes | The form. `formName` is still accepted. |
| `submissionId` | Yes | The submission. |
| `task` | When the form has several tasks | The task. A form with one task may omit it; a form with several must name one (`400` otherwise). |

```bash
curl -s -X POST http://formio-uag:3200/agent/provide \
  -H "x-token: $PROJECT_KEY" -H 'Content-Type: application/json' \
  -d '{ "form": "supportRequest", "task": "triage", "submissionId": "6adb35dbdf079c3b9f574a99" }'
```

What it does, in order:

1. Loads the submission with the caller's identity (`404` if it is not found).
2. Plans the task on the stored data. Decision fields are planned even when they are filled or hidden, so they can be re-decided. Value fields are planned only when empty and visible.
3. Runs the engines. Agent engines may research with the task's `uagTools`.
4. If some fields could not be answered at all (every engine that could answer them failed, timed out or was over its rate limit, or, for decision fields, none is enabled), stops: nothing is cleared and nothing is saved, and the answer is `503`, or `429` when every engine was over its rate limit. Value fields that no enabled engine can answer are left empty instead.
5. Reconciles the answers with the stored data:
   - a decision field takes a `confident` answer, or an agent engine's answer when it has `uagAgentDecides: "true"`;
   - a `uagAuthoritative: "true"` field the server could not confirm is cleared;
   - any other decision field keeps its stored value, which a person may have confirmed;
   - a value field takes a generated value only while it is empty.
6. If the submission changed while the engines ran, runs the task again on the new version rather than save over the change. If it changes again, answers `409` and saves nothing.
7. Saves only when a value changed or was cleared. A changed confidence alone does not count. The save goes back through Form.io, with full validation, and runs the form's actions.

```json
{
  "requestId": "02ed0abb-2cd6-4ce9-9416-9c7ed9b39188",
  "task": "triage",
  "submissionId": "6adb35dbdf079c3b9f574a99",
  "written": { "category": "outage", "urgent": true, "summary": "Internet service fully down since last night." },
  "cleared": [],
  "fields": { "category": { "...": "..." }, "urgent": { "...": "..." }, "summary": { "...": "..." } },
  "excluded": [ { "path": "categoryConfidence", "reason": "holds the confidence of another field", "task": "triage" } ],
  "engines": [ { "kind": "decision", "...": "..." }, { "kind": "value", "...": "..." } ],
  "modified": "2026-10-23T10:24:27.115Z"
}
```

| Key | Meaning |
|---|---|
| `written` | Only the paths whose value changed, with the new value. Empty when nothing changed, in which case nothing was saved. |
| `cleared` | `uagAuthoritative` paths that held a value the server could not confirm, now emptied. |
| `fields`, `excluded`, `engines` | As in the [result object](#the-result-object). |
| `modified` | The submission's `modified` timestamp after the call. |

Running `provide` again on a submission it already filled saves nothing and returns `written: {}`, so a webhook its own save triggers is harmless, and calling it by hand is a safe way to see what the engines answer for a submission. Each reconciled value's provenance is recorded in `metadata.uag`; see [Reconciliation and provenance](/developers/concepts#reconciliation-and-provenance).

When the reconciled submission fails the form's validation (new decisions can make a page apply whose required fields are empty), nothing is saved and the answer is `422`:

```json
{
  "requestId": "...",
  "task": "triage",
  "error": "The task's values could not be saved because the submission would no longer be valid.",
  "details": [ { "path": "vehicle.make", "message": "Make is required" } ],
  "fields": { "...": "..." }
}
```

## `GET /agent/capabilities`

Lists the enabled engines, which operations each can serve, the edition and whether Agentic Formflow may run. It always answers, licensed or not, so a client can check before calling anything else.

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
    "provide": { "available": true, "engines": ["jev", "claude"] }
  },
  "edition": "enterprise",
  "formflow": { "licensed": true, "allowed": true, "reason": "licensed" }
}
```

| Key | Meaning |
|---|---|
| `engines` | Each instance: `name` (as named in `UAG_ENGINES`), `kind` (`decision` or `agent`), `model`, and the `type`, `package` and `version` it came from. Never its settings. |
| `operations` | For each operation, whether it can be served (`available`: licensed or allowed, and at least one engine can do its work) and the engines that would. Agent engines appear under `decide` because they are the fallback for decision fields. |
| `edition` | `enterprise` when a license verified or the project is on Form.io's hosted SaaS, otherwise `open-source`. |
| `formflow.reason` | `licensed`, `hosted`, `stub-engines` or `unlicensed`. See [Licensing](#licensing). |

## Errors

Error bodies are `{ requestId, error }`, with `code` and `edition` added when the license is missing. A `500` says only "The request failed. See the UAG logs for this request id."

| Status | Cause |
|---|---|
| `400` | Missing `form` or `submissionId`; a form definition instead of a name; an unknown task (the message lists the form's tasks); a form with no tasks; a form with several tasks and no `task` (provide); extract with no `text` for a task with no input; `submissionId` sent to decide; `task` and `persona` (or `form` and `formName`) that disagree; a task whose `uagTools` names a tool that may write or does not exist (generate, provide). |
| `401` | No valid credential; an admin credential sent with an `Origin` or `Sec-Fetch-Site` header; a scoped token. Body: `{ detail }`. |
| `403` | Agentic Formflow is not licensed (`code: "license_required"`), or the caller lacks the form access the operation needs. The license is checked before the form is loaded, so an unlicensed deployment answers `403` even for a form that does not exist. |
| `404` | The form does not exist or is not tagged `uag`, or the submission was not found. |
| `409` | Provide: the submission kept changing while the task ran. Nothing was saved; try again. |
| `422` | Provide: the reconciled submission fails validation. Nothing was saved; `details` lists why. |
| `429` | The caller is over its rate limit, or every engine that could answer is. Carries `Retry-After` in seconds when the caller is limited. |
| `503` | No enabled engine can serve the operation ("Enable one with UAG_ENGINES"); or, for provide, some fields could not be answered at all, so nothing was saved. |

## Rate limits

Callers and engines can be limited with `agentApi.rateLimits` in the UAG configuration (a [module](/developers/modules)'s `config`, or `new UAGServer(config)`):

```js
module.exports = {
  config: {
    agentApi: {
      rateLimits: {
        caller: { extract: { limit: 30, windowMs: 60000 }, provide: { limit: 10 }, default: { limit: 60 } },
        engine: { claude: { limit: 100, windowMs: 60000 }, default: { limit: 300 } }
      }
    }
  }
};
```

| Setting | Keyed by | Behavior |
|---|---|---|
| `caller` | Operation: `extract`, `decide`, `generate`, `provide`, `capabilities`, or `default` | Counted per caller (the user's id) before anything else runs. Over the limit: `429` with `Retry-After`. |
| `engine` | Engine instance name, or `default` | An engine over its limit is skipped and the next engine in the routing list is tried. `429` only when every engine that could answer is over its limit. |

Each limit is `{ limit, windowMs }`, a fixed window (`windowMs` defaults to 60000). A scope with no limit, and no `default`, is unlimited. Counters are kept in memory per process, so each instance of a multi-instance deployment has its own allowance.

> **Note:** Callers that authenticate with an admin credential have no user id, so they share one counter; so do all `client_credentials` tokens. Size `caller` limits for webhooks with that in mind.

## Licensing

The Agent API, the `agentDecide` action, the `agent_decide` and `agent_provide` MCP tools and `uag-eval` together are **Agentic Formflow**. They need a license (`LICENSE_KEY`) that includes the UAG (see [Licensing](/developers/deployment#licensing)) and allows the project's endpoint (any license allows `localhost`), or a project on Form.io's hosted SaaS (`https://<project>.form.io`), which runs under Form.io's own license (`reason: "hosted"`). A project on the UAG's own machine needs a license too. Conversation forms need neither, and run on Form.io Open Source with an unlicensed UAG.

The one other allowance is the built-in stub engines, `UAG_ENGINES=stub-decision,stub-agent` (`reason: "stub-engines"`), which answer with placeholders so you can build against the API's shape. It covers work that calls engines; `agent_decide` and `agent_provide`, which call none, still need a license or a hosted project.

Otherwise every Agentic Formflow request is refused with `403`:

```json
{ "requestId": "...", "error": "Agentic Formflow requires a license (LICENSE_KEY) that includes the UAG ...", "code": "license_required", "edition": "open-source" }
```

MCP tools and conversation forms never need a license. See [Deployment](/developers/deployment#licensing) for where licenses apply.

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
