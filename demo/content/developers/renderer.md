---
title: JavaScript (formio.js)
description: Register the UAG once in a formio.js application with @formio/uag-js. Forms tagged uag then save through the UAG and get Agent Input, which fills them from a description without overwriting what the user entered, and any of them can be rendered as a chat.
section: Build
order: 40
---

`@formio/uag-js` connects a [formio.js](https://github.com/formio/formio.js) application to the UAG. You register it once, and render forms exactly as before, from their Form.io URLs. For every form tagged `uag`:

- **Its submissions are saved through the UAG,** so the form's [Run task](/developers/workflows) actions run on them. Other forms, and every other request, still go straight to Form.io.
- **Agent Input is attached** when one of the form's tasks has an input. The user describes something in their own words, and the rest of the form is filled from the form's own [agent operations](/developers/agent-api): fast decisions first, so conditional pages react at once, then extracted values. Every value it writes is one the user can see, check and change, and it never writes over a value the user entered.

The same registration adds a third: **any `uag` form can be rendered as a chat** with `Formio.createChat`, where a person fills it in by conversation. See [Chat widget](/developers/chat).

Tagging a form `uag` in the portal is then all it takes to move it onto the UAG; the application does not change. See it running in the [Agentic Formflow demo](/examples/formflow).

> **Tip:** The [Agentic Coding Plugin](/developers/agentic-coding)'s `formio-uag` skill registers `@formio/uag-js` in formio.js, React and Angular applications, and designs the task Agent Input runs. The [claim wizard prompt](https://github.com/formio/ai/blob/main/examples/agents/claim-formflow.md) builds the Agentic Formflow demo.

```sequence
participants: User, formio.js + @formio/uag-js, UAG*, Form.io
formio.js + @formio/uag-js -> Form.io: GET the form (tagged "uag")
User -> formio.js + @formio/uag-js: types into "What happened?", presses Next
formio.js + @formio/uag-js -> UAG: POST {form}/agent/extract (streamed, the user's Form.io token)
UAG --> formio.js + @formio/uag-js: decisions, then values
User -> formio.js + @formio/uag-js: checks, changes, submits
formio.js + @formio/uag-js -> UAG: POST {form}/submission
UAG -> Form.io: the submission, after Run task
```

## Get it

`npm install @formio/uag-js` (2.x). It has no dependencies, and works with formio.js 5 (`@formio/js` 5.x). It is an ES module, a CommonJS module, and the browser global `FormioUAG`.

| File | What it is |
|---|---|
| `index.js`, `index.mjs` | The module. |
| `uag-js.css` | Default styles for the notes Agent Input adds, and for the [chat](/developers/chat). Override them freely. |
| `index.d.ts` | TypeScript types. |

## Register it once

```js
import { Formio } from '@formio/js';
import { UAG } from '@formio/uag-js';
import '@formio/uag-js/uag-js.css';

Formio.setBaseUrl('https://forms.example.com');
Formio.setProjectUrl('https://forms.example.com/myproject');
Formio.use(UAG('https://uag.example.com'));

// Anywhere in the application, as before:
Formio.createForm(document.getElementById('claim'), 'https://forms.example.com/myproject/claim');
Formio.createForm(document.getElementById('contact'), 'https://forms.example.com/myproject/contact');

// Or a form as a chat (see Chat widget):
Formio.createChat(document.getElementById('help'), 'https://forms.example.com/myproject/servicerequest');
```

Registering also adds the `chat` display and `Formio.createChat` (also exported as `createChat`, and `UAG.createChat`).

Or with script tags:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@formio/uag-js@2.0.0/uag-js.css">
<script src="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@formio/uag-js@2.0.0/index.js"></script>
<script>
  Formio.use(FormioUAG.UAG('https://uag.example.com'));
</script>
```

Give `UAG()` the UAG's root URL. The module addresses each form on the UAG by its id: `{uag}/project/{projectId}/form/{formId}` for a project on Form.io Enterprise or the hosted service, and `{uag}/form/{formId}` on Open Source. Allow the application's origin in the UAG's `CORS` setting.

### What it changes, and what it does not

| Request | Goes to |
|---|---|
| A submission of a form tagged `uag`: create, read, update, delete and list | The UAG |
| A form tagged `uag`'s agent operations (Agent Input) | The UAG |
| The form's definition, files, resources and select data | Form.io, as before |
| Everything for a form without the tag | Form.io, as before |

Each request to the UAG carries the credential formio.js already sends to Form.io: the signed-in user's `x-jwt-token`, or none for a visitor who is not signed in. No other token is needed. When the UAG cannot be reached, the submission fails with formio.js's normal error. It is never sent to Form.io instead, which would skip the form's tasks.

A form loaded at a revision (`{form}/v/{n}`) is saved to the form itself, as formio.js does.

A form rendered from a definition object, rather than its URL, has no Form.io URL to route from: its submissions are not rerouted. Agent Input is still attached when the definition says which form it is (its `_id`, and `project` on Enterprise, as Form.io returns them); a definition without an `_id` gets none, and needs [`UAG.attach`](#attaching-by-hand) with a `formUrl`.

### This is not a security boundary

Routing happens in the browser, and a client can always send a submission straight to Form.io instead. What keeps a user from setting the fields an agent owns is on the server: an agent role and the form's permissions, which refuse that user's direct writes at Form.io, and `uagAuthoritative` on the fields, which the UAG removes from what clients send. See [Project setup for agents](/developers/project-setup).

### What the `uag` tag means

The tag now does four things at once. A form tagged `uag`:

1. is visible to agents over MCP;
2. can use the Agent API and "Agent: Run task";
3. is saved through the UAG by applications that register `@formio/uag-js`;
4. can be rendered as a [chat](/developers/chat), unless it sets `uagChat: "false"`.

## Chat

`Formio.createChat(element, src, options)` renders a `uag` form as a conversation instead of a form. Each turn is the form's `agent/chat` on the UAG, a formio.js form sits behind the chat (so its conditionals and validation apply), and the person submits through the UAG after confirming a summary. It needs no Agentic Formflow license. Templates, translations, styles, options and events are on [Chat widget](/developers/chat).

## Options

`UAG(uagUrl, options)`:

| Option | Default | Meaning |
|---|---|---|
| `agentInput` | `true` | `false` attaches no Agent Input anywhere. Submissions of `uag` forms still go to the UAG. |
| `task` | the task of the input that triggered it | The task Agent Input extracts for (its `uag` value). |
| `trigger` | `next` for wizards, `blur` otherwise | When to extract. See [Triggers](#triggers). |
| `pauseMs` | `800` | With `pause`: the pause in typing that triggers a request. |
| `nextTimeoutMs` | `1500` | With `next`: the longest the wizard waits for decisions before moving on. |
| `requireReview` | `false` | Make the user check each uncertain value before the wizard moves on or the form submits. See [Rules](#rules-agent-input-keeps). |
| `fetch` | the global `fetch` | The `fetch` Agent Input uses. |
| `onStart`, `onResult`, `onError`, `onDone` | | Agent Input's callbacks, for every form. See [Attaching by hand](#attaching-by-hand). |

## Set up the form

The form is a UAG form with a task (see [Form properties](/developers/form-properties)). Agent Input needs one more thing: the task's **input**, the field (or container) whose text is read. Give it the custom properties:

| Property | Value |
|---|---|
| `uag` | the task's name, such as `triage` |
| `uagField` | `input` |

```json
{
  "type": "textarea",
  "key": "lossDescription",
  "label": "What happened?",
  "input": true,
  "properties": { "uag": "triage", "uagField": "input" }
}
```

When the trigger fires, Agent Input sends the form's current data, and the UAG reads the input from it. The user needs create or update permission on the form. For visitors who are not signed in, see [Public forms](#public-forms).

> **Tip:** If decision fields can be hidden by conditionals, set `clearOnHide: false` on the fields themselves, so hiding a page does not wipe the values that decided it.

## Attaching by hand

`UAG.attach(form, options)` attaches Agent Input to one rendered form, for example with `agentInput: false`, or to call a relay of your own. It replaces the form's earlier attachment, the automatic one included, so the form never extracts twice. The package includes TypeScript types.

```ts
UAG.attach(form: Webform | Wizard, options?: {
    task?: string;
    trigger?: 'blur' | 'pause' | 'next' | 'button';
    formUrl?: string;   // where the form's agent operations are; default: the form on the UAG
    pauseMs?: number;
    nextTimeoutMs?: number;
    requireReview?: boolean;
    fetch?: typeof fetch;
    onStart?: ({ followUp }) => void;
    onResult?: (event) => void;
    onError?: (error) => void;
    onDone?: (summary, { followUp }) => void;
}): {
    extract(): { decided: Promise<void>; done: Promise<void> };
    state: ExtractionState;
    detach(): void;
};
```

| Callback | Called |
|---|---|
| `onStart` | A request is starting. `followUp` is `true` for the request that fills fields the decisions revealed. |
| `onResult` | One engine group's results have been applied. |
| `onError` | A request failed, or a group's engines all failed (the stream's `error` event). The error's `event` is that event's data, when it came from one. |
| `onDone` | A request finished. `summary` is the API's final response, or `null` when it failed. Not called for a request replaced by a newer one. |

The controller:

| Member | Meaning |
|---|---|
| `extract()` | Extract now, for the configured `task`, or without one (every task with an input). Returns `{ decided, done }`: `decided` resolves once the first decision results are applied (or the request ends without any), `done` once the whole request, and any follow-up, has finished. Failures go to `onError`; both promises still resolve. |
| `state` | Agent Input's record of which values it wrote and which the user changed (an `ExtractionState`). `state.source(path)` is `'user'`, `'agent'` or `'none'`. |
| `detach()` | Remove the listeners and annotations, restore the wizard's hooks, and abort a request in flight. |

Forms attached automatically are detached when formio.js destroys them.

## Triggers

Without a configured `task`, each request is for the task of the input that fired it, so a form with several tasks runs only the one the user described.

| Trigger | Fires | Use for |
|---|---|---|
| `blur` | When the user leaves one of the task's inputs (or a field inside an input container). | Single-page forms. |
| `pause` | After `pauseMs` without typing in an input. | Filling as the user types. |
| `next` | On wizard **Next**, from the page that holds the input. The wizard waits for decisions, up to `nextTimeoutMs`, so the pages they turn on are in place before it moves. | Wizards whose pages depend on triage. |
| `button` | Never: no listener is attached. Call `extract()` yourself. | Your own "Fill in from description" button. |

With `next`, Agent Input installs formio.js's `beforeNext` hook on this form only, leaving any `hooks` object it shares with other forms as it was. An existing `beforeNext` hook runs first, on the form; if it reports an error, the wizard stops there. On a page without an input, Next proceeds without a request. After the wait, it re-runs the form's conditionals (`checkData`) and recomputes the wizard's pages (`establishPages`), because formio.js debounces change handling and would otherwise pick the next page before the new values counted.

## How results arrive

Each request is:

```http
POST /project/{projectId}/form/{formId}/agent/extract HTTP/1.1
Host: uag.example.com
Content-Type: application/json
Accept: text/event-stream
x-jwt-token: <the user's Form.io token>

{ "data": { "lossDescription": "Yesterday a pickup rear-ended my Civic…" } }
```

The UAG answers with Server-Sent Events: one `result` event per engine group as soon as it finishes (decisions first, since decision engines answer in milliseconds), an `error` event for a group whose engines all failed, then a `done` event with the full response. A failure that ends the request part way is an `error` event without a `kind`, and no `done`. Agent Input shows each `error` event at the input and passes it to `onError`.

```text
event: result
data: {"kind":"decision","task":"triage","engine":"jev","model":"jev-1.13.0","latencyMs":212,"attempts":[],"fields":{…},"patch":{"triage.claimType":"autoCollision","triage.injuryInvolved":true}}

event: result
data: {"kind":"value","task":"triage","engine":"claude","model":"claude-opus-5-5","latencyMs":3840,"attempts":[],"fields":{…},"patch":{"lossDate":"2026-10-22","otherPartyName":"Mark Jensen"}}

event: done
data: {"requestId":"6f1c…","tasks":["triage"],"data":{…},"fields":{…},"errors":[],"excluded":[…],"engines":[…]}
```

For each `result` event, Agent Input:

1. sets each value in `patch` that it may write (see [Rules](#rules-agent-input-keeps));
2. annotates each field in `fields` that is not `missing` and that the user has not changed;
3. calls `onResult(event)`.

The event is:

```ts
type ResultEvent = {
    kind: 'decision' | 'value';
    task?: string;
    engine: string | null;
    model: string | null;
    latencyMs: number;
    attempts: { engine: string; error: string }[];     // engines passed over, and why
    fields: Record<string, FieldResult>;              // per path: value, status, confidence, alternatives, ...
    patch: Record<string, any>;                       // the values to write, by path
    toolCalls?: { name: string; isError: boolean }[];
    error?: string;                                   // every engine for this group failed
};
```

`fields` entries are the Agent API's field results (`status` of `confident`, `uncertain`, `suggested` or `missing`, `confidence`, up to three `alternatives`, `engine`, `model`); see [Agent API](/developers/agent-api). The `done` event's data is passed to `onDone`.

A new request aborts the one in flight. An aborted request calls neither `onError` nor `onDone`.

### Fields the decisions reveal

When decision results changed values and the `done` summary lists fields excluded as hidden by the form's conditionals, Agent Input asks once more, with the new data, so the fields on the pages that triage just turned on are filled too. That follow-up calls `onStart` and `onDone` with `followUp: true`, keeps the annotations already shown, and finishes before the first request's `done` promise resolves. It happens once per request.

## Rules Agent Input keeps

- **It never overwrites the user.** It writes a field only when the field is empty, or when its value is the one Agent Input wrote last and the user has not changed it since. A field the user changes is the user's for the rest of the session.
- **Nothing stale survives a new description.** When the input's value changes between requests, the values it wrote from the earlier input, and that the user has not changed, are emptied before the new request.
- **Uncertain means check.** Confident values show their confidence ("Filled from your description (92% sure)"). Uncertain values are prefilled and ask the user to check them ("Please check this."), with a button for each alternative, leaving out any under 5%; clicking one sets it and counts as the user's choice. Agent-engine values are marked as suggestions to check.
- **With `requireReview`, uncertain means checked before moving on.** The uncertain note also holds a "Yes, this looks right" checkbox. Until the user ticks it, changes the value or picks an alternative, the wizard's **Next** (for a field on that page) and **Submit** (for any field still shown) stop, mark the note "Please check this before you continue." (`uag-review-needed`), and focus its checkbox; Submit first turns to the page that holds it. formio.js gets the message for its alert as well. A checked value's note turns `uag-reviewed`. A new description starts the checks over.
- **The form keeps working.** If the request fails, the user sees a short message under the input ("Filling in from your description is unavailable right now (503).") and carries on by hand.
- **Annotations follow the wizard.** A field on a page that was not drawn when its result arrived is annotated when the page renders.

Values Agent Input writes are values the user submits. To make decisions that drive sensitive routing trustworthy, re-decide them on the server: the form's submissions already go to the UAG, so add an "Agent: Run task" action that runs before the save and answers the task's decision fields only, with those fields marked `uagAuthoritative` (see [Security](/developers/security#fields-the-server-owns)).

### Styles

| Class | On |
|---|---|
| `uag-chip uag-confident` | A confident value's note. |
| `uag-chip uag-uncertain` | An uncertain value's note, holding the alternatives. |
| `uag-alternative` | Each alternative's button. |
| `uag-review` | With `requireReview`: the "Yes, this looks right" checkbox's label. |
| `uag-chip uag-uncertain uag-review-needed` | With `requireReview`: an unchecked note after Next or Submit was stopped. |
| `uag-chip uag-uncertain uag-reviewed` | With `requireReview`: an uncertain value's note once the user ticked it or changed the value. |
| `uag-chip uag-suggested` | A suggested (agent-engine) value's note. |
| `uag-error` | The failure message, with `role="status"`. |

## Public forms

A visitor who is not signed in has no Form.io token. Two ways to give such a form Agent Input:

- **Anonymous use.** Set [`uagAnonymous: "true"`](/developers/form-properties#uaganonymous) on the form and let the Anonymous role create submissions. The UAG then answers visitors directly, rate-limited per address and in total (`AGENT_ANONYMOUS_RATE_LIMIT`, `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT`).
- **A relay of your own,** when you need more than that: a CAPTCHA, a spending budget, your own sessions. The browser calls your server, which calls the UAG with a key the browser never sees, and Agent Input is pointed at it with `formUrl`.

```sequence
participants: Browser, Your backend, UAG*
Browser -> Your backend: /api/agent/extract, with your session
note Your backend: your checks; the task fixed here
Your backend -> UAG: {form}/agent/extract with x-token (or the user's token)
UAG --> Your backend: the event stream
Your backend --> Browser: relayed unchanged
```

Why a key must stay on the server:

- The UAG refuses project and admin keys on any request carrying an `Origin` or `Sec-Fetch-Site` header, which every browser request has. A key in a page cannot work, and would be readable by anyone who opens it.
- A key runs as administrator: any form tagged `uag`, any task, and model calls billed to you. The relay decides which form and task the browser may use.
- Server-to-server requests from your backend carry no `Origin`, so the UAG accepts the key there. Do not forward the browser's `Origin`, cookies or other headers.

The relay below serves the page and the form definition, and relays extraction for one form and task, streaming the UAG's response back as it arrives. It is adapted from the [Agentic Formflow demo's back end](https://github.com/formio/uag/blob/main/demo/server/formflow.mjs).

```js
// server.mjs: node server.mjs
// UAG_URL=http://formio-uag:3200 FORMIO_URL=http://formio:3001 ADMIN_KEY=...
import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';

const { PORT = 8080, UAG_URL, FORMIO_URL, ADMIN_KEY } = process.env;
const FORM = 'claim';
const TASK = 'triage';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(import.meta.dirname, 'public')));
app.use('/uag-js', express.static(path.join(import.meta.dirname, 'node_modules/@formio/uag-js')));

