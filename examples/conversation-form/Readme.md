# Example: Conversation Form

<sub>[Form.io UAG](../../README.md) &rsaquo; this page</sub>

A chat application where **the form is the script**. A customer types "my internet has been down since last night" and an agent works out which form applies, what it still needs, which answers are valid, and when it has enough to submit — all by reading the form JSON through the UAG.

The chat server in this example is about 200 lines and contains no domain knowledge whatsoever. It never names a field, never lists the urgency options, never validates an email address. Search [`chat/server.js`](./chat/server.js) for "urgency" or "email" and you will not find them. Change the form and the conversation changes with it, with no redeploy and no prompt editing.

This example runs on [Form.io Community Edition](https://github.com/formio/formio), so no license or subscription is required.

> Want the *autonomous* pattern instead — a submission that an agent scores and decides on with no human present? See [examples/agentic-workflow](../agentic-workflow).
>
> Want to drive your forms from Claude Desktop rather than your own UI? See [examples/custom-module](../custom-module).

## How it fits together

```
browser  ──►  chat server  ──►  UAG  ──►  Form.io
   UI          MCP client       tools      forms + submissions
               + Claude API
```

The chat server holds the conversation history and runs the tool-use loop itself. It connects *out* to the UAG, so the UAG needs no public address and no tunnel — see [How Agents Connect](../../README.md#how-agents-connect). The Anthropic API only ever receives outbound requests carrying tool schemas and tool results.

## Pre-requisites

- **Docker** — https://www.docker.com
- **An Anthropic API key** — https://console.anthropic.com. A full conversation costs well under a cent.

## Running it

```bash
cp .env.example .env       # then edit .env and add your Anthropic API key
docker compose up -d --build
```

First boot takes about 30 seconds while Form.io initializes its database and the UAG installs the `serviceRequest` form from [`module/project.json`](./module/project.json).

Then open **http://localhost:3400** and start typing.

A conversation looks like this:

> **You:** My internet has been down since last night and I need someone to look at it.
> **Assistant:** That sounds frustrating! I can get a service request started for you. Could I get your full name?
> **You:** I'm Marcus Webb, marcus.webb@example.com. It is completely down, nothing works.
> **Assistant:** Got it, thanks Marcus. I've marked this as high urgency since your service is completely down. What's the street address where the service is installed?

Note what happened in that third message: one sentence filled in `fullName`, `email`, and `urgency`, and "completely down, nothing works" was mapped to the form's `high` option rather than stored as prose. Under each assistant reply the UI prints which UAG tools were called, so you can watch the form being read and the answers being checked.

When the conversation finishes you have a real submission. Look at it in the portal at http://localhost:3000 (`admin@example.com` / `CHANGEME`) under **Service Request → Submissions**.

Shut down and discard everything with:

```bash
docker compose down -v
```

## The experiment worth running

This is the part that makes the point. Open [`module/project.json`](./module/project.json) and change the form — then reload the chat and start over.

Try any of these:

- **Add a field.** Give `serviceRequest` an `accountNumber` textfield with `"validate": {"required": true, "pattern": "^[0-9]{8}$"}` and a description explaining the format. The assistant starts asking for an account number and rejects `12345`, because `get_field_info` tells it the pattern.
- **Change the options.** Add `"Streaming or TV"` to the `category` values. It gets offered as a choice on the next conversation.
- **Make something optional.** Drop `"required": true` from `serviceAddress`. The assistant stops insisting on it.
- **Rewrite a description.** The `description` text on each component is context for the agent as much as for a human, so sharpening it changes how the question gets asked.

Then apply the change:

```bash
docker compose restart formio-uag
```

Restarting re-applies the template, and the very next message reflects the new form. (Within a running container the project cache also refreshes every `PROJECT_TTL` seconds — 10 in this example — which picks up forms edited through the portal.)

> **Restarting `formio-uag` resets the demo data.** Re-applying the template replaces the form documents, and the submissions attached to them go with it. That is fine for a demo and worth knowing before you go looking for a submission that has vanished.

## How the chat server works

Four things, all in [`chat/server.js`](./chat/server.js):

**1. It gets a token.** There is no browser in the loop, so it uses the `client_credentials` grant rather than the OAuth flow. On Community Edition the project name is always `formio-oss`, and the UAG requires that prefix on the `client_id`:

```js
POST /auth/token
{ "grant_type": "client_credentials",
  "client_id": "formio-oss-x-admin-key",
  "client_secret": ADMIN_KEY }
```

A `404` here means `BASE_URL` is not set on the UAG — without it the authentication provider is never enabled. The token is cached until shortly before it expires.

**2. It connects an MCP client to the UAG** over streamable HTTP, passing that token as a bearer token, and calls `listTools()` to discover what is available.

**3. It runs the tool loop.** Send history to Claude; if the reply is `tool_use`, execute each call against the UAG and append the results; repeat until text comes back. Conversation history lives in a `Map` keyed by session id.

**4. Its system prompt describes a process, not a form.** This is the whole trick — the prompt says *which tools to use in what order* and *how to behave while asking*, and says nothing about service requests:

```
1. Call get_forms ... pick the one that matches what the customer wants.
2. Call get_form_fields for that form to learn exactly which fields it has.
3. Call get_field_info before asking about a field ...
4. Ask ONE question at a time ...
```

The tools it leans on, in the order a conversation tends to use them:

| Tool | Role in the conversation |
|---|---|
| `get_forms` | Which forms exist — only `uag`-tagged ones are returned. |
| `get_form_fields` | What this form needs, and each field's data path. |
| `get_field_info` | Type, required-ness, validation rules, and the exact allowed values for choice fields. |
| `collect_field_data` | Records answers as they arrive, including several fields from one sentence. |
| `confirm_form_submission` | Produces the summary shown back to the customer before submitting. |
| `submit_completed_form` | Creates the actual submission. |

## Caveats before you build on this

- **Sessions are in memory.** Restarting the chat container forgets every conversation. Persist them somewhere real if you need continuity.
- **The chat acts as an administrator.** It authenticates with `ADMIN_KEY`, so the agent can see and write anything in the project. That is deliberate for a single-form demo and wrong for a multi-tenant one: authenticate each *user* instead, so the UAG applies that user's roles and permissions to every tool call. [examples/custom-module](../custom-module) shows a project where role-based permissions decide what the agent may do.
- **No spend controls.** Each turn is a full tool loop. Add per-session rate limiting before exposing anything like this publicly.
- **The model still writes the prose.** The form constrains *what is collected and what is valid*; it does not constrain tone. Keep the summary-and-confirm step so a human approves the data before it is written.
- **`ADMIN_KEY`, `JWT_SECRET`, and the Mongo secrets are all `CHANGEME`.** Change them for anything beyond a local demo.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `docker compose up` fails with `set CLAUDE_API_KEY in .env` | You have not created `.env` yet. Copy `.env.example`. |
| The assistant says it cannot find a form | The form lost its `uag` tag, or the project cache has not refreshed. `docker compose restart formio-uag`. |
| Every turn errors with a token message | `BASE_URL` is unset on the UAG, or `ADMIN_KEY` differs between the `formio`, `formio-uag`, and `chat` services — all three must match. |
| The chat container exits at startup | It cannot reach the UAG. Check `docker compose logs formio-uag`; on a slow first boot the UAG waits for the server healthcheck. |
| A submission you just made has disappeared | `formio-uag` restarted and re-applied the template. See the note above. |

For anything else, start with the [Troubleshooting section](../../README.md#troubleshooting) in the main Readme.
