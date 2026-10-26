---
title: Concepts
description: The uag tag, tasks, criteria, agent fields, inputs, context, decision and value fields, and the provenance the UAG records, with a complete example form.
section: Concepts
order: 10
---

Everything the UAG does is driven by the forms in your project. This page explains the vocabulary: which forms an agent can see, how a form defines work for an agent, how the UAG decides what each model is asked, and what it records about the answers. [Form properties](/developers/form-properties) is the companion reference for every property mentioned here.

## The `uag` tag

The UAG registers only forms and resources tagged `uag`. In the form builder the tag is under **Form Settings → Tags**; in Form JSON:

```json
"tags": ["uag"]
```

An untagged form is invisible to every agent and every tool, including `get_forms` and every `/agent/*` endpoint (which answer `404` "does not exist or is not tagged"). Nothing logs an error. When an agent insists a form does not exist, check the tag first, then wait for the project cache (`PROJECT_TTL`) or restart the UAG.

A tagged form is all a conversation form needs. The agent reads its fields, labels, descriptions, options and validation through the MCP tools. The form's `properties.description`, if set, is the description `get_forms` shows; otherwise it shows "A form to submit new <title> records."

> **Tip:** Field descriptions are agent context as much as help text. A precise description ("The 8-digit account number printed on the invoice") changes how an agent asks for and checks a value.

## Tasks