// The form definition, read with the key on the server.
app.get('/api/form', async (req, res) => {
    const response = await fetch(`${FORMIO_URL}/${FORM}`, { headers: { 'x-admin-key': ADMIN_KEY } });
    res.status(response.status).json(await response.json());
});

// The form's extract operation, streamed back unchanged. Only this form and task, whatever the browser sends.
// In production, also require your own session here, and rate limit per user.
app.post('/api/agent/extract', async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());   // the browser went away: stop the run
    let response;
    try {
        response = await fetch(`${UAG_URL}/${FORM}/agent/extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': req.get('accept') || 'application/json',
                'x-admin-key': ADMIN_KEY,
            },
            body: JSON.stringify({ task: TASK, data: req.body?.data || {} }),
            signal: controller.signal,
        });
    }
    catch {
        if (!res.headersSent) res.status(502).json({ error: 'The UAG could not be reached.' });
        return;
    }
    res.status(response.status);
    res.set('Content-Type', response.headers.get('content-type') || 'application/json');
    res.set('Cache-Control', 'no-cache');
    res.set('X-Accel-Buffering', 'no');           // keep proxies such as nginx from buffering the stream
    const requestId = response.headers.get('x-request-id');
    if (requestId) res.set('X-Request-Id', requestId);
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
});

app.listen(PORT, () => console.log(`Claim intake at http://localhost:${PORT}`));
```

```bash
npm install express @formio/uag-js
```

`public/index.html`, served by the relay above. It renders the `claim` wizard, attaches Agent Input with the `next` trigger, pointed at the relay, and shows what the agent is doing in a status line.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Report a claim</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.css">
  <link rel="stylesheet" href="/uag-js/uag-js.css">
  <style>
    body { max-width: 760px; margin: 2rem auto; padding: 0 1rem; }
    #status { min-height: 1.5em; color: #555; }
  </style>
</head>
<body>
  <h1>Report a claim</h1>
  <p id="status" role="status" aria-live="polite"></p>
  <div id="claim"></div>

  <script src="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.js"></script>
  <script src="/uag-js/index.js"></script>
  <script>
    (async function () {
      const status = document.getElementById('status');
      const definition = await (await fetch('/api/form')).json();
      const form = await Formio.createForm(document.getElementById('claim'), definition, { noAlerts: true });

      const agent = FormioUAG.UAG.attach(form, {
        formUrl: '/api',            // the relay; it adds the key and fixes the form and task
        task: 'triage',
        trigger: 'next',
        onStart({ followUp }) {
          status.textContent = followUp ? 'Filling in the new steps…' : 'Reading your description…';
        },
        onResult(event) {
          const filled = Object.keys(event.patch || {}).length;
          if (event.error) {
            status.textContent = 'Some details could not be filled in. Please enter them yourself.';
          }
          else if (event.kind === 'decision') {
            status.textContent = `Sorted your claim in ${(event.latencyMs / 1000).toFixed(1)}s.`;
          }
          else {
            status.textContent = `Filled in ${filled} detail(s) for you to check.`;
          }
        },
        onError() {
          status.textContent = 'You can continue by hand.';
        },
        onDone(summary, { followUp }) {
          if (summary && !followUp) console.log('Agent API request', summary.requestId, summary.engines);
        },
      });

      form.on('submit', async (submission) => {
        // Save through the UAG (not shown), where an "Agent: Run task" action
        // re-decides triage on the server before relying on it.
        console.log('Submitting', submission.data);
      });

      // Detach when the page goes away, for example in a single-page app's route change.
      window.addEventListener('pagehide', () => agent.detach());
    })();
  </script>
</body>
</html>
```

## Next steps

- [Agent API](/developers/agent-api): a form's agent operations and the field results.
- [Form properties](/developers/form-properties): tasks, inputs, thresholds, confidence fields and `uagAnonymous`.
- [Security](/developers/security): re-deciding on the server, credentials and rate limits.
