---
title: Plugins
description: Plugins are self-describing capabilities of a known type, such as converters that read file types. Add them from a module or a plugins file.
section: Extend
order: 25
---

A **module** customizes your UAG deployment: it is the one place you wire the server — your project template, form actions, MCP tools, hooks, interface overrides, and which plugins to load. A **plugin** is one capability of a known type — "convert Word documents to PDF", "extract a document's exact text" — that describes itself, so operators can enable it and form builders can select and configure it. Modules can bring plugins; plugins never change how the server itself works.

> **Plugins are trusted code.** A plugin runs in the UAG process, with the UAG's secrets: engine API keys, the project or admin key, the JWT secret. Adding a plugin, or mounting a plugins folder, is installing software. Only add plugins you trust.

## Adding plugins

From a module, list them in `plugins`:

```js
module.exports = {
    config: { /* ... */ },
    plugins: [require('./my-converter')]
};
```

From a plugins file: `UAG_PLUGINS` names an ES module (`.mjs`) or CommonJS file whose default export (or `plugins` export) is a plugin or a list of plugins. In the `formio/uag-documents` image, `/app/plugins/index.mjs` is loaded when it exists; `UAG_PLUGINS=off` loads none. Relative imports in the file resolve from the file, and bare imports from the folder's own `node_modules`.

```js
// /app/plugins/index.mjs
import myConverter from './my-converter.mjs';
export default [myConverter];
```

## Plugin types in this release

| Type | What a plugin of it does | Stability |
|---|---|---|
| `converter` | Turns an uploaded file into a PDF or text, which is what AI engines read. Chosen automatically by file type. | Experimental |
| `document` | Turns files and a form designer's instructions into content for the AI Document component. | Experimental |
| `engine`, `tool`, `action` | Listed only: engines, MCP tools and form actions keep loading as before, and appear in `GET {project}/plugins`. | Stable |

`GET {project}/plugins` (any authenticated caller of the project) returns the installed plugins' public description: never functions or settings.
