# @formio/uag-renderer

**Agent Input** for Form.io forms and wizards. Flag a field (or container) as a task's input with the custom properties `uag: "<task>"` and `uagField: "input"`, and as the user fills it in, the rest of the form is filled from the [UAG Agent API](../README.md#agent-api): fast decisions first, so conditional pages react immediately, then extracted values.

```html
<script src="https://cdn.jsdelivr.net/npm/@formio/js@5.6.1/dist/formio.full.min.js"></script>
<script src="uag-renderer/index.js"></script>
<link rel="stylesheet" href="uag-renderer/uag-renderer.css">
<script>
  Formio.createForm(el, formJson).then((form) => {
    UAGAgent.attach(form, {
      baseUrl: 'https://uag.example.com',
      formName: 'claim',
      task: 'triage',
      getToken: () => currentUserUagToken,
      trigger: 'next'
    });
  });
</script>
```

| Option | Meaning |
|---|---|
| `baseUrl` | The UAG's address. |
| `formName` | The form's name (defaults to the rendered form's). |
| `task` | The task to extract for (its `uag` value). Defaults to every task with an input. `persona` is the option's earlier name and still works; giving both with different values throws. |
| `getToken` | Returns the signed-in user's UAG bearer token (or a promise of it). The user needs create or update permission on the form. Never give a browser a project or admin key; the UAG refuses them from browsers. |
| `trigger` | `blur` (leaving an input; the default), `pause` (a pause in typing), `next` (wizard Next, waiting for decisions before moving on), or `button`, which attaches no listener: call `extract()` yourself, for example from your own button. |
| `pauseMs` | Pause in typing that triggers `pause`. Default `800`. |
| `nextTimeoutMs` | Longest wait for decisions on wizard Next. Default `1500`. |
| `fetch` | The `fetch` implementation to use. Defaults to the global `fetch`. |
| `onStart` | Called when a request to `/agent/extract` begins, with `{ followUp }` (`true` for the request that fills fields the decisions showed), for example to show that the description is being read. |
| `onResult`, `onError` | Callbacks for each engine's results and for failures. |
| `onDone` | Called when a request finishes, with the API's final `done` summary (merged `data`, `fields`, `excluded`, `engines`), or `null` when it failed, and `{ followUp }`. Not called for a request replaced by a newer one. |

Rules the plugin keeps:

- It fills a field only when it is empty, or when its value is one the plugin wrote and the user has not changed since. It never overwrites what the user entered.
- When the input changes, the values it filled from the earlier input (and the user has not changed) are emptied first, so nothing stale is left from the old description.
- When its decisions show fields the form was hiding (a page that triage turns on), it asks once more so those fields are filled too. That follow-up keeps the annotations already shown and finishes before `done` resolves.
- Confident values show their confidence; uncertain ones are prefilled and ask the user to check them, with one-click alternatives (any under 5% are left out); LLM values are marked as suggestions to check.
- If the API fails, the user sees a short message and the form keeps working by hand.

`attach()` returns `{ extract, state, detach }`. `extract()` calls `/agent/extract` now and returns `{ decided, done }`: promises that resolve once the first decision results are applied (or the request ends without any), and once the whole request has finished. Request failures go to `onError`; the promises still resolve.
