---
title: Plugins
description: Plugins are self-describing capabilities of a known type, such as converters that read file types and document processes for the AI Document. Write your own, and add them from a module or a plugins folder.
section: Extend
order: 25
---

A **module** customizes your UAG deployment: it is the one place you wire the server — your project template, form actions, MCP tools, hooks, interface overrides, and which plugins to load. A **plugin** is one capability of a known type — "convert Word documents to PDF", "extract a document's exact text" — that describes itself, so operators can enable it and form builders can select and configure it. Modules can bring plugins; plugins never change how the server itself works.

> **Plugins are trusted code.** A plugin runs in the UAG process, with the UAG's secrets: engine API keys, the project or admin key, the JWT secret. Adding a plugin, or mounting a plugins folder, is installing software. Only add plugins you trust.

## Adding plugins

From a module, list them in `plugins` (and any plugin types the module defines in `pluginTypes`). Modules add to one registry in the order they are used; their lists are never merged with each other.

```js
module.exports = {
    config: { /* ... */ },
    plugins: [require('./my-converter')]
};
```

From a plugins file: `UAG_PLUGINS` names an ES module (`.mjs`) or CommonJS file whose default export (or `plugins` export) is a plugin, a list of plugins, or nested lists. In the `formio/uag-documents` image, `/app/plugins/index.mjs` is loaded when it exists; `UAG_PLUGINS=off` loads none. Relative imports in the file resolve from the file, and bare imports from the folder's own `node_modules`, then upward.

```js
// /app/plugins/index.mjs: the official plugins, plus your own
import extract from '@formio/uag-extract';
import analyze from '@formio/uag-analyze';
import translate from '@formio/uag-translate';
import office from '@formio/uag-convert-office';
import myConverter from './my-converter.mjs';
export default [extract, analyze, translate, office, myConverter];
```

A plugin that needs system binaries or npm packages the image does not have is added by building an image `FROM formio/uag-documents`.

### Settings and switching plugins off

A plugin's operator settings resolve, first match wins, from `config.plugins.settings[type][name][key]`, then the first set environment variable the setting names, then its default. A required setting with no value stops startup, naming the plugin, the setting and its variables; secret values appear as `***` in every message.

`config.plugins.disabled` (or `PLUGINS_DISABLED`, comma-separated) lists plugins not to load, as `type:name`: `PLUGINS_DISABLED=converter:office-text`.

### Startup

Startup stops, naming the plugin and where it came from, for a plugin of an unknown type, an unsupported contract version, a type's validation problems, an `editForm` its type does not allow, or two plugins with the same `type:name`. A plugin that is valid but cannot run here (its `available()` returns `false` or a reason) is disabled with the reason logged: `[plugins] converter:ocr-text is disabled: tesseract was not found`.

## The plugin contract

Every plugin is a plain object, validated by its shape (no base class, so a plugin built against another copy of a package still registers):

| Field | Meaning |
|---|---|
| `type` | The plugin type, such as `converter`. |
| `name` | `/^[a-z][a-z0-9-]{0,62}$/`, unique within the type. |
| `title`, `description` | What people see. |
| `version` | The plugin's own version (semver). |
| `apiVersion` | The version of its type's contract it was built for. |
| `settings` | Operator settings: `{ key: { env, required, secret, default, type, description } }`. |
| `editForm` | Per-use settings form, when its type has one. |
| `available(context)` | `true`, or the reason it cannot run here. |
| `setup(context)`, `close()` | Start and stop. `context` holds the resolved `settings`, the `server` module and a `log` prefixed `[plugin type:name]`. |

`definePlugin(plugin)` (exported by `@formio/uag`) validates the base shape and returns the plugin, for authoring with types.

`GET {project}/plugins` (any authenticated caller of the project, `?type=` to filter) returns the installed plugins' public description: never functions or settings values.

### What experimental means

The `converter` and `document` types are **experimental** in 2.0: their contracts may change in a 2.x minor release, with the change in the changelog. The base contract above is stable. The UAG logs one notice at startup for each plugin of an experimental type it did not register itself, and `GET {project}/plugins` shows each plugin's `stability`. The example converter below is the reference: a change that breaks it is a contract change. Both types become stable after a minor release in which neither contract changed.

## Plugin types in this release

| Type | What a plugin of it does | Stability |
|---|---|---|
| `converter` | Turns an uploaded file into a PDF or text, which is what AI engines read. Chosen automatically by file type. | Experimental |
| `document` | Turns files and a form designer's instructions into content for the AI Document component. Chosen per component in the form builder. | Experimental |
| `engine`, `tool`, `action` | Listed only: engines, MCP tools and form actions keep loading as before, and appear in `GET {project}/plugins`. | Stable |

## Your first document plugin

A document plugin is one JavaScript file: a plain object with a few fields and an async `process()`. The UAG does the rest: it turns each upload into a PDF or text (through the converters), chooses the engine, streams progress to the form, sanitizes what you return and shows it in the component. This walkthrough builds **Translate**: the form designer picks a language, and the person filling the form gets their upload back in it.

