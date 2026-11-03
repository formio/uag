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

`Formio.use(UAG(url))` also registers the **AI Document** component (`uagdocument`), which turns uploaded files and a form designer's instructions into AI-generated content people review before they submit. It is a wrapper around a real file component (`files`, uploading to the form's own storage: S3, Azure, base64, URL) and a hidden `result`; the submission holds the file references and the result, never file bytes.

```js
Formio.use(UAG('https://uag.example.com', { documents: { auto: true } }));
await UAG.ready;   // only an application with its own form builder needs the manifest first
```

- After an upload, the component posts the file references to the UAG's process route (`{form}/document/process`) with the form's data and the user's tokens, shows the streamed progress, then the content (Markdown rendered with every text escaped; only `http`, `https` and `mailto` links), with a notice and the issues when the result is flagged. Changing the files cancels the running request; removing them clears the result. While processing, the form cannot be submitted.
- With a **target field** (`uag.target`, a textarea or text field of the same form, or of the same row in a Data Grid), the content is written there in that field's format: HTML for a rich-text editor, Markdown otherwise, after asking when the field has a value. The result is still stored.
- When the process allows it, people edit the content (`result.edited` is then true). Nothing re-checks edits, or any result, on save in this release: do not base decisions made without a person on `status`, `issues` or `meta`.
- Events on the form: `uagDocumentStart`, `uagDocumentProgress`, `uagDocumentResult`, `uagDocumentError`.
- `UAG.UAGDocument` is the component class; `renderMarkdown(markdown)` the renderer.

In the developer portal, set the project's custom JavaScript and CSS to the UAG's `/uag-js/portal.js` and `/uag-js/portal.css`: they register the component (in portal mode: the component only) with the installed plugins, and keep an existing script with `?chain=`. A page without a bundler loads `/uag-js/uag.use.js` from the UAG.

The component needs formio.js 5 (the developer portal loads `@formio/js` 5.2.2; the tests run 5.7.0).

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
