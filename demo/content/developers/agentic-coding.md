---
title: Agentic Coding Plugin
description: Install the Form.io Agentic Coding Plugin, and let your coding agent make your forms agent-ready, deploy the UAG and wire your application to it.
section: Start here
order: 2
---

The fastest way to build on the UAG is to let your coding agent do it. The **Form.io Agentic Coding Plugin** ([`formio/ai`](https://github.com/formio/ai), MIT) teaches Claude Code, Cursor, Codex, Copilot and other coding agents that read skills how Form.io and the UAG work. You describe what an agent should do with your forms, and your coding agent tags and writes the forms, designs their tasks, deploys the UAG and its engines, and adds the code your application needs.

Form.io's AI tools come in two parts, and both work from your Form JSON:

| | What it is | When it runs |
|---|---|---|
| **Agentic Forms** | The UAG, which puts AI agents in front of your forms and holds them to the form's rules | At runtime, in your environment |
| **Agentic Coding Plugin** | Skills and the Form.io MCP server, which let your coding agent build those forms and the application around them | At build time, in your editor or terminal |

The rest of these docs describe what to build. This page shows how to have your coding agent build it from them.

## Install

Open a terminal in your application's folder, then use either route.

### Any coding agent that reads skills

```bash
npx skills add formio/ai
```

This installs the skill library into `.agents/skills/`, which every skills-capable agent reads. It installs skills only. The first time a skill needs a Form.io tool, the bundled `formio-mcp-setup` skill writes the Form.io MCP server's configuration for your client, asks you to approve it, and tells you to reload.

### Claude Code

```text
/plugin marketplace add https://github.com/formio/ai.git
/plugin install formio-ai@formio
```

The plugin includes the skills and the Form.io MCP server in one install. Plugin installs for Cursor, Codex and Copilot are coming; until then, use `npx skills add formio/ai` with them.

## Point it at your project

The plugin's tools work against a project on [Form.io's hosted service](https://portal.form.io) or a Form.io Enterprise server. You need one value, the **Project URL**, such as `https://myproject.form.io`. The first Form.io tool call that needs it asks for it, and records it for this folder. The first call that needs to sign in opens the Form.io login in your browser. There are no API keys to paste.

To share the project with everyone who clones the application, commit a `formio.json` in the application's folder:

```json
{ "projectUrl": "https://myproject.form.io" }
```

The **UAG URL** is a separate value: where your applications, browsers and MCP clients reach the UAG, such as `http://localhost:3200` in development. Your coding agent asks for it when it writes it into your application's configuration, and never confuses it with the Project URL.

## What to ask for

Describe the outcome, not the settings. The plugin's `formio-uag` skill maps the request to one of the UAG's [usage patterns](/developers#three-ways-to-use-it), and says up front whether it needs a license. Each prompt below builds one of this site's live demos in your own project.

| You want | Ask your coding agent | See it running |
|---|---|---|
| A chat on your page that fills in a form | [Service chat prompt](https://github.com/formio/ai/blob/main/examples/agents/service-chat.md): *"Put a chat on our public support page where customers describe their problem and it fills in our serviceRequest form, then submits it once they confirm."* | [Conversation Forms](/examples/conversation) |
| Agents that review every submission | [Admissions workflow prompt](https://github.com/formio/ai/blob/main/examples/agents/admissions-workflow.md): *"Every college application should be scored by an admissions agent, and scholarship candidates by a finance agent that picks the award level."* | [Agentic Workflow](/examples/workflow) |
| A wizard that fills itself in from a description | [Claim wizard prompt](https://github.com/formio/ai/blob/main/examples/agents/claim-formflow.md): *"When the policyholder describes the incident, decide the claim type so the right pages appear, and prefill the date and location for them to check."* | [Agentic Formflow](/examples/formflow) |
| Claude or your own agent talking to your forms | *"Connect Claude Desktop to our Form.io forms through the UAG, signing in with our users' own Form.io logins."* | [Connect Claude](/developers/connect-claude) |

Start a prompt with `/formio-uag` to load the skill explicitly in agents that take slash commands. Without it, the skill loads from the request's wording.

## What your coding agent does

The `formio-uag` skill works in five steps, and hands parts of the work to the plugin's other skills:

```pipeline
your request -> 1 pattern: pick the surface, say what needs a license -> 2 form: tag, describe, design tasks* -> 3 server: Compose or Kubernetes, engines, Run task actions -> 4 application: @formio/uag-js, the chat widget, Agent API or MCP client code -> 5 verify: the checks for you to run
```

1. **Pattern.** It chooses conversation forms over MCP, the [chat widget](/developers/chat), [Agentic Formflow](/developers/agent-api) or an [agentic workflow](/developers/workflows), and tells you which need a license.
2. **Form.** It tags each form `uag`, writes a description and field descriptions an agent can use, and designs the tasks: the criteria, input, decision and value fields, and their [properties](/developers/form-properties). Form writes go through the `formio-form-builder` skill, which shows each change and asks before saving it.
3. **Server.** It writes a Compose stack or Kubernetes manifest for your edition, with the engines your pattern needs and an `.env.example` whose secrets are placeholders for your secret store. It adds "Agent: Run task" actions in a project template, a [UAG module](/developers/modules) or a portal stage connected to the UAG, and hands agent roles and permissions to the `formio-auth` skill.
4. **Application.** It registers [`@formio/uag-js`](/developers/renderer) in a formio.js, React or Angular application, renders a form as a chat, calls the [Agent API](/developers/agent-api) from your backend, or connects an [MCP client](/developers/mcp-tools).
5. **Verify.** It hands you the checks from [Troubleshooting](/developers/troubleshooting) to run yourself: `GET /agent/capabilities` for the edition, engines and license, and a stateless `decide` or `generate` to see each field's status before anything is saved.

## Guardrails

The skill builds to the UAG's [security model](/developers/security):

- **You see every form change first.** Nothing is saved to a form until you approve the change.
- **Settings that widen access or spend money are named on their own:** `uagAnonymous`, tools added to `uagTools`, removing `uagAuthoritative` from a field a task owns, and anonymous create access on a public form. Each one is confirmed separately.
- **Keys stay on servers.** Project and admin keys never go into browser code; pages use the signed-in user's Form.io token, or a relay of your own.
- **Decisions that matter are made on the server,** with a Run task action before the save and the decided fields marked `uagAuthoritative`.
- **It does not call your live UAG or its MCP tools.** It writes the commands that check them into its verification steps, for you to run.

## Two MCP servers

The plugin and the UAG both speak MCP, for different readers:

| | Form.io MCP server, in the plugin | The UAG's `/mcp` |
|---|---|---|
| Used by | Your coding agent | Your users' agents: Claude, ChatGPT, your own |
| Purpose | Build: create and change forms, actions, roles and projects | Run: discover forms, collect values, submit validated data |
| Tools | `form_create`, `form_update`, `action_list`, `project_import`, ... | `get_forms`, `collect_field_data`, `submit_completed_form`, ... |
| Runs | Beside your coding agent, signed in as you | Next to your Form.io project, as the caller |

## Next steps

- [How the UAG works](/developers): the architecture your coding agent builds on.
- [Quickstart](/developers/quickstart): run the UAG by hand, if you want to see each step.
- [The plugin on GitHub](https://github.com/formio/ai): every skill, the MCP server's tools, and more example prompts.
