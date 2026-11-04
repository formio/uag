---
title: AI Document
description: The AI Document form component turns uploaded files and a form designer's instructions into AI-generated content people review before they submit. Set it up in the portal, use it in your application, and run it.
section: Build
order: 48
---

The **AI Document** component (`uagdocument`) lets the people filling a form drop files and get AI-generated content from them: an exact extraction, a summary, an assessment. The form designer picks a **process** (a document plugin) and writes the instructions; converters bring each file to what the AI engine reads (PDF or text). Files upload to the form's own storage; the submission holds the file references and the result, never file bytes from the UAG.

AI Document is a [feature](/developers/features): it comes with `@formio/uag-extras/features/ai-document`, which brings the component, the process route and the `document` plugin type, and the plugins it runs come from the document extras of `@formio/uag-extras` or your own (see [Plugins](/developers/plugins)). The `formio/uag-documents` image has all of them. In your own server:

```js
import { compose } from '@formio/uag-extras';
import { UAGDocument } from '@formio/uag-extras/features/ai-document';
import Extract from '@formio/uag-extras/documents/extract';
import Analyze from '@formio/uag-extras/documents/analyze';

server.use(compose(UAGDocument, Extract, Analyze));
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
import { Formio } from '@formio/js';
import { UAG } from '@formio/uag-js';
import aiDocument from '@formio/uag-extras/features/ai-document/client';
Formio.use(UAG('https://uag.example.com'));
Formio.use(aiDocument);
```

Rendering a form that contains an AI Document needs nothing else. An application with its own form builder awaits the manifest first: `await UAG.ready`. A page without a bundler loads `https://uag.example.com/uag-js/uag.use.js`, which registers itself with that UAG and carries the component of every feature the UAG uses; or it loads the feature's script from a CDN (`dist/features/ai-document.min.js` of `@formio/uag-extras`), after `uag.use.js`.

### The target field

With a target field, the result is also written into a textarea or text field of the same form (in a Data Grid, the field of the same row), in that field's format: HTML for a textarea with a rich-text editor (from the component's own renderer, which escapes all text), Markdown otherwise. The submission still holds the result as the process produced it, so it has both what the process returned and what the person submitted. Use it to keep an application's existing data model: an application that reads a rich-text field gets the content there, with no Markdown rendering.

### Nothing checks the result on save

In this release the UAG neither signs results nor checks AI Document values when a submission is saved. A submission is saved the way the application saves any other, and its `result` is whatever the client sent: anyone who can submit the form can submit any `content`, `status`, `issues` or `meta`. The person's review before submitting is the control. **An application that acts on a result without a person reviewing it must not rely on `status`, `issues` or `meta`.**

## The process route

`POST {project}/{formPath}/document/process`, body `{ path, files, data? }`: `path` is the component's data path with row indices (`rows[2].contract`), `files` the files component's value, `data` the form's data (context for the plugin only). The caller needs create or update access to the form, as for the Agent API, and Agentic Formflow must be licensed (otherwise `403`, as the Agent API answers). See [Agent API](/developers/agent-api#process-an-ai-document).

## For the operator

```bash
docker run -p 3200:3200 --env-file .env formio/uag-documents
```

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

A limit that is exceeded fails the request, naming it; nothing is cut off silently. Keep `maxTotalBytes` and `maxPages` within your engine provider's limits (the UAG warns at startup when they are above them). Documents go to the provider of the engine that reads them: a component's engine, or `documents.engine`, chooses which.

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

- [Plugins](/developers/plugins): converters and document plugins, and writing your own.
- [Agent API](/developers/agent-api#process-an-ai-document): the process route in full.
