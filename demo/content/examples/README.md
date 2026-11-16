# Feature examples

The Examples catalog on the demo site (`/examples`): one folder per UAG feature, named `<nn>-<slug>`, where `nn` is its place in the catalog. Each folder is rendered into `/examples/<slug>` by `demo/lib/examples.mjs` and `demo/scripts/build.mjs`.

| File | What it is |
|---|---|
| `example.md` | Front matter: `title`, `summary` (one sentence), `group` (`Fill in forms`, `Workflows` or `Chat widget`), `mode` (`form`, `workflow` or `chat`), `docs` (a relative link to the developer page that explains the feature), `highlight` (the properties to mark in the form shown, comma-separated). Then what the feature does. A `## Try these` list is the example's sample text, offered as buttons. |
| `form.json` | The form, as a reader writes it: `title`, `name`, `path` (`example-<slug>`), `type`, `display`, `tags` (with `uag`), `properties`, `components`. |
| `action.json` | An action the form needs, such as Agent: Run task. Required for a `workflow` example. |
| `page.js` | Page code beyond rendering the form, run with the rendered form as `form`; `UAG_PROJECT_URL` stands for the project's URL on the UAG. |

The page shows `form.json` and `page.js` exactly as the live example runs them. After changing a form or an action, run `yarn demo:examples:sync` to write it into the demo project's template (`demo/module/project.json`); a unit test fails until you do.

Write for any reader: neutral forms and sample text, no industry, company or customer story, and plain titles that say what the example shows.
