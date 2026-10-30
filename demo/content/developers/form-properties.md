---
title: Form properties
description: Every form tag and custom component property the UAG reads, where each one goes, its default, and an example.
section: Concepts
order: 20
---

The UAG is configured almost entirely in Form JSON. This page lists every form-level setting and custom component property it reads. [Concepts](/developers/concepts) explains how they fit together.

Custom properties are key/value pairs set in the form builder under a component's **API → Custom Properties**, and stored in Form JSON under the component's `properties`. The builder stores every value as a string, so booleans are written `"true"` and `"false"`, and numbers as their text.

> **Tip:** With the [Agentic Coding Plugin](/developers/agentic-coding), describe the behavior ("decide the claim type, and leave it for a person when the engine is unsure") and your coding agent writes these properties, showing the form change before it saves it.

```json
{ "type": "radio", "key": "claimType", "label": "Kind of claim",
  "properties": { "uag": "triage", "uagThreshold": "0.6", "uagConfidenceField": "claimTypeConfidence" } }
```

## Summary

| Property | Goes on | Default | Purpose |
|---|---|---|---|
| [`tags: ["uag"]`](#the-uag-tag) | The form | none | Registers the form with the UAG. |
| [`properties.description`](#form-description) | The form | generated | The description `get_forms` shows. |
| [`properties.uagAnonymous`](#uaganonymous) | The form | `false` | Lets visitors who are not signed in use the form's agent operations. |
| [`properties.uagChat`](#uagchat) | The form | on | `"false"` turns the form's [chat](/developers/chat) off. |
| [`properties.uagChatInstructions`](#uagchatinstructions) | The form | none | Instructions of your own for the form's chat. |
| [`uag`](#uag) | Any component | none | Names the task the component belongs to. |
| [`uagField`](#uagfield) | A content component, or an input field or container | none | Makes the component the task's `criteria` or its `input`. |
| [`uagContext`](#uagcontext) | The criteria component | none | Extra data paths sent to engines. |
| [`uagTools`](#uagtools) | The criteria component | none | Read-only MCP tools an agent engine may research with. |
| [`uagEngine`](#uagengine) | A target field, or the criteria component | `config.routing` | Which engines answer. |
| [`uagThreshold`](#uagthreshold) | A choice or score decision field | `0.5` | Confidence needed for `confident`. |
| [`uagUncertainBand`](#uaguncertainband) | A decision field | `0.2-0.8` | The range treated as unsure, for yes/no answers and mention checks. |
| [`uagOptionDescriptions`](#uagoptiondescriptions) | A radio, select or survey | none | A description of what each option means. |
| [`uagScale`](#uagscale) | A radio or select | `false` | Ask an ordered field as a scale. |
| [`uagOrderCheck`](#uagordercheck) | A radio, select, survey or resource select | `true` | Ask again with the options reversed. |
| [`uagConfidenceField`](#uagconfidencefield) | A decision field | none | A field that receives the decision's confidence. |
| [`uagAuthoritative`](#uagauthoritative) | A decision or value field a task fills | `false` | Only the task sets the field: clients' values are removed, and server-side reconciliation always wins. |
| [`uagAgentDecides`](#uagagentdecides) | A decision field | `false` | Server-side reconciliation also saves an agent engine's answer. |

## Form-level settings

### The `uag` tag

| | |
|---|---|
| **Goes on** | The form or resource, in `tags` |
| **Default** | Not tagged: the form is invisible to agents |

Only tagged forms are registered. Every MCP tool, and every agent operation, treats an untagged form as one that does not exist.

```json
{ "title": "Customer", "name": "customer", "type": "resource", "tags": ["uag"] }
```

The tag is read whenever the form loads or a project refresh brings in a new version, so adding or removing it takes effect within `PROJECT_TTL` seconds.

### Form description

| | |
|---|---|
| **Goes on** | The form, in `properties.description` |
| **Default** | `A form to submit new <title> records.` |

What `get_forms` tells an agent the form is for. Agents pick a form by matching the user's intent against this list, so a specific description helps them choose.

```json
"properties": { "description": "Report a fault with a home internet or TV service." }
```

### `uagAnonymous`

| | |
|---|---|
| **Goes on** | The form, in `properties.uagAnonymous` (the form's custom properties) |
| **Default** | Not set: only callers with a credential may use the form's agent operations |

`"true"` lets a visitor who is not signed in call the form's [agent operations](/developers/agent-api), such as Agent Input or the [chat](/developers/chat) on a public intake form, without a backend relay. It applies only when the form also lets the Anonymous role create submissions; otherwise anonymous requests answer `403`.

Every such request may call a model, so anonymous use is rate-limited, per client address and in total (`AGENT_ANONYMOUS_RATE_LIMIT` and `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT`, see [Deployment](/developers/deployment#connection-and-identity)). Over a limit the UAG answers `429` with `Retry-After`, before any engine is called.

```json
"properties": { "uagAnonymous": "true" }
```

### `uagChat`

| | |
|---|---|
| **Goes on** | The form, in `properties.uagChat` (the form's custom properties) |
| **Default** | Not set: any form tagged `uag` can be used for chat |

`"false"` turns the form's [chat](/developers/chat) (`{form}/agent/chat`) off: its turns answer `403`, before any engine is called. Its other agent operations, its MCP tools and its submissions are unaffected.

```json
"properties": { "uagChat": "false" }
```

### `uagChatInstructions`

| | |
|---|---|
| **Goes on** | The form, in `properties.uagChatInstructions` (the form's custom properties) |
| **Default** | None: the chat follows the UAG's own instructions, the form's title and its description |

Text added to the instructions every chat turn gives the engine, under "Instructions for this form". Use it for what the form's labels and descriptions cannot say: the order to ask in, the tone, what to say about a field. It cannot widen what the chat may do: the fields it may set and the values the form accepts are fixed by the form.

```json
"properties": { "uagChatInstructions": "Always ask for the account number first. Keep replies to one sentence." }
```

## Task structure

### `uag`

| | |
|---|---|
| **Goes on** | Any component: the criteria, an input, an agent field, or a container of agent fields |
| **Default** | None: the component is not part of any task |
| **Value** | The task's name, such as `triage` |

Every component with the same `uag` value belongs to the same task. On a container (Panel, Fieldset, Well, Container), every input inside it belongs to the task. A form may define any number of tasks.

```json
{ "type": "panel", "key": "officeUse", "title": "For office use only", "properties": { "uag": "admissions" },
  "components": [ { "type": "number", "key": "essayScore", "label": "Essay score", "input": true } ] }
```

A component without `uagField` is an agent field: the task fills it. Fields inside a Data Grid or Edit Grid are not filled (`excluded`: `inside repeating rows`).

### `uagField`

| | |
|---|---|
| **Goes on** | A component that also carries `uag` |
| **Default** | None: the component is an agent field |
| **Values** | `criteria` or `input` |

- `criteria` on a **content** component makes its HTML, converted to Markdown, the task's instructions. Its other custom properties become the task's settings (`uagContext`, `uagTools`, `uagEngine`).
- `input` on a field or container makes its value the task's source text. Without an input, a task reads the whole submission except the fields it is filling. A form's `agent/extract` needs an input, or a `text` value in the request.

```json
{ "type": "content", "key": "criteria", "html": "<p>Add A and B and write the result to Sum.</p>",
  "properties": { "uag": "agent", "uagField": "criteria" } }
{ "type": "textarea", "key": "lossDescription", "label": "What happened?",
  "properties": { "uag": "triage", "uagField": "input" } }
```

The `agent_provide` MCP tool refuses a task without a criteria component. The Agent API runs one, but its engines get no instructions.

## Task settings

These go on the task's criteria component.

### `uagContext`

| | |
|---|---|
| **Goes on** | The criteria component |
| **Default** | None: engines get only the criteria, the input and today's date |
| **Value** | Comma-separated data paths |

Values at these paths (or inside them, for a container) are sent to engines under `context`, keyed by label. Paths inside the task's input are not repeated. Use it for the one or two facts a decision depends on that are not in the input, such as a policy number or a customer tier.

```json
"properties": { "uag": "triage", "uagField": "criteria", "uagContext": "policyNumber" }
```

### `uagTools`

| | |
|---|---|
| **Goes on** | The criteria component |
| **Default** | None: no research |
| **Value** | Comma-separated MCP tool names, such as `find_submissions, get_forms` |

Read-only tools an agent engine may call to research the task's **value** fields before it answers, in a form's `agent/generate` and in an "Agent: Run task" action that answers the whole task. Extract, decide and decisions-only runs never research. The tools run with the identity of the caller (for Run task, the user who submitted, never the action's agent role), so Form.io permissions apply to what they return; a server that calls or submits with the project key researches as administrator.

A tool that may write, or that does not exist, is refused when the task is planned for research: generate answers `400`, naming the tool, and a Run task run fails with the same error. An agent engine that does not support tool use is passed over for such a task. Remote engines receive a scoped token limited to these tools; see [Security](/developers/security#scoped-tokens-for-remote-engines).

```json
"properties": { "uag": "admissions", "uagField": "criteria", "uagTools": "find_submissions" }
```

The tools that qualify are those annotated read-only: `get_forms`, `get_form_fields`, `get_field_info`, `collect_field_data`, `confirm_form_submission`, `find_submissions`, `agent_provide`, `agent_decide` and `fetch_external_data`, plus any custom tool whose annotations set `readOnlyHint: true`.

### `uagEngine`

| | |
|---|---|
| **Goes on** | A target field, or the criteria component for the whole task. A field's value wins over the task's. |
| **Default** | `config.routing`: `decision`, then `agent`, for decision fields; `agent` for value fields |
| **Value** | An engine instance name, `decision` (every enabled decision engine), `agent` (every enabled agent engine; `llm` also works), or a comma-separated list of these, tried in order |

Overrides which engines answer. Names of engines that are not enabled are skipped, so one form works on deployments with different engines turned on. A value field is only ever answered by agent engines, so a list that names only decision engines leaves it unanswered.

```json
"properties": { "uag": "triage", "uagEngine": "deep, agent" }
```

Engine instances are named in `UAG_ENGINES`; see [Engines](/developers/engines).

## Decision field settings

These apply to decision fields: radio and select with static values, checkbox, select boxes, survey, and resource selects small enough to decide. See [Decision fields and value fields](/developers/concepts#decision-fields-and-value-fields).

### `uagThreshold`

| | |
|---|---|
| **Goes on** | A radio, select, survey or resource select |
| **Default** | `agentApi.threshold`, which defaults to `0.5` |
| **Value** | A number between 0 and 1 |

The confidence a choice or score answer needs to be `confident`. Below it the field is `uncertain`, with alternatives. It is compared with the engine's normalized confidence, not the raw top probability. Yes/no fields use [`uagUncertainBand`](#uaguncertainband) instead.

```json
"properties": { "uag": "triage", "uagThreshold": "0.6" }
```

### `uagUncertainBand`

| | |
|---|---|
| **Goes on** | Any decision field |
| **Default** | `agentApi.uncertainBand`, which defaults to `0.2-0.8` |
| **Value** | `low-high`, such as `0.1-0.5`. An invalid value, or one with `low` above `high`, is ignored. |

The probability range treated as unsure. It applies in two places:

- **Yes/no answers** (checkbox, each select-box option): true needs the affirmation above `high` and the denial below `low`; false the reverse; both below `low` is "not mentioned"; anything else is `uncertain`.
- **Mention checks** (every choice and score): below `low` the field is left empty as not mentioned; up to `high` it is `uncertain`.

A wide, low band such as `0.1-0.5` accepts weak evidence, which suits a flag that should err toward being raised, such as a fraud signal.

```json
"properties": { "uag": "triage", "uagUncertainBand": "0.1-0.5", "uagAuthoritative": "true" }
```

### `uagOptionDescriptions`

| | |
|---|---|
| **Goes on** | A radio, select or survey |
| **Default** | None |
| **Value** | A JSON object mapping each option value to a description |

Describes the situation each option covers. The descriptions are added to the option labels in choice questions, and are required to ask an ordered field as a scale. Entries that are not non-empty strings are ignored, and an invalid JSON value is treated as absent.

```json
"properties": {
  "uag": "triage",
  "uagScale": "true",
  "uagOptionDescriptions": "{\"minor\": \"Cosmetic damage only; the item still works.\", \"moderate\": \"Damaged and needs repair, but usable.\", \"severe\": \"Unusable or unsafe until repaired.\"}"
}
```

### `uagScale`

| | |
|---|---|
| **Goes on** | A radio or select with static values |
| **Default** | Not set: asked as a choice |
| **Value** | `"true"` |

Asks the field as a score over ordered levels instead of a choice. It takes effect only when the field has 2 to 10 options and every option has a description in `uagOptionDescriptions`; otherwise the field is asked as a choice. Bare degree words ("Minor", "Severe") are more reliable as a choice than as an undescribed scale. A survey whose answer columns are all described is asked as a scale automatically.

### `uagOrderCheck`

| | |
|---|---|
| **Goes on** | A radio, select, survey or resource select |
| **Default** | On |
| **Value** | `"false"` to turn it off |

By default every choice question is asked a second time with its options in reverse order, because decision models favor the first option they see. If the two answers differ, the field is `uncertain`. Turn it off to drop that second question (two questions instead of three, with the mention check) for a field whose options are unambiguous.

### `uagConfidenceField`

| | |
|---|---|
| **Goes on** | A decision field |
| **Default** | None |
| **Value** | The data path of another field, usually a hidden number |

Writes the decision's confidence to that field, so ordinary Form.io conditionals and action conditions can act on it.

- In extract, decide and generate results, an `uncertain` decision's confidence is written just below the field's threshold (never above the real confidence), so a "less than the threshold" condition matches every uncertain decision.
- In server-side reconciliation ("Agent: Run task"), the confidence is written with a confident decision, and cleared with an authoritative field the server could not confirm. A change in confidence alone never causes a save.

When the companion is itself flagged with the task, it is excluded from answering (`holds the confidence of another field`).

```json
{ "type": "radio", "key": "claimType", "properties": { "uag": "triage", "uagThreshold": "0.6", "uagConfidenceField": "claimTypeConfidence" } }
{ "type": "hidden", "key": "claimTypeConfidence", "properties": { "uag": "triage" } }
```

A wizard page conditioned on `claimTypeConfidence` below `0.6` then appears only when triage is unsure.

### `uagAuthoritative`

| | |
|---|---|
| **Goes on** | A field a task fills: a decision field or a value field |
| **Default** | Off: a client may set the field, and a stored value is kept when the server is not confident |
| **Value** | `"true"` |

Marks a field the task owns: only the task sets it. It has two effects, both on requests sent to the UAG.

**Clients cannot set it.** When the form has an "Agent: Run task" action for the field's task, the UAG removes the value a client sends for the field, and for its `uagConfidenceField`, on every create and update, before any action runs. This holds for every Run task action on the form, whatever its method, conditions or timing, so a client cannot set the field through a method no task runs on either. On a create the field starts empty; on an update it keeps its stored value. The UAG's own saves of a task's results are not affected. The same applies to value fields: a value field the task generated keeps that value when a person updates the submission, and is never generated again, since a task writes only empty value fields.

**The server's decision wins.** In server-side reconciliation, for decision fields, a confident result is written; any other answered result (uncertain or missing) **clears** the field, and its confidence field, so a person decides. If no engine can answer at all (failure, timeout, rate limit, none enabled), nothing is cleared by the outage: a decisions-only run before the save refuses the save with `503` or `429`, and any other run leaves the field as it was.

Fields without it stay editable, so a person's correction to a suggested value is kept.

Use it for fields that drive sensitive routing or outcomes and must not be set by a browser, such as a fraud flag or an admissions decision. It protects only requests sent to the UAG; to keep users off the field on Form.io too, act with an agent role, as in [Project setup for agents](/developers/project-setup).

```json
{ "type": "number", "key": "overallScore", "label": "Overall score", "properties": { "uagAuthoritative": "true" } }
```

### `uagAgentDecides`

| | |
|---|---|
| **Goes on** | A decision field |
| **Default** | Off: only a calibrated, confident answer is saved |
| **Value** | `"true"` |

Server-side reconciliation also writes an agent engine's answer (status `suggested`, uncalibrated) as if it were confident, replacing the stored value. This is for workflows that run with an agent engine and no decision engine, such as a chain of Run task actions where one task's decision starts the next. Without it, such a deployment never saves its closed-set fields.

Each Run task run asks the agent again, so a person's later change to the field can be overwritten. Combine it with `uagAuthoritative`, so only the task sets the field.

```json
{ "type": "select", "key": "decision", "label": "Decision", "properties": { "uag": "admissions", "uagAgentDecides": "true" } }
```

## Related settings outside the form

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `agentApi.threshold` | UAG configuration | `0.5` | Default `uagThreshold`. |
| `agentApi.uncertainBand` | UAG configuration | `[0.2, 0.8]` | Default `uagUncertainBand`. |
| `routing.decision`, `routing.value` | UAG configuration | `['decision', 'agent']`, `['agent']` | Default engine lists; `uagEngine` overrides them. |
| `task`, `answer`, `when` | "Agent: Run task" action settings | none, `task`, `after` | The task the action runs, whether it answers the whole task or its decision fields only, and whether it runs before or after the save. |
| `clearOnHide` | Each decision field | Form.io's default, `true` | Set `false` on decision fields that conditionals can hide, or hiding a page wipes the values that decided it. The setting on a surrounding panel or page does not protect the field. |

See [Engines](/developers/engines) for the configuration and [Workflows](/developers/workflows) for the action.
