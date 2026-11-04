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

Once used, a feature's component is in `/uag-js/uag.use.js` and the portal script, its routes answer on every form, and `GET {project}/plugins` lists it as `feature:<name>`.

## The `uag` key

```js
module.exports = {
    pluginTypes: [ /* plugin types the feature defines, as any module may */ ],
    uag: {
        name: 'address-check',                    // lowercase and "-"; a feature used twice is set up once
        title: 'Address check',
        version: '1.0.0',
        apiVersion: 1,                            // the feature API it is written against
        settings: {
            key: 'addressCheck',                  // read from config.addressCheck
            defaults: { maxPerMinute: 10 },
            env: { maxPerMinute: 'ADDRESS_CHECK_MAX_PER_MINUTE' },
            validate: (settings) => settings.maxPerMinute > 0 ? [] : ['maxPerMinute: must be above 0']
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
| `settings` | Each setting comes from `config[key]`, then its environment variable (as the default's type), then its default; `validate`'s problems stop startup, naming the feature and the setting. The feature reads them as `api.settings`. |
| `routes.form` | Each `"<METHOD> <path>"` answers on every form, by path and by id: behind the caller authentication of agent operations, the JSON body limit, a request id, the rate limits of its `name` (`agentApi.rateLimits.caller[name]`) and the error shape `{ requestId, error, code }`. Two features claiming one route stop startup. |
| `components` | Each script is served at `/uag-js/components/<type>.js` and added to `uag.use.js` and `portal.js`; each style to `uag-js.css` and `portal.css`. Two features with one component type stop startup. |
| `initialize` | Called once at startup, with the resolved settings, before any request. |

### Routes

A plain route's handler answers, or returns the JSON to answer with. Throw `api.errors.create(status, message, code)` to refuse: the caller gets that status and code. Any other error is answered with 500 and no detail.

A streamed route (`stream: true`) checks the request first and returns its run: anything thrown before is answered with its status; the run then gets `{ signal, progress }`, and the UAG answers `{ result }` as JSON, or, to a client that accepts `text/event-stream`, streams `progress` events and then `done` or `failed`.

```js
'POST /document/process': {
    name: 'document', stream: true, heartbeatMs: (settings) => settings.heartbeatMs,
    async handler(req, res, api) {
        api.requireAccess(req.auth, req.form, ['create', 'update']);
        await api.requireLicense();
        const prepared = await prepare(req, api);            // refuse with api.errors.create(...)
        return ({ signal, progress }) => prepared.run(signal, progress);
    }
}
```

## The feature API

Every feature gets an `api` of its own; version 1 has:

| Member | What it does |
|---|---|
| `settings`, `log` | The resolved settings, and a log whose messages name the feature. |
| `plugins.get/list/settings` | The plugin registry: plugins by type and name, and their operator settings. |
| `requireAccess(auth, form, methods)` | Throws 401 or 403, as the Agent API does, unless the caller may use the form with one of `methods`. |
| `requireLicense()` | Throws 403 `license_required` unless Agentic Formflow is allowed. |
| `files.read(form, value, auth, { maxBytes, component })` | A stored file value's bytes, read with the caller's credentials and the file component's storage check (a value pointing elsewhere is refused before any fetch). |
| `converters.identify/route/accept/run/list` | File types from their bytes, the converter route to the representations a plugin reads, and running it. |
| `engines.select({ name, needs })`, `engines.generate(engine, request)` | An agent engine that generates and reads what is needed (or 503 `no_engine`), and generation that checks the license first. |
| `markdown.sanitize/fromHtml`, `pdf.pageCount`, `forms.componentAt/componentByKey`, `callerKey`, `errors.create/is` | Helpers. |

Features never get the project object or an engine's credentials: what they may do goes through this API, which keeps the UAG's checks (access, license, file storage, rate limits) in one place.

## Components

A feature's component is a script that registers a formio.js component once `Formio` and `FormioUAG` are on the page. It builds on [`client`](/developers/renderer), the public browser API of `@formio/uag-js`: the UAG's URL, the user's token, the installed plugins, `stream()` for routes, and Markdown rendering. It never bundles formio.js: it uses the one the page registered.

Components reach browsers three ways, always matching the installed feature: the UAG adds them to `uag.use.js` and the portal script; an application with a bundler imports the feature's client (`@formio/uag-extras/features/<name>/client`) and calls `Formio.use()` with it; a page without one loads the feature's script from a CDN, such as jsDelivr, after `uag.use.js`.

## Writing one

Features live in [`@formio/uag-extras`](https://www.npmjs.com/package/@formio/uag-extras): `npm run new -- features <name>` starts one from the sample, with a route, a component and tests, and its contribution guide covers the review a feature gets. Features are trusted code: they run in the UAG process, and their components run in your users' browsers.