A **task** is a unit of work the form defines for an agent: what to do, what to read, and which fields to fill. Workflows (`/agent/provide`) and Agentic Formflow (`/agent/extract`, `/decide`, `/generate`) run tasks. Before UAG 2.0 tasks were called personas; the older name is still accepted (see [Earlier names](#earlier-names)).

A task is made of components that carry the same value in their `uag` custom property. That value is the task's name:

| Role | How it is flagged | Required |
|---|---|---|
| **Criteria** | A content component with `uag: "<task>"` and `uagField: "criteria"` | Required by the `agent_provide` MCP tool. The Agent API runs without one, but engines then get no instructions, so always add it. |
| **Agent fields** | Any input component, or a container of them, with `uag: "<task>"` | Yes |
| **Input** | A field or container with `uag: "<task>"` and `uagField: "input"` | No |

Custom properties are set in the builder under a component's **API → Custom Properties**, and in Form JSON under `properties`.

![The custom properties that make a content component a task's criteria.](/images/criteria-properties.png)

### Criteria

The criteria is a content component whose HTML is the task's instructions. The UAG converts it to Markdown and gives it to every engine, and to MCP agents through `agent_provide`.

Write it as you would brief a new employee: what the submission is, what each field the task fills means, how to judge it, which values are allowed, and in which units and formats. If the task acts in a role (an admissions officer, a claims adjuster), say so here; the criteria is the only place a model learns who it is acting as. Name field keys verbatim when it helps.

![An example criteria for scoring a college application essay.](/images/criteria-example.png)

The criteria component also carries the task's settings. Any custom property on it other than `uag` and `uagField` becomes a task setting; the UAG reads `uagContext`, `uagTools` and `uagEngine` from there.

In a production form, hide the criteria and the agent fields from the rendered form (`hidden: true`) if users should not see the rubric. The agent still reads it. Hiding only affects rendering: anyone who can read the form definition can read the criteria.

### Agent fields

Every input component with the task's `uag` value is a field the task fills. Fields do not have to sit next to the criteria: a `status` field in one panel can belong to one task while the field beside it belongs to another.

![Agent fields flagged with the task's name.](/images/agent-field-property.png)

A task only ever fills its own fields. Values an engine returns for any other path are discarded, so a model cannot be talked into writing a field the task does not own.

### Nested components

Flag a container (a Panel, Fieldset, Well or Container) with `uag: "<task>"` and every input inside it belongs to the task. This is the usual way to give a task a whole "For office use only" section.

Fields inside repeating rows (a Data Grid or Edit Grid) are not answered. They are listed in the response's `excluded` with the reason `inside repeating rows`.

### The input

By default a task reads the whole submission, except the fields it is filling. Flag a field with `uagField: "input"` to make it the task's source instead: a "Describe what happened" text area, for example.

```json
{ "type": "textarea", "key": "lossDescription", "label": "What happened?", "input": true,
  "properties": { "uag": "triage", "uagField": "input" } }
```

An input can also be a container, in which case every value inside it is input. A task can have several inputs.

The input matters most for `/agent/extract`, which fills a task's fields from free text. Extract needs either a task with an input (and the input's value in `data`) or a `text` value in the request, which replaces the input for that call.

### Context

Engines are deliberately given very little: unrelated detail lowers decision accuracy. For each task they receive exactly:

| Key | Content |
|---|---|
| `instructions` | The criteria, as Markdown. |
| `input` | The input field values keyed by label (or the request's `text` under the label `Input`). Without an input, every filled value in the submission except the fields being answered. |
| `context` | The values at the paths listed in the criteria's `uagContext`, keyed by label. |
| `today` | Today's date, for example `Friday, October 23, 2026 (2026-10-23)`. |

To give a task one or two extra values without making them input, list their data paths in `uagContext` on the criteria component:

```json
"properties": { "uag": "triage", "uagField": "criteria", "uagContext": "policyNumber, customer.tier" }
```

Agent engines also receive each target field's label, type, description, rule, format and options, and a JSON schema for the answer. Decision engines receive compiled questions (see [How decisions are asked](#how-decisions-are-asked)).

When a task lists research tools in `uagTools`, an agent engine may also call those read-only tools before it answers. See [Security](/developers/security#research-identity).

## Multiple tasks

A form can define several tasks, each with its own criteria and fields. This models a process with stages: in a college application, an `admissions` task decides whether to admit, and a `finance` task, with entirely different criteria, assesses aid for the admitted applicants.

```json
{ "key": "admissionsCriteria", "type": "content", "properties": { "uag": "admissions", "uagField": "criteria" } }
{ "key": "financeCriteria",    "type": "content", "properties": { "uag": "finance",    "uagField": "criteria" } }
{ "key": "status",      "type": "select", "properties": { "uag": "admissions" } }
{ "key": "awardLevel",  "type": "select", "properties": { "uag": "finance" } }
```

When a request names no task:

| Operation | Tasks that run |
|---|---|
| `/agent/decide`, `/agent/generate` | Every task, each with its own criteria |
| `/agent/extract` | Every task with an input, or every task when `text` is given |
| `/agent/provide` | The form's only task. A form with several tasks must name one (`400` otherwise): a saving operation never guesses which stage to run. |
| `agent_provide`, `agent_decide` (MCP) | The form's first task |
| `agentDecide` action | The form's first task |

Chaining tasks, so that the first task's save starts the second, is covered in [Workflows](/developers/workflows#chaining-tasks).

## Decision fields and value fields

The UAG sorts every target field into one of two kinds, and routes each kind to a different type of engine.

| Kind | Components | Answered by | Result status |
|---|---|---|---|
| **Decision** | Radio and select with static values; checkbox; select boxes; survey; single-value resource selects whose whole resource fits the decision engine's option limit (255 for Jev) | A decision engine, with a calibrated confidence. If none answers, an agent engine as a fallback, uncalibrated. | `confident`, `uncertain` or `missing` (`suggested` from an agent engine) |
| **Value** | Everything else: text, dates, numbers, currency, emails, multi-value or large resource selects, selects fed by a URL | An agent engine | `suggested` or `missing` |

A radio or single select whose options exceed the decision engine's limit becomes a value field. `uagEngine` on a component, or on the criteria for the whole task, overrides the routing.

### Statuses

| Status | Meaning |
|---|---|
| `confident` | A decision engine answered at or above the field's threshold, and every consistency check agreed. Never given to a value that fails the form's validation. |
| `uncertain` | A decision engine answered, but below the threshold, or the answer changed when the options were reversed, or it was unclear whether the input addresses the field at all. Up to three `alternatives` are included. |
| `suggested` | An agent engine wrote the value. Agent engines are not calibrated, so their values are always suggestions for a person or a rule to confirm. |
| `missing` | No answer: the input does not mention the field, the engine returned nothing usable, or no engine could answer. `reason` says which. |

### How decisions are asked

Decision engines are asked closed questions, compiled from the component, with checks against the known failure modes of decision models:

- **Choice** (radio, select, a survey row): one question over the option labels, asked again with the options in reverse order. If the answer changes, the field is `uncertain`. Disable the second question with `uagOrderCheck: "false"`.
- **Score** (an ordered radio or select with `uagScale: "true"` and a description for every option in `uagOptionDescriptions`, 2 to 10 levels): one question over the described levels.
- **Mention check**: every choice and score is paired with a yes/no question, "does the input address this at all?". Below the uncertain band the field is left empty ("not mentioned"); inside the band it is `uncertain`. This is how "nobody was hurt" is told apart from not mentioning injuries.
- **Yes/no** (checkbox, each select-box option): two literal questions, "does the input affirm this?" and "does it deny it?". True needs a clear affirmation and no denial, false the reverse, neither is "not mentioned", anything else is `uncertain`.
- **Resource match** (resource select): a choice over every record of the resource, labeled with the component's template. When the input clearly names a record that is not on file, the field is `missing` with `noMatch: true`, and, when an agent engine is enabled, `newRecordName` carries the name the input used.

Thresholds are set per field with `uagThreshold` (choice and score, default `0.5`) and `uagUncertainBand` (yes/no and mention checks, default `0.2-0.8`). Measure them on your own data before relying on the defaults; see [Evaluation](/developers/evaluation).

### What gets excluded

Every response lists target fields that were not answered, with a reason:

| Reason | Why |
|---|---|
| `already has a value` | The field is filled, and `overwrite` is not set (stateless operations), or it is a value field on a stored submission (provide). |
| `hidden by the form's conditionals` | The field is conditionally hidden for this data. Server-side reconciliation still re-decides hidden decision fields. |
| `inside repeating rows` | The field is inside a Data Grid or Edit Grid. |
| `not requested` | Decide asked for decision fields only, or generate for value fields only. |
| `holds the confidence of another field` | The field is another field's `uagConfidenceField`; it is written with that decision, never answered on its own. |

## Reconciliation and provenance

Stateless operations (extract, decide, generate) return values and save nothing. Saving operations (`/agent/provide` and the `agentDecide` action) reconcile the answers with what the submission already holds:

- **Decision fields** take a `confident` answer. Otherwise they keep their stored value, which a person may have confirmed, unless the field is marked `uagAuthoritative: "true"`, in which case an answer that is not confident clears it so a person decides. A field marked `uagAgentDecides: "true"` also takes an agent engine's `suggested` answer.
- **Value fields** take a generated value only while they are empty and visible. A generated value never replaces one already there, so running a task again on its own output changes nothing.

Every reconciled value is recorded in the submission's metadata, next to the data:

```json
"metadata": {
  "uag": {
    "decisions": {
      "category": {
        "engine": "jev",
        "model": "jev-1.13.0",
        "probabilities": {
          "choice:category": { "Billing": 0.95, "Outage": 0.025, "Other": 0.025 },
          "choice-reversed:category": { "Billing": 0.95, "Other": 0.025, "Outage": 0.025 },
          "mention:category": { "yes": 0.9 }
        },
        "confidence": 0.925,
        "at": "2026-10-23T10:24:27.073Z",
        "status": "confident",
        "source": "server",
        "serverValue": "billing"
      }
    },
    "generated": {
      "summary": { "engine": "claude", "model": "claude-opus-5-5", "status": "suggested", "at": "2026-10-23T10:24:27.073Z" }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `decisions[path].source` | `server`: the server's answer was written. `client`: the stored or submitted value was kept. `cleared`: an authoritative field was emptied. `none`: nothing was kept and nothing written. |
| `decisions[path].serverValue` | What the server decided, even when it was not written. |
| `decisions[path].probabilities` | The engine's probabilities for each compiled question, at most the top 10 options per question. |
| `generated[path]` | The engine and model that wrote a value field, and when. |

With Form.io Enterprise, submission revisions add who changed what afterwards, so an audit can follow a value from the model to the person who confirmed or corrected it.

## A complete example

This form has one task, `triage`, with an input, a criteria that adds one context value, two decision fields (one of which writes its confidence to a companion field) and one value field. It is the form the [Agent API](/developers/agent-api) examples use.

```json
{
  "title": "Support Request",
  "name": "supportRequest",
  "path": "supportrequest",
  "type": "form",
  "tags": ["uag"],
  "components": [
    { "type": "textarea", "key": "description", "label": "What happened?", "input": true,
      "properties": { "uag": "triage", "uagField": "input" } },
    { "type": "textfield", "key": "accountNumber", "label": "Account number", "input": true },
    { "type": "content", "key": "triageCriteria", "input": false,
      "html": "<p>You triage support requests. Choose the category and whether the request is urgent from the description. Write a one-sentence summary.</p>",
      "properties": { "uag": "triage", "uagField": "criteria", "uagContext": "accountNumber" } },
    { "type": "radio", "key": "category", "label": "Category", "input": true,
      "values": [
        { "label": "Billing", "value": "billing" },
        { "label": "Outage", "value": "outage" },
        { "label": "Other", "value": "other" }
      ],
      "properties": { "uag": "triage", "uagThreshold": "0.6", "uagConfidenceField": "categoryConfidence" } },
    { "type": "number", "key": "categoryConfidence", "label": "Category confidence", "input": true,
      "properties": { "uag": "triage" } },
    { "type": "checkbox", "key": "urgent", "label": "Urgent", "input": true,
      "properties": { "uag": "triage" } },
    { "type": "textfield", "key": "summary", "label": "Summary", "input": true,
      "properties": { "uag": "triage" } },
    { "type": "button", "key": "submit", "label": "Submit", "input": true, "action": "submit" }
  ]
}
```

What the UAG makes of it:

| Path | Kind | Notes |
|---|---|---|
| `description` | Input | Sent to engines under its label, "What happened?". |
| `accountNumber` | Context | Sent under `context` because the criteria lists it. Not a target. |
| `category` | Decision (choice) | Confident at 0.6 or above. Its confidence is written to `categoryConfidence`. |
| `categoryConfidence` | Excluded | Holds another field's confidence. |
| `urgent` | Decision (yes/no) | Affirm and deny questions, judged against the uncertain band. |
| `summary` | Value | Written by an agent engine as `suggested`. |

## Earlier names

Tasks were called personas before UAG 2.0. The old names keep working until a future major release, and the UAG logs one deprecation notice per kind of use:

| Where | Current | Still accepted |
|---|---|---|
| Agent API bodies | `task` | `persona` |
| `/agent/provide` | `form` | `formName` |
| `agent_provide`, `agent_decide` | `task` | `persona` |
| MCP tool | `agent_provide` | `agent_provide_data` |
| `agentDecide` action setting | `task` | `persona` |

Sending both names with different values is refused with `400`.
