---
title: Form properties
description: Every form tag and custom component property the UAG reads, where each one goes, its default, and an example.
section: Concepts
order: 20
---

The UAG is configured almost entirely in Form JSON. This page lists every form-level setting and custom component property it reads. [Concepts](/developers/concepts) explains how they fit together.

Custom properties are key/value pairs set in the form builder under a component's **API → Custom Properties**, and stored in Form JSON under the component's `properties`. The builder stores every value as a string, so booleans are written `"true"` and `"false"`, and numbers as their text.

```json
{ "type": "radio", "key": "claimType", "label": "Kind of claim",
  "properties": { "uag": "triage", "uagThreshold": "0.6", "uagConfidenceField": "claimTypeConfidence" } }
```

## Summary

| Property | Goes on | Default | Purpose |
|---|---|---|---|
| [`tags: ["uag"]`](#the-uag-tag) | The form | none | Registers the form with the UAG. |
| [`properties.description`](#form-description) | The form | generated | The description `get_forms` shows. |
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
| [`uagAuthoritative`](#uagauthoritative) | A decision field | `false` | Server-side reconciliation always wins, and clears what it cannot confirm. |
| [`uagAgentDecides`](#uagagentdecides) | A decision field | `false` | Server-side reconciliation also saves an agent engine's answer. |

## Form-level settings

### The `uag` tag

| | |
|---|---|
| **Goes on** | The form or resource, in `tags` |
| **Default** | Not tagged: the form is invisible to agents |

Only tagged forms are registered. Every MCP tool, and every `/agent/*` endpoint, treats an untagged form as one that does not exist.

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
- `input` on a field or container makes its value the task's source text. Without an input, a task reads the whole submission except the fields it is filling. `/agent/extract` needs an input, or a `text` value in the request.

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

Read-only tools an agent engine may call to research the task's **value** fields before it answers, in `/agent/generate` and `/agent/provide`. Extract and decide never research. The tools run with the caller's identity, so Form.io permissions apply to what they return; a webhook calling with the project key researches as administrator.

A tool that may write, or that does not exist, is refused when the task is planned for research: generate and provide answer `400`, naming the tool. An agent engine that does not support tool use is passed over for such a task. Remote engines receive a scoped token limited to these tools; see [Security](/developers/security#scoped-tokens-for-remote-engines).

```json
"properties": { "uag": "admissions", "uagField": "criteria", "uagTools": "find_submissions" }
```

The tools that qualify are those annotated read-only: `get_forms`, `get_form_fields`, `get_field_info`, `collect_field_data`, `confirm_form_submission`, `find_submissions`, `agent_provide` (and its deprecated name `agent_provide_data`), `agent_decide` and `fetch_external_data`, plus any custom tool whose annotations set `readOnlyHint: true`.

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

By default every choice question is asked a second time with its options in reverse order, because decision models favor the first option they see. If the two answers differ, the field is `uncertain`. Turn it off to halve the questions for a field whose options are unambiguous.

### `uagConfidenceField`

| | |
|---|---|
| **Goes on** | A decision field |
| **Default** | None |
| **Value** | The data path of another field, usually a hidden number |

Writes the decision's confidence to that field, so ordinary Form.io conditionals and webhook conditions can act on it.

- In extract, decide and generate results, an `uncertain` decision's confidence is written just below the field's threshold (never above the real confidence), so a "less than the threshold" condition matches every uncertain decision.
- In server-side reconciliation (`/agent/provide`, `agentDecide`), the confidence is written with a confident decision, and cleared with an authoritative field the server could not confirm. A change in confidence alone never causes a save.

When the companion is itself flagged with the task, it is excluded from answering (`holds the confidence of another field`).

```json
{ "type": "radio", "key": "claimType", "properties": { "uag": "triage", "uagThreshold": "0.6", "uagConfidenceField": "claimTypeConfidence" } }
{ "type": "hidden", "key": "claimTypeConfidence", "properties": { "uag": "triage" } }
```

A wizard page conditioned on `claimTypeConfidence` below `0.6` then appears only when triage is unsure.

### `uagAuthoritative`

| | |
|---|---|
| **Goes on** | A decision field |
| **Default** | Off: a stored value is kept when the server is not confident |
| **Value** | `"true"` |

In server-side reconciliation (`/agent/provide` and the `agentDecide` action) the server's result always wins for this field. A confident result is written; any other answered result (uncertain or missing) **clears** the field, and its confidence field, so a person decides. If no engine can answer at all (failure, timeout, rate limit, none enabled), the save is refused with `503` or `429` instead, so nothing is cleared by an outage.

Use it for fields that drive sensitive routing and must not be set by a browser, such as a fraud flag.

### `uagAgentDecides`

| | |
|---|---|
| **Goes on** | A decision field |
| **Default** | Off: only a calibrated, confident answer is saved |
| **Value** | `"true"` |

Server-side reconciliation also writes an agent engine's answer (status `suggested`, uncalibrated) as if it were confident, replacing the stored value. This is for workflows that run with an agent engine and no decision engine, such as a webhook chain where one task's decision starts the next. Without it, such a deployment never saves its closed-set fields.

Each `/agent/provide` run asks the agent again, so a person's later change to the field can be overwritten.

```json
{ "type": "select", "key": "decision", "label": "Decision", "properties": { "uag": "admissions", "uagAgentDecides": "true" } }
```

## Related settings outside the form

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `agentApi.threshold` | UAG configuration | `0.5` | Default `uagThreshold`. |
| `agentApi.uncertainBand` | UAG configuration | `[0.2, 0.8]` | Default `uagUncertainBand`. |
| `routing.decision`, `routing.value` | UAG configuration | `['decision', 'agent']`, `['agent']` | Default engine lists; `uagEngine` overrides them. |
| `task` | `agentDecide` action settings | the form's first task | The task the action re-decides. `persona` is still read. |
| `clearOnHide` | Each decision field | Form.io's default, `true` | Set `false` on decision fields that conditionals can hide, or hiding a page wipes the values that decided it. The setting on a surrounding panel or page does not protect the field. |

See [Engines](/developers/engines) for the configuration and [Workflows](/developers/workflows#re-deciding-on-the-server) for the action.