The `formio/uag-documents` image ships this plugin as `@formio/uag-translate` (the same code, with more languages). Two plugins cannot share `document:translate`, so to run your own copy beside the image's, give yours another `name`, or leave the official one out of your plugins file.

### 1. Write the plugin

```js
// my-plugins/translate.mjs
const LANGUAGES = { es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese' };

export default {
    type: 'document',
    name: 'translate',
    title: 'Translate',
    description: 'Translates the uploaded documents into the language the form designer picks.',
    version: '1.0.0',
    apiVersion: 1,
    inputs: [['pdf'], ['text']],   // a PDF when the engine reads one, else the text
    editable: true,                // people may correct the translation
    output: 'markdown',

    // Shown on the component's AI tab once this plugin is picked.
    editForm: [{
        type: 'select', key: 'language', label: 'Translate into', input: true,
        dataSrc: 'values',
        data: { values: Object.entries(LANGUAGES).map(([value, label]) => ({ value, label })) },
        validate: { required: true }
    }],
    defaults: { language: 'es' },

    // Problems here stop processing with "The AI Document … is misconfigured: …".
    validateSettings(settings) {
        return LANGUAGES[settings.language] ? [] : ['pick a language to translate into'];
    },

    async process(ctx) {
        const language = LANGUAGES[ctx.settings.language];
        ctx.progress(0.1, `Translating into ${language}`);
        const answer = await ctx.agent.generate({
            system: `Translate the attached documents into ${language}. Keep their headings, lists and numbers. Translate only: add nothing.`,
            instructions: ctx.instructions,
            attachments: ctx.files.map((file, i) => file.document.pdf
                ? { kind: 'pdf', data: file.document.pdf, label: `Document ${i + 1}: ${file.name}` }
                : { kind: 'text', text: file.document.text ?? '', label: `Document ${i + 1}: ${file.name}` }),
            format: 'markdown'
        });
        if (answer.stopReason === 'max_tokens') {
            return { content: answer.text, status: 'flagged', issues: [{ kind: 'truncated', message: 'The translation was cut off.' }] };
        }
        return { content: answer.text, status: 'ok', issues: [] };
    }
};
```

Your code decides what to ask the engine and when a result is `ok` or `flagged`. Nothing else is needed: no base class, no build step, and no dependency (wrap it in `definePlugin` from `@formio/uag` if you want the shape checked as you write).

### 2. List it in a plugins file

```js
// my-plugins/index.mjs
import translate from './translate.mjs';
export default [translate];
```

### 3. Test it without a server

`process()` only uses what it is given, so a stand-in `ctx` with a fake `agent.generate` tests it with no UAG and no engine:

```js
// my-plugins/test/translate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import translate from '../translate.mjs';

test('asks the engine for the chosen language', async () => {
    const calls = [];
    const ctx = {
        settings: { language: 'fr' }, instructions: 'Translate the notice for the tenant.',
        files: [{ name: 'notice.txt', document: { text: 'Your rent changes on December 1.' } }],
        progress: () => {},
        agent: { generate: async (request) => { calls.push(request); return { text: '# Avis', stopReason: 'end_turn' }; } }
    };
    assert.equal((await translate.process(ctx)).status, 'ok');
    assert.match(calls[0].system, /French/);
});
```

```bash
node --test test/*.test.mjs
```

### 4. Load it into the UAG

Name the plugins file with `UAG_PLUGINS`:

```bash
UAG_PLUGINS=./my-plugins/index.mjs npx uag start
```

Or, with the image, mount the folder at `/app/plugins`. Your `index.mjs` replaces the image's default list, so list the official plugins you want too (they stay installed in the image, so the imports resolve):

```js
// my-plugins/index.mjs, mounted at /app/plugins
import extract from '@formio/uag-extract';
import analyze from '@formio/uag-analyze';
import office from '@formio/uag-convert-office';
import translate from './translate.mjs';
export default [extract, analyze, office, translate];
```

```bash
docker run -p 3200:3200 --env-file .env -v "$PWD/my-plugins:/app/plugins:ro" formio/uag-documents
```

At startup the UAG logs where it loaded the plugins from, and a notice that `document` plugins are experimental:

```
[formio-uag] Plugins loaded from /app/plugins/index.mjs.
[plugins] document:translate (from /app/plugins/index.mjs) uses the experimental "document" plugin type: …
```

