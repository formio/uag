---
title: Workflows
description: Build autonomous agent workflows from Form.io webhooks and /agent/provide, chain tasks without loops, re-decide on the server with agentDecide, and run the same pattern on Community Edition from your own code.
section: Build
order: 30
---

An agentic workflow runs a form's tasks with no person in the loop. A submission triggers a webhook, the webhook asks the UAG to run a task, and the UAG saves the task's answers back to the submission. That save can trigger the next task. The instructions live in the form, so changing what an agent does is a form edit, not a deployment.

This page builds the college application workflow from the [demo site's project](https://github.com/formio/uag/blob/main/demo/module/project.json): an `admissions` task scores each application and decides, and a `finance` task assigns a scholarship award to the applicants admissions puts on the scholarship track. See it running at [/examples/workflow](/examples/workflow).

```sequence
participants: Applicant, Form.io, UAG*, Engines
Applicant -> Form.io: submits the application
Form.io -> UAG: webhook after create: /agent/provide, task admissions
UAG -> Engines: score and decide, following the criteria
Engines --> UAG: answers
UAG -> Form.io: saves scores, decision, status, once
note Form.io: update webhook fires only if status is scholarshipEvaluation and awardLevel is empty
Form.io -> UAG: /agent/provide, task finance
UAG -> Engines: choose the award
UAG -> Form.io: saves awardLevel
note Form.io: the condition is now false: the chain ends
```

## What you need

| Requirement | Why |
|---|---|
| A form with at least one [task](/developers/concepts#tasks) | The criteria, and the fields the task fills. |
| An engine enabled on the UAG | `UAG_ENGINES`, for example `claude` with `CLAUDE_API_KEY`. See [Engines](/developers/engines). |
| A `LICENSE_KEY` that includes the UAG, or a project on Form.io's hosted service | `/agent/provide` is Agentic Formflow. Without either, every call is refused with `403` (`code: "license_required"`). |
| Form.io Enterprise, for webhook-driven runs | The Webhook action must send a custom header (the API key) and transform its payload. Open Source webhooks do neither; see [Community Edition](#community-edition-call-agentprovide-yourself). |

Nothing has to be public. The webhooks call the UAG over the private network, and the UAG calls the model provider outward.

## Step 1: define the task on the form

Tag the form `uag`, add a criteria content component, and flag the fields the task fills. In the sample the whole review panel belongs to `admissions`, and three workflow fields elsewhere on the form are flagged individually:

```json
{ "type": "content", "key": "admissionsCriteria", "input": false,
  "html": "<p>You are an admissions officer. Score the essay from 1 to 10 against the rubric below...</p>",
  "properties": { "uag": "admissions", "uagField": "criteria" } }

{ "type": "panel", "key": "agentAdmissionsReview", "title": "Admissions Review (Agent)",
  "properties": { "uag": "admissions" },
  "components": [ "...the scores and rationale fields..." ] }

{ "type": "select", "key": "status",   "properties": { "uag": "admissions", "uagAgentDecides": "true" } }
{ "type": "select", "key": "decision", "properties": { "uag": "admissions", "uagAgentDecides": "true" } }
```

The criteria is the agent's whole briefing: who it acts as, what each field means, the rubric, the allowed values, and the exact option values for closed-set fields. A vague criteria is the most common reason an agent writes values the form rejects.

### Closed-set fields with only an agent engine

`status` and `decision` are selects, so the UAG treats them as decision fields. On a stored submission it saves a decision field only when a calibrated decision engine is confident. The sample runs Claude alone, which has no calibrated confidence, so those fields carry `uagAgentDecides: "true"`: reconciliation then saves the agent's answer too.

| Engines enabled | Closed-set fields | Set on the fields |
|---|---|---|
| A decision engine (such as `jev`) and an agent engine | Decided with a confidence; saved when confident | Nothing; tune `uagThreshold` |
| An agent engine only | Answered as `suggested`; not saved by default | `uagAgentDecides: "true"` |

With `uagAgentDecides`, every run asks the agent again and may replace the stored value, including one a person changed. Use it only on fields the workflow owns.

## Step 2: add the webhook action

Add a Webhook action to the form that posts to `/agent/provide` after a submission is created:

```json
{
  "title": "Agent: Admissions Evaluation (Webhook)",
  "name": "webhook",
  "handler": ["after"],
  "method": ["create"],
  "priority": 0,
  "settings": {
    "method": "post",
    "url": "http://formio-uag:3200/agent/provide",
    "headers": [{ "header": "x-token", "value": "<the project API key>" }],
    "transform": "payload = {form: 'application', submissionId: payload.submission._id, task: 'admissions'};",
    "block": false
  }
}
```

| Setting | Value | Why |
|---|---|---|
| `handler` | `["after"]` | The submission must be saved, with an id, before the task runs. |
| `method` | `["create"]` | Run once, when the application arrives. Later tasks use `update`. |
| `settings.url` | The UAG's `/agent/provide`, at the address the Form.io server reaches it | A container-to-container address such as `http://formio-uag:3200`, not a browser URL. |
| `settings.headers` | `x-token: <PROJECT_KEY>` | Authenticates the call as administrator. It must match the UAG's `PROJECT_KEY`. |
| `settings.transform` | `payload = { form, submissionId: payload.submission._id, task }` | Replaces Form.io's webhook body (the whole submission and request) with the three fields `/agent/provide` takes. |
| `settings.block` | `false` | Agent runs take seconds to tens of seconds. Non-blocking, the submitter gets their response at once and the task fills in shortly after. |

![The webhook's Additional Headers, carrying the project API key as x-token.](/images/webhook-headers.png)

`task` may be omitted when the form defines a single task. A form with several tasks must name one. Webhooks written for UAG 1.x that send `formName` and `persona` keep working with only their URL changed.

> **Warning:** The API key is stored in the action's settings, so anyone who can read the project's actions can read it. Treat project action access as access to the key.

### What happens on each run

`/agent/provide` loads the submission, runs the task, validates the result, and saves once. In detail:

- Closed-set fields are decided (or answered by the agent, with `uagAgentDecides`) and reconciled with the stored values.
- Open-value fields are generated only while they are empty and visible. A generated value never replaces an existing one.
- If nothing changed, nothing is saved, so a run does not trigger itself.
- If any field could not be answered at all, nothing is saved and the call answers `503`. Because the webhook does not wait, this is visible only in the UAG logs, or by calling the endpoint yourself.

The full contract is in the [Agent API](/developers/agent-api#post-agentprovide).

### Letting the task research

A task that needs to look something up (a previous submission, a record in another form) can list read-only MCP tools on its criteria:

```json
"properties": { "uag": "admissions", "uagField": "criteria", "uagTools": "find_submissions" }
```

The agent engine may then call those tools before it answers the task's value fields. It still cannot write: tools that may write are refused, and the UAG performs the save. The research runs as the webhook's caller, which with a project key is the administrator, so list only the tools a task needs, and only on forms whose submissions you trust. See [Security](/developers/security#prompt-injection).

## Chaining tasks

A second task is triggered by the first task's save, not by the applicant. Add a second webhook that fires on `update`, with a condition on a field the first task sets:

```json
{
  "title": "Agent: Scholarship Evaluation (Webhook)",
  "name": "webhook",
  "handler": ["after"],
  "method": ["update"],
  "priority": 0,
  "condition": {
    "conjunction": "all",
    "conditions": [
      { "component": "status", "operator": "isEqual", "value": "scholarshipEvaluation" },
      { "component": "awardLevel", "operator": "isEmpty" }
    ]
  },
  "settings": {
    "method": "post",
    "url": "http://formio-uag:3200/agent/provide",
    "headers": [{ "header": "x-token", "value": "<the project API key>" }],
    "transform": "payload = {form: 'application', submissionId: payload.submission._id, task: 'finance'};",
    "block": false
  }
}
```

The admissions task sets `status` to `scholarshipEvaluation` only for scholarship-track applicants, so only those submissions wake the finance task. Applicants who were simply accepted or declined never trigger it.

Each task fills only its own fields. `status` belongs to `admissions`, so the finance task cannot change it, and the finance task's criteria cannot hand the workflow back to an earlier stage by accident.

### Avoiding loops

The finance task saves the submission too, which fires the `update` webhook again. Three things stop the chain:

1. **The condition tests the task's own output.** `awardLevel` must be empty, and the finance task fills it, so after its save the condition is false.
2. **`/agent/provide` is idempotent.** It saves nothing when nothing changed, and fills value fields only while they are empty, so running a task on its own output is a no-op that triggers nothing.
3. **Confidence changes are not saves.** A model's confidence varies slightly between calls; a changed `uagConfidenceField` alone never causes a save.

Rely on the first, not only the second: without a condition, every update still calls the UAG and the engines. And check condition operators carefully. Form.io treats a condition with an unknown operator, or one naming a field that does not exist, as always true, which turns a guard into an unconditional trigger.

> **Tip:** An agent that "runs continuously and burns credits" is almost always a chained webhook whose condition stays true, or a webhook pointed at something other than `/agent/provide` that saves on every call.

## Re-deciding on the server

Workflows that start from a person's own submission have a second concern: values the browser sent. If an [Agentic Formflow](/developers/agent-api) page decided a triage field in the browser, the user could change it before submitting. When that field drives sensitive routing, decide it again on the server.

The UAG's built-in `agentDecide` action does this before the save:

```json
{
  "title": "Agent Decide",
  "name": "agentDecide",
  "handler": ["before"],
  "method": ["create", "update"],
  "priority": 20,
  "settings": { "task": "triage" }
}
```

| Property | Value |
|---|---|
| `handler`, `method` | Its defaults, `before` with `create` and `update`. |
| `priority` | `20`, so it runs ahead of the Save Submission action (`10`). |
| `settings.task` | The task to re-decide. Default: the form's first task. The pre-2.0 `persona` setting is still read. |

It re-decides the task's decision fields, including fields on hidden pages, with the caller's identity, then reconciles them as `/agent/provide` does: confident answers are written, `uagAuthoritative` fields the server cannot confirm are cleared for a person to decide, and other values are kept. When some decision fields cannot be decided at all, the save is refused rather than clearing fields as if the server had judged them:

| Status | Cause |
|---|---|
| `503` | Every engine that could answer failed, timed out, or none is enabled. |
| `429` | Every engine was over its rate limit (`Retry-After: 60`). |
| `403` | Agentic Formflow is not licensed (`code: "license_required"`). |
| `400` | The task cannot be planned (an unknown task, for example). |

The body is `{ name, message }`, with `code` and `edition` for the license case.

`agentDecide` runs only for submissions saved **through the UAG** (by an MCP tool or a UAG-hosted route). A submission saved directly to Form.io never passes through it. For those, add an after-save webhook to `/agent/provide` with the same task: it reconciles the stored submission by the same rules, saves only what changed, and so does not trigger itself. Have downstream steps trigger on that update, not on create, so they see the re-decided values.

## Community Edition: call `/agent/provide` yourself

Open Source Form.io webhooks cannot send a custom header or run a transform, so they cannot call `/agent/provide` directly. The UAG side is identical; only the trigger moves into your code. Two ways to do it:

### From the code that creates the submission

If your application creates submissions, call the task right after:

```js
// submit-and-review.mjs (Node 22+)
const FORMIO = 'http://formio:3001';      // the Open Source server
const UAG = 'http://formio-uag:3200';
const ADMIN_KEY = process.env.ADMIN_KEY;

const created = await fetch(`${FORMIO}/application/submission`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
  body: JSON.stringify({ data: { firstName: 'Ada', lastName: 'Byron', essay: '...' } }),
}).then((r) => r.json());

const response = await fetch(`${UAG}/agent/provide`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
  body: JSON.stringify({ form: 'application', task: 'admissions', submissionId: created._id }),
});
const result = await response.json();
if (!response.ok) throw new Error(`${response.status} ${result.error} (request ${result.requestId})`);
console.log('written:', result.written);
```

Chaining is then ordinary code: inspect `result.written` (or reload the submission) and call the next task when its condition holds.

### From a webhook relay

To keep Form.io's own webhook triggers and conditions, point each Open Source webhook at a small relay on the private network that adds the key and builds the body. The UAG's end-to-end tests run the sample workflow on Open Source exactly this way.

```js
// relay.mjs: Form.io (OSS) webhook -> /agent/provide. Keep it on a private network.
import http from 'node:http';

const UAG = process.env.UAG_URL || 'http://formio-uag:3200';
const ADMIN_KEY = process.env.ADMIN_KEY;
// The relay path names the task: a webhook URL of http://relay:3300/application/admissions
http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    res.writeHead(200).end(); // do not make Form.io wait
    const [form, task] = req.url.slice(1).split('/');
    try {
      const { submission } = JSON.parse(body);
      const response = await fetch(`${UAG}/agent/provide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
        body: JSON.stringify({ form, task, submissionId: submission._id }),
      });
      console.log(form, task, submission._id, response.status);
    } catch (error) {
      console.error('relay failed', error);
    }
  });
}).listen(3300);
```

Anyone who can reach the relay can make the UAG run tasks on any submission id they know, so do not expose it outside the network.

## Watching a run

An agentic run is otherwise invisible: the webhook does not wait, and the agent writes nothing until it is done. Three ways to see what happened:

- **Call `/agent/provide` by hand** on the submission. On a submission the task already filled it saves nothing, and its response names the engine, model and reason for every field.
- **Read the provenance** in the submission's `metadata.uag`: which engine decided or generated each field, with what confidence, and when.
- **Put the flow viewer in front of the UAG.** The [flow viewer sample](https://github.com/formio/uag/tree/main/demo/flow) is a small logging proxy that shows every leg live: the webhook, what the UAG asks each engine on an engine server, and every research tool call.

From inside the sample's Compose network:

```bash
docker compose exec formio-uag node -e "fetch('http://localhost:3200/agent/provide', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': process.env.PROJECT_KEY }, body: JSON.stringify({ form: 'application', task: 'admissions', submissionId: process.argv[1] }) }).then(async (r) => console.log(r.status, await r.text()))" <submission id>
```

## Taking a workflow to production

- **Hide the agent sections.** Set `hidden: true` on the criteria and agent panels so the rubric is not rendered. The agent still reads them. Hiding only affects rendering: anyone who can read the form definition can read the criteria.
- **Fix the permissions.** A project reachable only with the API key is right for a demo and wrong for real users. Add a user resource with a login form, and scope submission access to owners.
- **Change every `CHANGEME`** and keep keys in a secret store, not in Compose files.
- **Raise `PROJECT_TTL`.** Samples use 10 seconds so criteria edits show quickly; every expiry re-reads the project export.
- **Pin versions.** Use `formio/uag` 2.0.0 or newer for `/agent/provide` as described here, and pin a tested set of images and engine models (see [Deployment](/developers/deployment#image-and-version-pinning)).
- **Choose where the engines run.** To keep model keys and model traffic out of the UAG, run the engines on an [engine server](/developers/engine-server).
- **Measure before trusting thresholds.** For decision engines, run [`uag-eval`](/developers/evaluation) on labeled examples before relying on the defaults.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Nothing happens after submitting | The webhook did not fire, or its call was refused. Check that `handler` is `after` and `method` includes `create`, and that the `x-token` header matches the UAG's `PROJECT_KEY`. Check the Form.io server's logs for the webhook. |
| The webhook fires but nothing is written | Call `/agent/provide` by hand and read `fields`: each `reason` says why, for example `already has a value` or an engine failure. A `403` with `license_required` means the license does not include the UAG (see [Licensing](/developers/deployment#licensing)). |
| `/agent/provide` answers `503` | No engine can serve it (check `UAG_ENGINES`), or every engine that could answer some fields failed. The response names each failure; with a `remote` engine, also check the engine server's logs. |
| Closed-set fields are never saved | Only an agent engine is enabled. Add `uagAgentDecides: "true"` to those fields, or enable a decision engine. |
| The submitter waits a long time | The webhook has `block: true`. Set it to `false`. |
| An agent runs continuously | A chained webhook's condition stays true, or a condition uses an unknown operator or field name (treated as always true). |
| Some fields are filled, others are not | The missing ones lack the task's `uag` value (or inherit it from a container), or already had a value. |
| A form or action change in the module template has no effect | The template only installs what the project lacks. Update the existing form or action in the portal, through a stage deployment, or by posting the template to `/import`. |

More in [Troubleshooting](/developers/troubleshooting).
