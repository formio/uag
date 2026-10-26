---
title: Renderer plugin
description: Fill in a formio.js form or wizard from the Agent API as the user types, without ever overwriting what the user entered.
section: Build
order: 40
---

The renderer plugin adds **Agent Input** to a form rendered with formio.js. The user describes something in their own words, in a field you flag as the task's input, and the plugin fills the rest of the form from [`/agent/extract`](/developers/agent-api): fast decisions first, so conditional pages react at once, then extracted values. Every value it writes is one the user can see, check and change, and it never writes over a value the user entered.

This page covers setting up a form, `UAGAgent.attach()` and every option, how results stream in, wizard handling, the rules the plugin keeps, and a complete page with the backend relay it needs. See it running in the [Agentic Formflow demo](/examples/formflow).

```sequence
participants: User, Renderer plugin, UAG*
User -> Renderer plugin: types into "What happened?", presses Next
Renderer plugin -> UAG: POST /agent/extract (streamed)
UAG --> Renderer plugin: decision result: claim type, injury
note Renderer plugin: conditional pages turn on
UAG --> Renderer plugin: value result: dates, names
note Renderer plugin: fills fields with "Suggested" marks
User -> Renderer plugin: checks, changes, submits
```

## Get the plugin

The plugin is `@formio/uag-renderer` 0.1.x, in the [`renderer`](https://github.com/formio/uag/blob/main/renderer) folder of the UAG repository. It is not published to npm: serve its two files with your page.

| File | What it is |
|---|---|
| `index.js` | The plugin. A UMD script: the browser global `UAGAgent`, or `module.exports` under CommonJS. No dependencies. |
| `uag-renderer.css` | Default styles for the chips and messages it adds. Override them freely. |

It works with formio.js 5 (`@formio/js` 5.x), loaded before it.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.css">
<link rel="stylesheet" href="/renderer/uag-renderer.css">
<script src="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.js"></script>
<script src="/renderer/index.js"></script>
```

## Set up the form

The form is a UAG form with a task (see [Form properties](/developers/form-properties)). The plugin needs one more thing: the task's **input**, the field (or container) whose text is read. Give it the custom properties:

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

When the trigger fires, the plugin sends the form's current data, and the UAG reads the input from it.

> **Tip:** If decision fields can be hidden by conditionals, set `clearOnHide: false` on the fields themselves, so hiding a page does not wipe the values that decided it.

## UAGAgent.attach(form, options)

```ts
UAGAgent.attach(form: Webform | Wizard, options: UAGAgentOptions): {
    extract(): { decided: Promise<void>; done: Promise<void> };
    state: ExtractionState;
    detach(): void;
};
```

Call it once the form is rendered:

```js
const form = await Formio.createForm(document.getElementById('claim'), definition);
const agent = UAGAgent.attach(form, {
    baseUrl: 'https://uag.example.com',
    formName: 'claim',
    task: 'triage',
    getToken: () => currentUserUagToken,
    trigger: 'next',
});
```

### Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `baseUrl` | `string` | required | The UAG, or your relay. The plugin posts to `<baseUrl>/agent/extract`. |
| `formName` | `string` | the form's `name`, else its `path` | The form's name on the UAG. |
| `task` | `string` | every task with an input | The task to extract for (its `uag` value). Also selects which inputs the triggers watch. |
| `persona` | `string` | | The earlier name of `task`. It still works, with a one-time console warning; giving both with different values throws. |
| `getToken` | `() => string \| Promise<string>` | none | The signed-in user's UAG bearer token, sent as `Authorization: Bearer`. Called for every request. Leave it out when a relay authenticates the request. |
| `trigger` | `'blur' \| 'pause' \| 'next' \| 'button'` | `'blur'` | When to extract. See [Triggers](#triggers). |
| `pauseMs` | `number` | `800` | With `pause`: the pause in typing that triggers a request. |
| `nextTimeoutMs` | `number` | `1500` | With `next`: the longest the wizard waits for decisions before moving on. |
| `fetch` | `typeof fetch` | the global `fetch` | The `fetch` to use, for example one that adds headers. |
| `onStart` | `({ followUp }) => void` | | A request to `/agent/extract` is starting. `followUp` is `true` for the request that fills fields the decisions revealed. |
| `onResult` | `(event) => void` | | One engine group's results have been applied. |
| `onError` | `(error) => void` | | A request failed. |
| `onDone` | `(summary, { followUp }) => void` | | A request finished. `summary` is the API's final response, or `null` when it failed. Not called for a request replaced by a newer one. |

The user needs create or update permission on the form. Never give a browser a project key or admin key: the UAG refuses them on any request with an `Origin` header, and anyone who reads the page would have them. Use a user token, or a relay (see [The backend relay](#the-backend-relay)).

### The controller

`attach()` returns:

| Member | Meaning |
|---|---|
| `extract()` | Call `/agent/extract` now. Returns `{ decided, done }`: `decided` resolves once the first decision results are applied (or the request ends without any), `done` once the whole request, and any follow-up, has finished. Failures go to `onError`; both promises still resolve. |
| `state` | The plugin's record of which values it wrote and which the user changed (an `ExtractionState`). `state.source(path)` is `'user'`, `'agent'` or `'none'`. |
| `detach()` | Remove the listeners and annotations, restore the wizard's `beforeNext` hook, and abort a request in flight. |

## Triggers

| Trigger | Fires | Use for |
|---|---|---|
| `blur` | When the user leaves one of the task's inputs (or a field inside an input container). | Single-page forms. |
| `pause` | After `pauseMs` without typing in an input. | Filling as the user types. |
| `next` | On wizard **Next**, from the page that holds the input. The wizard waits for decisions, up to `nextTimeoutMs`, so the pages they turn on are in place before it moves. | Wizards whose pages depend on triage. |
| `button` | Never: no listener is attached. Call `agent.extract()` yourself. | Your own "Fill in from description" button. |

With `next`, the plugin installs formio.js's `beforeNext` hook. An existing `beforeNext` hook runs first; if it reports an error, the wizard stops there. On any page other than the input's, Next proceeds without a request. After the wait, the plugin re-runs the form's conditionals (`checkData`) and recomputes the wizard's pages (`establishPages`), because formio.js debounces change handling and would otherwise pick the next page before the new values counted.

## How results arrive

Each request is:

```http
POST /agent/extract HTTP/1.1
Host: uag.example.com
Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <user token>

{ "form": "claim", "task": "triage", "data": { "lossDescription": "Yesterday a pickup rear-ended my Civic…" } }
```

The UAG answers with Server-Sent Events: one `result` event per engine group as soon as it finishes (decisions first, since decision engines answer in milliseconds), an `error` event for a group whose engines all failed, then a `done` event with the full response.

```text
event: result
data: {"kind":"decision","task":"triage","engine":"jev","model":"jev-1.13.0","latencyMs":212,"attempts":[],"fields":{…},"patch":{"triage.claimType":"autoCollision","triage.injuryInvolved":true}}

event: result
data: {"kind":"value","task":"triage","engine":"claude","model":"claude-opus-5-5","latencyMs":3840,"attempts":[],"fields":{…},"patch":{"lossDate":"2026-10-22","otherPartyName":"Mark Jensen"}}

event: done
data: {"requestId":"6f1c…","tasks":["triage"],"data":{…},"fields":{…},"errors":[],"excluded":[…],"engines":[…]}
```

For each `result` event, the plugin:

1. sets each value in `patch` that it may write (see [Rules](#rules-the-plugin-keeps));
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

When decision results changed values and the `done` summary lists fields excluded as hidden by the form's conditionals, the plugin asks once more, with the new data, so the fields on the pages that triage just turned on are filled too. That follow-up calls `onStart` and `onDone` with `followUp: true`, keeps the annotations already shown, and finishes before the first request's `done` promise resolves. It happens once per request.

## Rules the plugin keeps

- **It never overwrites the user.** It writes a field only when the field is empty, or when its value is the one the plugin wrote last and the user has not changed it since. A field the user changes is the user's for the rest of the session.
- **Nothing stale survives a new description.** When the input's value changes between requests, the values the plugin wrote from the earlier input, and that the user has not changed, are emptied before the new request.
- **Uncertain means check.** Confident values show their confidence ("Filled from your description (92% sure)"). Uncertain values are prefilled and ask the user to check them ("Please check this."), with a button for each alternative, leaving out any under 5%; clicking one sets it and counts as the user's choice. Agent-engine values are marked as suggestions to check.
- **The form keeps working.** If the request fails, the user sees a short message under the input ("Filling in from your description is unavailable right now (503).") and carries on by hand.
- **Annotations follow the wizard.** A field on a page that was not drawn when its result arrived is annotated when the page renders.

Values the plugin writes are values the user submits. To make decisions that drive sensitive routing trustworthy, re-decide them on the server before the save, with the `agentDecide` action or `/agent/provide` (see [Security](/developers/security)).

### Styles

| Class | On |
|---|---|
| `uag-chip uag-confident` | A confident value's note. |
| `uag-chip uag-uncertain` | An uncertain value's note, holding the alternatives. |
| `uag-alternative` | Each alternative's button. |
| `uag-chip uag-suggested` | A suggested (agent-engine) value's note. |
| `uag-error` | The failure message, with `role="status"`. |

## The backend relay

A browser can call the UAG directly with the signed-in user's UAG token (`getToken`), and extraction then runs with that user's Form.io permissions. That is the production pattern.

How a web application gets a UAG token for its signed-in user is in [UAG tokens](/developers/security#uag-tokens) and the Agent API's [credentials](/developers/agent-api#credentials).

When the page has no UAG token, for example a public intake form, put a relay in your own backend. The browser calls your server; your server calls the UAG with a key the browser never sees.

```sequence
participants: Browser, Your backend, UAG*
Browser -> Your backend: /api/agent/extract, with your session
note Your backend: your rate limit; form and task fixed here
Your backend -> UAG: /agent/extract with x-admin-key (or the user's token)
UAG --> Your backend: the event stream
Your backend --> Browser: relayed unchanged
```

Why the key must stay on the server:

- The UAG refuses project and admin keys on any request carrying an `Origin` or `Sec-Fetch-Site` header, which every browser request has. A key in a page cannot work, and would be readable by anyone who opens it.
- An admin key runs as administrator: on the Agent API that means any form tagged `uag`, any task, and model calls billed to you. The relay decides which form and task the browser may use.
- Server-to-server requests from your backend carry no `Origin`, so the UAG accepts the key there. Do not forward the browser's `Origin`, cookies or other headers.

The relay below serves the page, the plugin and the form definition, and relays extraction. It fixes the form and task on the server and streams the UAG's response back as it arrives. It is adapted from the [Agentic Formflow demo's back end](https://github.com/formio/uag/blob/main/demo/server/formflow.mjs).

```js
// server.mjs: node server.mjs
// UAG_URL=http://formio-uag:3200 FORMIO_URL=http://formio:3001 ADMIN_KEY=... RENDERER_DIR=./renderer
import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';

const { PORT = 8080, UAG_URL, FORMIO_URL, ADMIN_KEY, RENDERER_DIR = './renderer' } = process.env;
const FORM = 'claim';
const TASK = 'triage';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(import.meta.dirname, 'public')));
app.use('/renderer', express.static(RENDERER_DIR));

