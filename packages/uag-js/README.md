# @formio/uag-js

The [Form.io UAG](https://ai.form.io/developers) for formio.js applications. Register it once, and forms tagged `uag` save through the UAG (so their "Agent: Run task" actions run), and those whose task has an input get **Agent Input**, which fills the form from what the user describes without overwriting what they entered. Every other form, and every other request, goes to Form.io as before. Any `uag` form can also be rendered as a [chat](#chat).

```js
import { Formio } from '@formio/js';
import { UAG } from '@formio/uag-js';
import '@formio/uag-js/uag-js.css';

Formio.setProjectUrl('https://forms.example.com/myproject');
Formio.use(UAG('https://uag.example.com'));

Formio.createForm(document.getElementById('claim'), 'https://forms.example.com/myproject/claim');
```

Requests to the UAG carry the user's Form.io token (`x-jwt-token`), as formio.js sends it to Form.io; no other token is needed. Routing in the browser is not a security boundary: protect the fields an agent owns on the server, with an agent role, form permissions and `uagAuthoritative`.

## AI Document

The **AI Document** component (`uagdocument`) is a UAG module: it comes with `@formio/uag-extras/modules/ai-document`, not with this package. A UAG that uses the module adds the component to `/uag-js/uag.use.js` and the portal script; an application with a bundler registers it after this package: `Formio.use(UAG(url)); Formio.use(aiDocument);`. It builds on `client`, below.

## For components: `client`

Once `Formio.use(UAG(url))` has run, `client` (also `FormioUAG.client` and `UAG.client`) is the API that components of UAG modules build on, stable within a major version:

| Member | What it gives |
|---|---|
| `url()`, `token(form?)`, `headers(form?)` | The UAG's URL, the user's Form.io token, and the headers that identify the user to the UAG. |
| `formUrl(definition)` | A form's URL on the UAG, from its definition or a rendered form. |
| `ready`, `loaded`, `plugins(type?)`, `plugin(type, name)` | The installed plugins (`document`, `converter`, `module`), embedded by the UAG's scripts or fetched with the user's token. |
| `stream(url, body, { onEvent, signal, form })` | POST JSON, accepting server-sent events: every event goes to `onEvent`; it resolves with the `done` event's data (or the JSON answer), and rejects with the UAG's message, `status` and `code`. |
| `renderMarkdown(text)`, `escapeHtml(text)` | Markdown as the UAG sanitizes it, rendered with every text escaped. |

```js
import { client } from '@formio/uag-js';
await client.ready;
const done = await client.stream(client.formUrl(form) + '/document/process', { path, files }, { onEvent: (name, data) => {} });
```

## Chat

Any form tagged `uag` can also be rendered as a chat, the way `Formio.createForm` renders it as a form. A person describes what they need; the chat asks for what is still missing and fills the form behind it, which validates and submits through the UAG once they confirm. Each turn is the form's `{form}/agent/chat` on the UAG, so there is no model code and no server of your own, and it needs no Agentic Formflow license (the UAG needs an agent engine).

```js
Formio.use(UAG('https://uag.example.com'));

const chat = await Formio.createChat(document.getElementById('help'), 'https://forms.example.com/myproject/servicerequest', {
  suggestions: ['My internet is down'],
  markdown: (text) => marked.parse(text)   // optional; the output is sanitized
});
chat.on('submitDone', (submission) => console.log('Saved', submission._id));
```

`createChat` is also exported (and `FormioUAG.createChat` with script tags). The chat renders through formio.js templates (`uagChat`, `uagChatMessage`, …) you can replace per framework or per chat, translates through `i18n`, and is themed with `--uag-chat-*` CSS properties in `uag-js.css`.

Documentation: [JavaScript (formio.js)](https://ai.form.io/developers/renderer) · [Chat widget](https://ai.form.io/developers/chat).
