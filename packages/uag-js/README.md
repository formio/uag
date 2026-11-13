# @formio/uag-js

The [Form.io UAG](https://github.com/formio/uag/blob/main/demo/content/developers/index.md) for formio.js applications. Register it once, and forms tagged `uag` save through the UAG (so their "Agent: Run task" actions run), and those whose task has an input get **Agent Input**, which fills the form from what the user describes without overwriting what they entered. Every other form, and every other request, goes to Form.io as before. Any `uag` form can also be rendered as a [chat](#chat).

```bash
npm install @formio/uag-js
```

It works with formio.js 5 (`@formio/js` 5.x) and has no dependencies.

```js
import { Formio } from '@formio/js';
import { UAG } from '@formio/uag-js';
import '@formio/uag-js/uag-js.css';

Formio.setProjectUrl('https://forms.example.com/myproject');
Formio.use(UAG('https://uag.example.com'));

Formio.createForm(document.getElementById('claim'), 'https://forms.example.com/myproject/claim');
```

Without a bundler, load the UAG's own `https://uag.example.com/uag-js/uag.use.js` (and `uag-js.css`) after formio.js: it registers itself with that UAG and its modules' components. See [Or load it from the UAG](https://github.com/formio/uag/blob/main/demo/content/developers/renderer.md#or-load-it-from-the-uag).

Requests to the UAG carry the user's Form.io token (`x-jwt-token`), as formio.js sends it to Form.io; no other token is needed. Routing in the browser is not a security boundary: protect the fields an agent owns on the server, with an agent role, form permissions and `uagAuthoritative`.

## AI Document

The **AI Document** component (`uagdocument`) is a UAG module from [`@formio/uag-extras`](https://www.npmjs.com/package/@formio/uag-extras) (`npm install @formio/uag-extras@^1`), not from this package. A UAG that uses the module adds the component to its `/uag-js/uag.use.js`; an application with a bundler registers it after this package:

```js
import aiDocument from '@formio/uag-extras/modules/ai-document/client';
Formio.use(UAG('https://uag.example.com'));
Formio.use(aiDocument);
```

See [AI Document](https://github.com/formio/uag/blob/main/demo/content/developers/ai-document.md).

## For components: `client`

Once the UAG is registered, `client` (also `Formio.uagClient`, `FormioUAG.client` and `UAG.client`) is the browser API that components of UAG modules build on, stable within a major version: the UAG's URL, the user's token and headers, a form's URL on the UAG, the installed plugins, `stream()` for module routes, and Markdown rendering.

```js
import { client } from '@formio/uag-js';
await client.ready;
const done = await client.stream(client.formUrl(form) + '/document/process', { path, files }, { onEvent: (name, data) => {} });
```

Every member, and how `stream()` resolves and rejects: [For module components: `client`](https://github.com/formio/uag/blob/main/demo/content/developers/renderer.md#for-module-components-client).

## Chat

Any form tagged `uag` can also be rendered as a chat, the way `Formio.createForm` renders it as a form. A person describes what they need; the chat asks for what is still missing and fills the form behind it, which validates and submits through the UAG once they confirm. Each turn is the form's `{form}/agent/chat` on the UAG, so there is no model code and no server of your own, and it needs no Agentic Formflow license (the UAG needs an agent engine).

```js
Formio.use(UAG('https://uag.example.com'));

const chat = await Formio.createChat(document.getElementById('help'), 'https://forms.example.com/myproject/service-request', {
  suggestions: ['My internet is down'],
  markdown: (text) => marked.parse(text)   // optional; the output is sanitized
});
chat.on('submitDone', (submission) => console.log('Saved', submission._id));
```

`createChat` is also exported (and `FormioUAG.createChat` with script tags). The chat renders through formio.js templates (`uagChat`, `uagChatMessage`, …) you can replace per framework or per chat, translates through `i18n`, and is themed with `--uag-chat-*` CSS properties in `uag-js.css`.

Documentation: [JavaScript (formio.js)](https://github.com/formio/uag/blob/main/demo/content/developers/renderer.md) · [Chat widget](https://github.com/formio/uag/blob/main/demo/content/developers/chat.md).