// The form definition, read with the key on the server.
app.get('/api/form', async (req, res) => {
    const response = await fetch(`${FORMIO_URL}/${FORM}`, { headers: { 'x-admin-key': ADMIN_KEY } });
    res.status(response.status).json(await response.json());
});

// The Agent API, streamed back unchanged. Only this form and task, whatever the browser sends.
// In production, also require your own session here, and rate limit per user.
app.post('/api/agent/extract', async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());   // the browser went away: stop the run
    let response;
    try {
        response = await fetch(`${UAG_URL}/agent/extract`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': req.get('accept') || 'application/json',
                'x-admin-key': ADMIN_KEY,
            },
            body: JSON.stringify({ form: FORM, task: TASK, data: req.body?.data || {} }),
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
npm install express
```

## A complete page

`public/index.html`, served by the relay above. It renders the `claim` wizard, attaches the plugin with the `next` trigger, and shows what the agent is doing in a status line.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Report a claim</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.css">
  <link rel="stylesheet" href="/renderer/uag-renderer.css">
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
  <script src="/renderer/index.js"></script>
  <script>
    (async function () {
      const status = document.getElementById('status');
      const definition = await (await fetch('/api/form')).json();
      const form = await Formio.createForm(document.getElementById('claim'), definition, { noAlerts: true });

      const agent = UAGAgent.attach(form, {
        baseUrl: '/api',            // the relay; it adds the key and fixes the form and task
        formName: 'claim',
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
        // Save through your backend (not shown). Re-decide triage on the server
        // with the agentDecide action or /agent/provide before relying on it.
        console.log('Submitting', submission.data);
      });

      // Detach when the page goes away, for example in a single-page app's route change.
      window.addEventListener('pagehide', () => agent.detach());
    })();
  </script>
</body>
</html>
```

With the plugin calling the UAG directly instead, replace `baseUrl: '/api'` with the UAG's address and add `getToken`. The UAG's CORS setting (`CORS`) must then allow the page's origin; the UAG exposes `X-Request-Id` to browsers.

## Next steps

- [Agent API](/developers/agent-api): `/agent/extract` and the field results.
- [Form properties](/developers/form-properties): tasks, inputs, thresholds and confidence fields.
- [Security](/developers/security): re-deciding on the server, credentials and rate limits.
