---
title: AI Document
description: The AI Document form component turns uploaded files and a form designer's instructions into AI-generated content people review before they submit. Set it up in the portal, use it in your application, and run it.
section: Build
order: 48
---

The **AI Document** component (`uagdocument`) lets the people filling a form drop files and get AI-generated content from them: an exact extraction, a summary, an assessment. The form designer picks a **process** (a document plugin) and writes the instructions; converters bring each file to what the AI engine reads (PDF or text). Files upload to the form's own storage; the submission holds the file references and the result, never file bytes from the UAG. The [lease review example](../../public/apps/documents) shows it at work.

AI Document is a [module](./modules.md#settings-routes-and-components): it comes with `@formio/uag-extras/modules/ai-document`, which brings the component, the process route and the `document` plugin type, and the plugins it runs come from the document extras of `@formio/uag-extras` or your own (see [Plugins](./plugins.md)). With Docker, the `formio/uag-documents` add-on brings all of them to the `formio/uag` image (see [Run it with Docker](#run-it-with-docker)). In your own server (`@formio/uag-extras` 1.x needs `@formio/uag` 2.0.0 or later and Node.js 24 or later), after `npm install @formio/uag-extras@^1`:

```js
import { UAGDocument } from '@formio/uag-extras/modules/ai-document';
import Extract from '@formio/uag-extras/documents/extract';
import Analyze from '@formio/uag-extras/documents/analyze';

server.use([UAGDocument, Extract, Analyze]);
```

## For the form builder, in the developer portal

1. Connect the project's stage to the UAG (the portal's remote environment URL is the UAG).
2. Set the project's custom JavaScript and CSS settings, once, by hand: JavaScript to `{uag}/uag-js/portal.js`, CSS to `{uag}/uag-js/portal.css`. If the project already has its own, keep it by adding it as `?chain=<url-encoded URL>`: `{uag}/uag-js/portal.js?chain=https%3A%2F%2Fcdn.example.com%2Fcustom.js`. A chained script loads only over `https:`. The portal asks once whether to load the project's custom JavaScript; the URLs never change between UAG releases, so it does not ask again after an upgrade.
3. In the builder, **AI Document** is in the palette next to **File**. Its settings:
   - **AI tab:** *Process* lists the installed document plugins, and shows the chosen plugin's settings. *Instructions*: write them, or pick a content component of the form. *Accepted files*: the file types the installed converters can bring to that process, all checked by default (this also restricts the file picker). *Target field* (optional): a textarea or text field that receives the result.
   - **File tab:** storage (S3, Azure, base64, URL), directory, multiple, size limits.
4. Inside a Data Grid, each row has its own result; with *multiple*, all files of the component give one combined result.

Instructions are part of the form definition: anyone who can load the form can read them. They are not secret.

## For the person filling the form

They drop one or more files, which formio.js uploads to the configured storage. The component sends the file references to the UAG, shows progress, then shows the content, with a notice and the issues when the result is flagged for review. With a target field, the content goes into that field instead (after asking, when it already has a value). They edit the content when the process allows it, or in the target field, and submit.

## For the application developer

```js
// npm install @formio/uag-js @formio/uag-extras@^1
import { Formio } from '@formio/js';
import { UAG } from '@formio/uag-js';
import aiDocument from '@formio/uag-extras/modules/ai-document/client';
Formio.use(UAG('https://uag.example.com'));
Formio.use(aiDocument);
```

Rendering a form that contains an AI Document needs nothing else. An application with its own form builder awaits the manifest first: `await UAG.ready`. A page without a bundler loads `https://uag.example.com/uag-js/uag.use.js`, which registers itself with that UAG and carries the component of every module the UAG uses; or it loads the module's script and style from a CDN, after `uag.use.js`: `https://cdn.jsdelivr.net/npm/@formio/uag-extras@1/dist/modules/ai-document.min.js` and `ai-document.css` beside it.

### The target field

With a target field, the result is also written into a textarea or text field of the same form (in a Data Grid, the field of the same row), in that field's format: HTML for a textarea with a rich-text editor (from the component's own renderer, which escapes all text), Markdown otherwise. The submission still holds the result as the process produced it, so it has both what the process returned and what the person submitted. Use it to keep an application's existing data model: an application that reads a rich-text field gets the content there, with no Markdown rendering.

### Nothing checks the result on save

In this release the UAG neither signs results nor checks AI Document values when a submission is saved. A submission is saved the way the application saves any other, and its `result` is whatever the client sent: anyone who can submit the form can submit any `content`, `status`, `issues` or `meta`. The person's review before submitting is the control. **An application that acts on a result without a person reviewing it must not rely on `status`, `issues` or `meta`.**

## The process route