A plugin of the wrong shape stops startup, naming it and the problem (see [Startup](#startup)). `GET {project}/plugins` lists it once it is installed.

### 5. Use it in the form builder

Reload the builder (in the developer portal, reload the page: the portal script carries the plugin list it was loaded with). Add an **AI Document**, open its **AI** tab and pick **Translate** under *Process*: its *Translate into* setting appears. Write the instructions (every AI Document needs them: "Translate the notice for the tenant"), choose a target field if the translation should land in one, and save.

The UAG reads its plugins once, at startup: restart it after you change one.

### When it does not work

| What you see | Why |
|---|---|
| Startup stops: `Plugin document:translate is registered twice` | Your plugin and `@formio/uag-translate` share a name: rename yours, or leave the official one out. |
| `The AI Document "…" is misconfigured: its process "translate" is not installed or not available.` | The UAG serving the form did not load your plugins file: check `UAG_PLUGINS` or the mount, and the startup log. |
| `The AI Document "…" is misconfigured: pick a language to translate into` | Your `validateSettings` refused the component's settings. |
| `The AI Document "…" is misconfigured: it has no instructions.` | The component's instructions are empty. |
| `"notice.docx" is application/vnd.openxmlformats-officedocument.wordprocessingml.document, which no installed converter brings to the "translate" process.` | No converter turns that file type into a PDF or text: add `@formio/uag-convert-office` for Word and Excel. |
| The result is **flagged** with your issue | Your `process()` returned `status: 'flagged'`: people see the issues and decide. |

## Writing a converter

A converter (`apiVersion: 1`) turns one file into a PDF or text:

```js
import { definePlugin } from '@formio/uag';

export default definePlugin({
    type: 'converter',
    name: 'sample-text',
    title: 'Sample text',
    version: '1.0.0',
    apiVersion: 1,
    accepts: [{ type: 'application/x-uag-sample', ext: ['.uagsample'] }],
    produces: ['text'],
    // For formats the UAG's own detection does not know: the type, from the first bytes.
    detect: (head) => head.subarray(0, 11).toString() === 'UAGSAMPLE1\n' ? 'application/x-uag-sample' : null,
    async convert(input, { to, signal, tmpdir, log }) {
        signal.throwIfAborted();
        return { text: input.buffer.subarray(11).toString('utf8'), textFormat: 'plain' };
    }
});
```

- `accepts` lists canonical MIME types and their extensions; `produces` is `pdf`, `text` or both.
- `convert` returns `{ pdf, pages?, warnings? }` or `{ text, textFormat: 'plain' | 'markdown' | 'csv', pages?: [{ page, text }], warnings? }`, and must give the same output for the same input and version.
- The UAG runs each call with a temporary directory of its own (removed after), under `limits.timeoutMs` (aborted through `signal`, so stop any process you started), `limits.concurrency` calls at once, and `limits.maxBytes` (defaults: 120000 ms, 2, 25 MB).
- `rank` (default 0) decides between converters that can do the same step: a component's pin, then `documents.prefer`, then the highest rank, then the name.

Files are identified from their bytes (the name and the browser's type are hints only), so a converter's `detect` is how a new format gets its type. The built-in converters are `pdf-text` (a PDF's text layer, per page), `text` (text, Markdown, CSV, JSON, HTML as Markdown, XML) and `image-pdf` (PNG and JPEG as a one-page PDF).

The example converter, `examples/uag-convert-sample/` in the `uag-plugins` repository, is the starting point: its own folder, an `index.mjs`, its own `node_modules`, and a contract test.

## Writing a document plugin

A document plugin (`apiVersion: 1`) turns the component's files and the form designer's instructions into content (the walkthrough above builds one step by step):

```js
export default {
    type: 'document',
    name: 'summary',
    title: 'Summary',
    version: '1.0.0',
    apiVersion: 1,
    inputs: [['pdf'], ['text']],          // representation sets, in order of preference
    editable: true,                       // may people edit the content?
    output: 'markdown',
    editForm: [{ type: 'number', key: 'maxWords', label: 'Most words', input: true }],
    defaults: {},
    async process(ctx) {
        const attachments = ctx.files.map((file, i) => file.document.pdf
            ? { kind: 'pdf', data: file.document.pdf, label: `Document ${i + 1}: ${file.name}` }
            : { kind: 'text', text: file.document.text, label: `Document ${i + 1}: ${file.name}` });
        const answer = await ctx.agent.generate({ instructions: ctx.instructions, attachments, format: 'markdown' });
        return { content: answer.text, status: answer.stopReason === 'max_tokens' ? 'flagged' : 'ok' };
    }
};
```

- `ctx.files` holds one entry per file: `name`, `type`, `size`, `sha256`, `document` (`pdf`, `pages`, `text`, `textFormat`, `textPages`), the `route` it took and `original()`. When a set has both `pdf` and `text`, the text is that same PDF's text.
- `ctx.instructions` is Markdown; `ctx.settings` this component's settings (`defaults` applied); `ctx.config` the operator settings; `ctx.data` the submission data sent (context only: untrusted).
- `ctx.agent.generate` calls the engine the component or the operator chose; call it again to retry with feedback. `ctx.progress(fraction, message)` reports progress; honour `ctx.signal`.
- Return `{ content, status: 'ok' | 'flagged', issues?, summary? }` (at most 50 issues of at most 300 characters each). Throw to fail: the message is shown to the person, so never put document text in it.
- `editForm` is JSON only; its keys are relative to the plugin's settings.

The UAG sanitizes Markdown content before returning it: raw HTML, unsafe links and images are removed.

## Next steps

- [AI Document](/developers/ai-document): the component, the process route, and running it.
- [Modules](/developers/modules): wiring a deployment.
