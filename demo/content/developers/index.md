---
title: How the UAG works
description: The architecture of the Form.io Universal Agent Gateway, how it reads your project, and the request flow of each of its three usage patterns.
section: Start here
order: 1
---

The Universal Agent Gateway (UAG) is a server that sits between AI agents and a Form.io project. It reads the project's forms and gives agents two things: context they can understand, and a governed way to write data back. Everything an agent knows about your data (which forms exist, what each field means, which values are valid, what a task should decide) comes from Form JSON that you already manage in Form.io.

This page explains the moving parts. If you want to run something first, go to the [Quickstart](/developers/quickstart) and come back.

## Forms are the contract

The Form.io JavaScript renderer turns Form JSON into an interface a person can use: labels, inputs, validation messages, conditional pages. The UAG does the same thing for an agent. It turns the same Form JSON into Markdown and structured JSON that a model can read: each field's data path, type, description, allowed options, format and validation rules, plus instructions written in the form itself.

![The UAG renders Form JSON for an agent the way the JavaScript renderer renders it for a person.](/images/uag-agent-rendering.png)

Because the form is the contract, the behavior of every agent connected to the UAG follows the form:

- **Add a field** and agents start asking for it.
- **Change an option list** and agents offer the new options and reject the old ones.
- **Rewrite a criteria block** and an autonomous task decides differently on the next submission.

