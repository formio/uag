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
