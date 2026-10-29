# @formio/uag-js

The [Form.io UAG](https://ai.onform.io/developers) for formio.js applications. Register it once, and forms tagged `uag` save through the UAG (so their "Agent: Run task" actions run) and get **Agent Input**, which fills the form from what the user describes without overwriting what they entered. Every other form, and every other request, goes to Form.io as before.

```js
import { Formio } from '@formio/js';
import { UAG } from '@formio/uag-js';
import '@formio/uag-js/uag-js.css';

Formio.setProjectUrl('https://forms.example.com/myproject');
Formio.use(UAG('https://uag.example.com'));

Formio.createForm(document.getElementById('claim'), 'https://forms.example.com/myproject/claim');
```

Requests to the UAG carry the user's Form.io token (`x-jwt-token`), as formio.js sends it to Form.io; no other token is needed. Routing in the browser is not a security boundary: protect the fields an agent owns on the server, with an agent role, form permissions and `uagAuthoritative`.

Documentation: [JavaScript (formio.js)](https://ai.onform.io/developers/renderer).
