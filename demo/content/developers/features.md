---
title: Features
description: A feature is a whole capability in one module: a formio.js component, the plugin types and form routes behind it, and its settings. Use one with server.use(); write your own against the feature API.
section: Extend
order: 27
---

A **feature** brings a whole capability to the UAG in one module: a formio.js component for the form builder and the forms, the server behavior behind it (form routes, plugin types, hooks) and its settings. **AI Document** is a feature. A feature is still a [module](/developers/modules): what makes it a feature is its `uag` key, which the UAG reads to set it up, protect its routes and serve its component.

```js
import { UAGDocument } from '@formio/uag-extras/features/ai-document';
server.use(UAGDocument);
```

Several features and extras are used together as a list, `server.use([UAGDocument, Extract])`, in a plugins file or a module file too; one given twice is used once. Once used, a feature's component is in `/uag-js/uag.use.js` and the portal script, its routes answer on every form, and `GET {project}/plugins` lists it as `feature:<name>`.

## The `uag` key

```js
module.exports = {
    pluginTypes: [ /* plugin types the feature defines, as any module may */ ],
    uag: {
        name: 'address-check',                    // lowercase and "-"; a feature used twice is set up once
        title: 'Address check',
        version: '1.0.0',
        apiVersion: 1,                            // the feature API it is written against
        settings(config, env) {                   // what the feature reads as api.settings; throw to stop startup
            const maxPerMinute = Number(config.addressCheck?.maxPerMinute ?? env.ADDRESS_CHECK_MAX_PER_MINUTE ?? 10);
            if (!(maxPerMinute > 0)) throw new Error('maxPerMinute: must be above 0');
            return { maxPerMinute };
        },
        routes: {
            form: {
                'POST /address/check': { name: 'address', handler: (req, res, api) => { /* ... */ return { ok: true }; } }
            }
        },
        components: [{ type: 'uagaddress', script: require.resolve('./dist/client.min.js'), style: require.resolve('./dist/client.css') }],
        initialize: (api) => api.log.info(`at most ${api.settings.maxPerMinute} checks a minute`)
    }
};
```

| Key | What the UAG does with it |
|---|---|
| `apiVersion` | Startup stops when this UAG does not provide that version of the feature API. |
| `settings` | Called once at startup with the server's configuration and the environment; what it returns is `api.settings`. An error it throws stops startup, naming the feature. |
| `routes.form` | Each `"<METHOD> <path>"` answers on every form, by path and by id: behind the caller authentication of agent operations, the JSON body limit, a request id, the rate limits of its `name` (`agentApi.rateLimits.caller[name]`), the caller's access to the form (`access`, below) and the error shape `{ requestId, status, error, code }`. Paths are compared without case or a trailing slash: two features claiming one route stop startup, and so does a path the form's own routes use (`/`, `/submission`, `/exists`, `/agent`, `/action`, `/actions`). |
| `components` | Each script is served at `/uag-js/components/<type>.js` and added to `uag.use.js` and `portal.js`; each style to `uag-js.css` and `portal.css`. Two features with one component type stop startup. |
| `initialize` | Called once at startup, after the project and the engines are loaded, before any request. An error it throws stops startup. |

### Routes

A route's `access` is the form methods a caller needs, one of which is enough: by default `['create', 'update']`, what filling in the form takes. Give other methods (`['read']`), or `false` for a route that checks access itself; the check runs before the handler, with the same `401` and `403` answers as the Agent API.

A plain route's handler answers, or returns the JSON to answer with. Throw `api.errors.create(status, message, code)` to refuse: the caller gets that status and code. Any other error is answered with 500 and no detail. `req.signal` aborts when the client goes away: pass it to `api.files.read` and to the engine.

To stream progress, a route checks the request, then returns `api.stream(req, res, run)`: the run gets `{ signal, progress }` (`signal` aborts when the client goes away), and the UAG answers `{ result }` as JSON, or, to a client that accepts `text/event-stream`, streams `progress` events and then `done` or `failed`. Anything thrown before is answered with its status.

```js
'POST /document/process': {
    name: 'document',
    async handler(req, res, api) {
        // The caller's create or update access to the form was checked before this runs.
        await api.requireLicense();
        const prepared = await prepare(req, api);            // refuse with api.errors.create(...)
        return api.stream(req, res, ({ signal, progress }) => prepared.run(signal, progress), { heartbeatMs: 15000 });
    }
}
```

## The feature API

Every feature gets an `api` of its own; version 1 has:

| Member | What it does |
|---|---|
| `settings`, `log` | The resolved settings, and a log whose messages name the feature. |
| `plugins.get/list/settings` | The plugin registry: plugins by type and name, and their operator settings. |
| `requireAccess(auth, form, methods)` | Throws 401 or 403, as the Agent API does, unless the caller may use the form with one of `methods`. Routes get this check from `access`; use it for anything else. |
| `requireLicense()` | Throws 403 `license_required` unless Agentic Formflow is allowed. |
| `files.read(form, value, auth, { maxBytes, component, signal })` | A stored file value's bytes, read with the caller's credentials and the file component's storage check (a value pointing elsewhere is refused before any fetch). |
| `converters.identify/route/accept/run/list` | File types from their bytes, the converter route to the representations a plugin reads, and running it. |
| `engines.select({ name, needs })` | An engine that generates and reads what is needed, as `{ name, model, accepts, generate(request) }`: its `generate` checks the license first. Throws 503 `no_engine` when no enabled engine fits. Features never get the engine itself. |
| `stream(req, res, run, { heartbeatMs })` | Answers with what `run` returns, as JSON or as server-sent progress events. |
| `callerKey(req)` | A key per caller, for limits: the user, the token or the key, and for anonymous callers their address. |
| `markdown.sanitize/fromHtml`, `pdf.pageCount`, `forms.componentAt/componentByKey`, `errors.create/is` | Helpers. |

Features never get the project object or an engine's credentials: what they may do goes through this API, which keeps the UAG's checks (access, license, file storage, rate limits) in one place. The API is not a sandbox, though: a feature is a module, and runs in the UAG process with everything the process can reach. Use only features you trust.

## Components

A feature's component is a script that registers a formio.js component once `Formio` is on the page. The UAG wraps each in its own `try`, so one that fails to load is logged and the others still register. It builds on `Formio.uagClient`, the public browser API of `@formio/uag-js` (set when the UAG is registered): the UAG's URL, the user's token, the installed plugins, `stream()` for routes, and Markdown rendering. It never bundles formio.js: it uses the one the page registered.

Components reach browsers three ways, always matching the installed feature: the UAG adds them to `uag.use.js` and the portal script; an application with a bundler imports the feature's client (`@formio/uag-extras/features/<name>/client`) and calls `Formio.use()` with it; a page without one loads the feature's script from a CDN, such as jsDelivr, after `uag.use.js`.

## Writing one

Features live in [`@formio/uag-extras`](https://www.npmjs.com/package/@formio/uag-extras): `npm run new -- features <name>` starts one from the sample, with a route, a component and tests, and its contribution guide covers the review a feature gets. Features are trusted code: they run in the UAG process, and their components run in your users' browsers.