`POST {project}/{formPath}/document/process`, body `{ path, files, data? }`: `path` is the component's data path with row indices (`rows[2].contract`), `files` the files component's value, `data` the form's data (context for the plugin only). The caller needs create or update access to the form, as for the Agent API, and Agentic Formflow must be licensed (otherwise `403`, as the Agent API answers). Its rate limits are counted under the name `document` (`agentApi.rateLimits.caller.document`). On a form open to anonymous visitors (`uagAnonymous`), a visitor who is not signed in may use it too, under the anonymous limits (see [Modules](./modules.md#anonymous-visitors)). See [Agent API](./agent-api.md#process-an-ai-document).

## For the operator

`formio/uag-documents` is an add-on that runs beside the `formio/uag` image; it does not contain the UAG. It holds a plugins folder: an `index.mjs` that loads the AI Document module (`module:ai-document`), the `extract`, `analyze` and `translate` document plugins and the `office-text` converter (Word and Excel files), and a `node_modules` with `@formio/uag-extras` and the converter's libraries. It copies that folder into its own volume and exits; the UAG mounts that volume in a folder under `/app/plugins` and loads it at startup with any other add-ons (see [Plugins: Add-ons](./plugins.md#add-ons)). The extras use the UAG's own `@formio/uag` and `zod`. It needs `formio/uag` 2.0.0 or later. Its tags follow `@formio/uag-extras`: `formio/uag-documents:1` (the newest 1.x), or an exact version such as `formio/uag-documents:1.0.0`.

### Run it with Docker

```yaml
services:
  uag-documents:
    image: formio/uag-documents:1
    volumes:
      - uag-documents:/out

  formio-uag:
    image: formio/uag
    depends_on:
      uag-documents:
        condition: service_completed_successfully
        restart: true
    volumes:
      - uag-documents:/app/plugins/documents:ro
    environment:
      # ...the UAG's usual settings

volumes:
  uag-documents:
```

- The add-on runs once at each `docker compose up`: it replaces what its volume holds with its folder and exits with `0`. Do not give it `restart: always`.
- `condition: service_completed_successfully` keeps the UAG from starting before the files are there; the volume is how they reach it.
- To upgrade, run `docker compose pull` and `docker compose up -d`. With `restart: true`, Compose stops the UAG, runs the newer add-on, then starts the UAG on its files.
- Without Compose: `docker volume create uag-documents`, then `docker run --rm -v uag-documents:/out formio/uag-documents:1`, then run `formio/uag` with `-v uag-documents:/app/plugins/documents:ro`.
- On Kubernetes, run the add-on as an initContainer that writes to an `emptyDir` volume mounted at `/out`, and mount that `emptyDir` at `/app/plugins/documents` (read-only) in the UAG's container.
- Other add-ons and your own plugins go in folders of their own beside it (see [Plugins: Add-ons](./plugins.md#add-ons)). A document plugin of your own uses the `document` type this add-on's module defines.
- `MODULES_DISABLED=ai-document` turns the module off, and `PLUGINS_DISABLED` (`document:translate`, say) one of its plugins.

### Limits

| Setting (`config.documents`) | Default | Environment |
|---|---|---|
| `maxFileBytes` | 25 MB | `DOCUMENTS_MAX_FILE_BYTES` |
| `maxFiles` | 10 | |
| `maxTotalBytes` | 32 MB (the provider request cap) | |
| `maxPages` | 500 | `DOCUMENTS_MAX_PAGES` |
| `maxTextChars` | 2,000,000 | |
| `timeoutMs` (one request) | 600000 | `DOCUMENTS_TIMEOUT_MS` |
| `heartbeatMs` | 15000 | |
| `perUser` (concurrent requests per caller) | 3 | |
| `engine` | the first agent engine that generates and reads what the files became | `DOCUMENTS_ENGINE` |
| `prefer` | `{}` (MIME type to converter name) | |

A limit that is exceeded fails the request, naming it; nothing is cut off silently. Keep `maxTotalBytes` and `maxPages` within your engine provider's limits (the UAG warns at startup when they are above them). Documents go to the provider of the engine that reads them: a component's engine, or `documents.engine`, chooses which. Only an agent engine that generates content can process documents; of the official engines, that is `claude`, in the UAG or on an engine server. With no such engine enabled, processing answers `503` (`no_engine`).

### Storage

Use S3 or Azure storage in production. Base64 storage keeps the bytes in the submission itself. Files in Google Drive or Dropbox cannot be read by the UAG.

### Proxies

Processing is one streaming request that lasts until the result is ready, at most `documents.timeoutMs`. A proxy in front of the UAG must allow responses that long and must not buffer `text/event-stream`. The UAG writes a comment line every `heartbeatMs` so an idle connection is not closed.

```nginx
location / {
    proxy_pass http://uag:3200;
    proxy_buffering off;
    proxy_read_timeout 660s;
}
```

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: uag
spec:
  rules:
    - backendRefs:
        - name: uag
          port: 3200
      timeouts:
        request: 660s
```

Closing the connection (the page closes, or the files change) cancels the work on the UAG. Nothing outlives the request, so several UAG instances need no shared state and no sticky sessions.

## Next steps

- [Plugins](./plugins.md): converters and document plugins, and writing your own.
- [Agent API](./agent-api.md#process-an-ai-document): the process route in full.