None of this needs a redeploy, a prompt change or a retrained model. The UAG picks up the change on its next project refresh (see [Project sync and caching](#project-sync-and-caching)).

The form also stays the gate on writes. Every value an agent proposes is validated by the form's own rules on the server before it is saved, and every call runs with a Form.io identity whose roles and permissions apply.

## The layers

The UAG is built from layers that either supply context to the agent or accept deterministic data from it.

![The layers of the UAG, from the MCP interface down to the database.](/images/uag-overview.png)

| Layer | What it does | Where to read more |
|---|---|---|
| **MCP interface** | `/mcp` serves the [Model Context Protocol](https://modelcontextprotocol.io) over Streamable HTTP. Each request gets its own MCP server instance (stateless mode), so concurrent requests never share a transport. | [MCP tools](/developers/mcp-tools) |
| **Agent API** | `/agent/*` runs a form's tasks inside the UAG with model engines you enable, and returns validated values. It is the HTTP surface for webhooks and applications. | [Agent API](/developers/agent-api) |
| **Authentication** | An OAuth 2.0 authorization server with PKCE, layered on Form.io's own authentication. Users log in with whatever the project uses (Form.io login, SAML, OIDC, custom), and the UAG issues its own tokens. Servers use the `client_credentials` grant or an admin credential. | [Security](/developers/security) |
| **Built-in tools** | Twelve MCP tools that list forms, describe fields, validate and collect data, submit, search, update, and expose tasks. Each is annotated as read or write. | [MCP tools](/developers/mcp-tools) |
| **Custom tools and actions** | A module can add MCP tools, override the built-in ones, and add form actions: Express middleware that runs after the UAG has validated what an agent sent. | [Modules](/developers/modules) |
| **Built-in actions** | Every Form.io action configured on a form runs for agent submissions too. The Webhook action is how autonomous workflows start. The UAG adds one action of its own, `agentDecide`. | [Workflows](/developers/workflows) |
| **Response templates** | What the tools return to the agent is rendered from Lodash templates, which a module can override. | [Modules](/developers/modules) |
| **Pre-defined forms** | A module can ship a project template (forms, resources, actions, roles) that the UAG installs into the project. | [Modules](/developers/modules) |
| **Database** | By default the UAG reads and writes submissions through the Form.io REST API (a submission proxy). Against an Enterprise project it can connect directly to MongoDB with `MONGO`. | [Deployment](/developers/deployment) |

The UAG is itself an application built on `@formio/appserver`. Form processing, validation, conditionals and actions run in the same engine Form.io uses, so a value the UAG accepts is a value Form.io would accept.

## What the UAG reads from a form

The UAG registers only forms tagged `uag`. A form without the tag is invisible to every agent and every tool; nothing errors, the form simply is not there.

Inside a tagged form, custom properties on components define **tasks**: a criteria content component with the instructions, the agent fields the task fills, and optionally an input field to read from. Tasks are what autonomous workflows and Agentic Formflow run. Conversation forms need no task at all: a tagged form with ordinary fields is enough.

[Concepts](/developers/concepts) explains tasks in depth, and [Form properties](/developers/form-properties) lists every property the UAG reads.

## Project sync and caching

When the UAG starts, it loads the project from `PROJECT`: it calls the project's `/export` endpoint and registers every form and resource, with its actions, roles and access rules. It then serves agents from that cached copy.

```pipeline
UAG boots -> reads {PROJECT}/export -> registers the uag-tagged forms and tasks -> installs missing template items (TEMPLATE_SYNC=boot) -> serves /mcp and /agent* -> re-reads /export every PROJECT_TTL seconds
```

| Setting | Default | Effect |
|---|---|---|
| `PROJECT_TTL` | `900` | Seconds between refreshes. Each refresh re-reads the export and brings in forms that were added, changed or deleted, and their actions. `0` disables refreshes, so only a restart picks up changes. The export is expensive on the Form.io side, so values below `60` are not recommended outside development. |
| `TEMPLATE_SYNC` | `boot` | When a module's project template is installed: `boot` at startup, `refresh` also on every TTL refresh, `off` never. Only what the project is missing is installed. |
| `PROJECT_RETRIES`, `PROJECT_RETRY_DELAY` | `5`, `5000` | How many times, and with what initial delay in milliseconds, the UAG retries a project that is still starting (a Form.io server in the same compose file, for example). The delay doubles on each attempt. |

Two consequences matter in practice:

- **A form edit is not instant.** Adding the `uag` tag, rewriting criteria or flagging new agent fields reaches agents after the next refresh, so allow up to `PROJECT_TTL` seconds. Restart the UAG to register changes immediately.
- **The project is the source of truth, not the template.** A module's template only adds what the project lacks, matched by key. It never changes a form or action the project already has. Change existing forms in the portal, through a stage deployment, or by posting the template to the project's `/import` endpoint. With `TEMPLATE_SYNC=boot`, a template form you deleted from the project comes back on the next restart; use `off` when stage deployments manage the project.

## Three ways to use it

The UAG supports three usage patterns. They share the same forms, authentication and validation, and one deployment can serve all three at once.

| Pattern | Who drives | Entry point | Model runs | License |
|---|---|---|---|---|
| **Conversation forms** | A person, through an agent | `/mcp` | In the MCP client (Claude, your own app) | None |
| **Agentic workflows** | A Form.io event | Webhook to `/agent/provide` | In the UAG, through an engine | Agentic Formflow |
| **Agentic Formflow** | An application, or a person typing in a form | `/agent/extract`, `/decide`, `/generate` | In the UAG, through engines | Agentic Formflow |

### Conversation forms over MCP

A person talks to an agent, and the agent fills in a form for them. The agent can be an existing MCP client (Claude Desktop, claude.ai, Claude Code) or a chat application you write. The model runs in the client; the UAG supplies context and performs the writes.

```sequence
participants: User, Your agent (MCP client + model), UAG*, Form.io
User -> Your agent (MCP client + model): "My internet has been down since last night"
Your agent (MCP client + model) -> UAG: get_forms, get_form_fields, get_field_info
UAG -> Form.io: reads the form JSON
UAG --> Your agent (MCP client + model): fields, rules, allowed values
Your agent (MCP client + model) -> UAG: collect_field_data, as the user answers
note UAG: validates every value against the form
Your agent (MCP client + model) -> UAG: confirm_form_submission, then submit_completed_form
UAG -> Form.io: saves the validated submission
```

1. The client authenticates: a remote client through the browser-based OAuth (PKCE) flow, a server-side client with `client_credentials`.
2. The agent calls `get_forms` to see which tagged forms the user may use, then `get_form_fields` and `get_field_info` to learn what the chosen form needs.
3. As the user answers, the agent calls `collect_field_data`, which validates the answers against the form and reports what is still missing. Several fields can come from one sentence.
4. `confirm_form_submission` produces a summary for the user to approve, and `submit_completed_form` creates the submission. The UAG runs the form's validation and actions, as Form.io would for a person.

The same tools let the agent find records (`find_submissions`) and change them (`submission_update`). The caller's Form.io permissions apply to every call, so an agent signed in as an employee cannot do what an employee cannot do.

Build this with [MCP tools](/developers/mcp-tools) or [Connect Claude](/developers/connect-claude). See it live at [/examples/conversation](/examples/conversation).

### Agentic workflows

A submission starts an agent with no person in the loop. A Webhook action on the form posts the submission's id to `/agent/provide`; the UAG runs the task, validates the results and saves them once. Because the save is an ordinary update, it can trigger the next task.

```sequence
participants: Applicant, Form.io, UAG*, Engines
Applicant -> Form.io: submits
Form.io -> UAG: webhook: POST /agent/provide {form, task, submissionId}
note UAG: loads the submission and plans the task
UAG -> Engines: decision engine: closed-set fields; agent engine: open values
Engines --> UAG: answers (the agent may research with read-only tools)
note UAG: reconciles and validates
UAG -> Form.io: saves once; the save can start the next task
```

1. A person (or a system) creates a submission. Form.io saves it and runs the form's actions.
2. A Webhook action, after create, with `block: false`, posts `{ form, task, submissionId }` to the UAG with the project API key.
3. The UAG loads the submission and plans the task: which fields are decisions, which are open values, what the engines may read.
4. Decision engines answer closed-set fields with a calibrated confidence; agent engines write open values, and may first research with read-only tools the task allows.
5. The UAG reconciles the answers with the stored submission, validates the result with the form, and saves only if something changed. Provenance for each value goes into `metadata.uag`.
6. That save fires `update` actions. A second webhook, with a condition on a field the first task set, starts the next task.

No model holds a write tool at any point. Build this with [Workflows](/developers/workflows). See it live at [/examples/workflow](/examples/workflow).

### Agentic Formflow

An application asks the UAG to fill a form from free text or in-flight data, and nothing is saved. The typical case is a person describing what happened while the form fills itself in: fast decisions choose which pages of a wizard apply, then extracted values prefill the rest for the person to check.

```sequence
participants: User, Renderer plugin, UAG*, Engines
User -> Renderer plugin: describes what happened, presses Next
Renderer plugin -> UAG: POST /agent/extract, text/event-stream, the user's token
UAG -> Engines: decision engine and agent engine, at once
Engines --> UAG: decisions, in a fraction of a second
UAG --> Renderer plugin: event: result (decisions)
note Renderer plugin: conditional pages appear
UAG --> Renderer plugin: event: result (values), then done
note Renderer plugin: fills empty fields as suggestions
```

1. The renderer plugin (or your code) posts the input text and the current data to `/agent/extract`, asking for a Server-Sent Events stream, with the signed-in user's bearer token.
2. The UAG runs each engine group concurrently. Decision results stream back first, in a few hundred milliseconds, so conditional pages appear before the person moves on.
3. Agent-engine values follow as `suggested`. The renderer prefills them without ever overwriting what the person typed.
4. A `done` event carries the merged data, validated by the form.
5. When the person submits, the `agentDecide` action can re-decide the closed-set fields on the server, so routing never depends only on values the browser sent.

`/agent/decide` and `/agent/generate` do the same on in-flight data, for decisions only or open values only. Build this with the [Agent API](/developers/agent-api) and the [renderer plugin](/developers/renderer). See it live at [/examples/formflow](/examples/formflow).

## Where the models run

The UAG never trains or hosts a model. In MCP conversations, the client's model does the reasoning. In workflows and Agentic Formflow, the UAG calls **engines**: adapters for a model provider, each its own npm package (`jev`, `claude`, `openai`, `grok`, `gemini`). The `formio/uag` image includes all of them, and none runs until you name it in `UAG_ENGINES`. Engines can also run in a separate engine server container, so model keys and model traffic stay out of the UAG.

Engines only answer. The UAG decides which fields each engine sees, validates every answer, and performs every write. See [Engines](/developers/engines) and [Engine server](/developers/engine-server).

## Map of these docs

| If you want to | Read |
|---|---|
| Run the UAG and make your first calls | [Quickstart](/developers/quickstart) |
| Understand tasks, criteria, inputs and decision fields | [Concepts](/developers/concepts) |
| Look up a custom property | [Form properties](/developers/form-properties) |
| Build an MCP client or call the tools | [MCP tools](/developers/mcp-tools) |
| Call extract, decide, generate or provide | [Agent API](/developers/agent-api) |
| Run agents from Form.io webhooks | [Workflows](/developers/workflows) |
| Connect Claude Desktop or claude.ai | [Connect Claude](/developers/connect-claude) |
| Fill forms as users type | [Renderer](/developers/renderer) |
| Embed the UAG in a Node.js application | [Node.js API](/developers/node-api) |
| Add tools, actions, forms and templates | [Modules](/developers/modules) |
| Choose, configure and route engines | [Engines](/developers/engines) |
| Write your own engine | [Engine SDK](/developers/engine-sdk) |
| Keep model keys out of the UAG | [Engine server](/developers/engine-server) |
| Measure decision accuracy before going live | [Evaluation](/developers/evaluation) |
| Understand the trust model and harden a deployment | [Security](/developers/security) |
| Deploy and configure the UAG | [Deployment](/developers/deployment) |
| Fix something that does not work | [Troubleshooting](/developers/troubleshooting) |
