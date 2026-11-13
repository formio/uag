---
title: Modules
description: Package forms, MCP tools, actions, plugins, form routes, formio.js components and settings into a module that configures the UAG for your domain.
section: Extend
order: 20
---

A module is a JavaScript object that extends the UAG. It can give the project the forms and resources your use case needs, add MCP tools, add form actions, change what the built-in tools say to the model, and replace the login page. A module can also bring a whole capability: a formio.js component for the form builder and the forms, the form routes behind it, its settings, and the plugin types it needs. **AI Document** is such a module. One module can be mounted into the Docker image, loaded by the `uag` command, or passed to `server.use()` in your own server, and published to npm for others to use.

This page describes each part of a module, then builds a complete one: a small CRM with a Contact resource, a pipeline tool and a lead-scoring action.

## The module object

```ts
type UAGModule = {
    name?: string;                      // lowercase and "-"; a module used twice, by name, is used once
    title?: string;
    version?: string;
    apiVersion?: number;                // the module API it is written against
    host?: 'uag';                       // it needs the UAG's members of the API
    settings?(config, env): object;     // what the module reads as api.settings
    routes?: { form?: Record<string, ModuleRoute> };  // routes on every form
    components?: ModuleComponent[];     // formio.js components the UAG serves to browsers
    initialize?(api): void | Promise<void>;
    close?(api): void | Promise<void>;
    formRoutes?: RequestHandler | RequestHandler[];  // Express routers on every form, with no checks (see below)
    plugins?: PluginEntry[];
    pluginTypes?: PluginType[] | ((api) => PluginType[]);
    config?: UAGConfig;                 // template, tools, toolOverrides, responseTemplates, auth, engines, ...
    actions?: Record<string, Action>;   // custom form actions, by action name
    hooks?: Record<string, HookFn | HookFn[]>;
    processors?: AppServerProcessors;
    providers?: ProviderInterfaceLibrary;
    db?: ServerDB;
    ProjectInterface?: typeof ProjectInterface;
    FormInterface?: typeof FormInterface;
};
```

| Key | What it does | Section |
|---|---|---|
| `config.template` | A Form.io project template: the forms, resources, roles and actions the module needs the project to have. | [The project template](#the-project-template) |
| `config.tools` | Custom MCP tools. | [Custom MCP tools](#custom-mcp-tools) |
| `config.toolOverrides` | Changes to the built-in tools. | [Overriding built-in tools](#overriding-built-in-tools) |
| `plugins` | Plugins this module brings: converters that read more file types, document plugins, and the like. | [Plugins](#plugins) |
| `config.responseTemplates` | Replacements for the built-in response templates, and new templates for your tools. | [Response templates](#response-templates) |
| `config.auth.authAppHtml` | The HTML of the login page for remote MCP sign-in (`MCP_OAUTH`). | [The login page](#the-login-page) |
| `actions` | Custom form actions, by name. | [Custom actions](#custom-actions) |
| `hooks` | Middleware added around submission requests and actions. | [Hooks](#hooks) |
| `config.engines`, `config.engineTypes`, `config.routing`, `config.agentApi` | Engines and how fields are routed to them. | [Engines and routing](/developers/engines) |
| `name`, `title`, `version`, `apiVersion` | The module's identity, and the module API it is written against. | [Settings, routes and components](#settings-routes-and-components) |
| `settings`, `routes.form`, `components`, `initialize`, `close`, `host` | Settings checked at startup, routes on every form, formio.js components for browsers, start-up and shutdown calls, and the host it needs. | [Settings, routes and components](#settings-routes-and-components) |
| Every other `config` key | Any server option, such as `cors` or `templateSync`. | [Node.js API](/developers/node-api#new-uagserverconfig) |

`processors`, `providers`, `db`, `ProjectInterface` and `FormInterface` are lower-level extension points of the Form.io logic the UAG is built on; most modules never need them. A replacement `ProjectInterface` or `FormInterface` must extend `UAGProjectInterface` or `UAGFormInterface`; the UAG's tools and Agent API live in them.

> **Note:** Engines are configured in `config`: `config.engines` names the instances to enable, and `config.engineTypes` adds engine types by name. A top-level `engines` key on the module is not read.

## Using a module

### In Docker

The `formio/uag` image starts with the module in `/app/module`, which by default is empty. Mount yours over it:

```yaml
services:
  formio-uag:
    image: formio/uag
    volumes:
      - ./module:/app/module
```

```bash
docker run -v "$PWD/module:/app/module" -e PROJECT=... formio/uag
```

A mounted module runs inside the UAG's own installation in `/app`, so `require()` finds the UAG's dependencies, such as `zod` and `lodash`, from `/app/node_modules`, and `require('@formio/uag')` finds the UAG itself, as it does when the module is used from npm. A module that needs its own dependencies can bring them in its own `node_modules` folder, or in an image built `FROM formio/uag`.

### With the uag command

```bash
UAG_MODULE=./module npx uag
```

`UAG_MODULE` names a file or folder, resolved against the working directory.

### In your own server

```js
const { UAGServer } = require('@formio/uag');

// Inside an async main(), as in the Node.js API examples.
const server = new UAGServer();
server.use(require('./module'));
app.use(await server.router());   // app: your Express application
```

Call `use()` before `router()`. Several modules can be used; their `config` objects are merged key by key, later modules winning. See [Where a value comes from](/developers/node-api#where-a-value-comes-from) for how arrays such as `tools` merge.

## The project template

`config.template` is a Form.io project template, the JSON the Open Source server's `/export` endpoint returns, or that an Enterprise project's **Export Template** produces. Its keys are `title`, `version`, `name`, `roles`, `forms`, `resources`, `actions` and `access`. Forms and resources are keyed by machine name; actions are keyed `<form>:<action>` and name their form in `form`.

The project, not the module, is the source of truth. The template only provides what the module needs the project to have:

- Forms, resources and roles the project does not have yet are installed, matched by key.
- Actions the template defines on forms the project already has are installed too, when the project lacks them.
- Nothing the project already has is changed. A changed form or action in the template is not applied.

`templateSync` (`TEMPLATE_SYNC`) sets when this happens:

| Value | When the template is installed |
|---|---|
| `boot` (default) | Once, at startup. |
| `refresh` | At startup and on every `PROJECT_TTL` refresh. |
| `off` | Never. Use this when the project's forms are managed through stage deployments. |

Because `boot` runs at every startup, a form or action from the template that was deleted from the project is installed again on the next restart.

To apply a changed form or action from a new version of your module, change it in the portal, deploy it as a stage, or post the template to the project's `/import` endpoint with an admin or project key. An import updates existing forms in place, keeping their submissions, and replaces their actions.

> **Tip:** Tag every form the agent should see with `uag` in the template. Untagged forms are installed but not exposed to MCP tools or the Agent API. Task properties (`uag`, `uagField`, `uagEngine` and the rest) are covered in [Form properties](/developers/form-properties).

## Custom MCP tools

Each entry in `config.tools` is a tool object, `ToolInfo`. A tool whose definition depends on the project builds that part with `bind(project)` (see [Bound tools](#bound-tools)):

```ts
type ToolInfo = {
    name?: string;                     // snake_case, unique across all tools
    title?: string;
    description?: string;              // what the tool does, and when the model should call it
    inputSchema?: ZodRawShape;         // { argument: zod schema }
    annotations?: ToolAnnotations;     // whether it reads or writes
    execute?: (args: any, extra: ToolExtra) => Promise<CallToolResult>;
    bind?: (project: UAGProjectInterface) => Partial<ToolInfo> | Promise<Partial<ToolInfo>>;
};

type ToolExtra = {
    authInfo: AuthRequest;             // the caller: who the work runs as
    project: UAGProjectInterface;      // the project serving the request
    module?: UAGModuleApi;             // the module API of the module that added the tool (named modules only)
    [key: string]: any;                // on /mcp, the rest of the MCP request context
};

interface ToolAnnotations {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
}
```

A tool without a `name` is skipped. Names must be unique: a custom tool with a built-in tool's name stops startup, with `router()` rejecting `Tool <name> is already registered`. The built-in names are listed under [Overriding built-in tools](#overriding-built-in-tools).

### The input schema

`inputSchema` is a Zod raw shape: an object whose values are Zod schemas. Use the `zod` the UAG depends on (4.x). The MCP SDK turns it into the JSON schema the client sees, and validates arguments before `execute` runs.

```js
const { z } = require('zod');

inputSchema: {
    company: z.string().optional().describe('Count only the contacts at this company (exact name).'),
    limit: z.number().int().positive().max(100).optional().describe('At most this many results.'),
}
```

The `describe()` text is what the model reads, so say what the argument means and how to fill it.

### Annotations

Annotations tell the client whether a call is safe to make without asking, and safe to retry. They also gate the Agent API: only tools annotated `readOnlyHint: true` may be listed in a task's `uagTools` for research, and only those are ever offered through a scoped token. A tool without annotations is treated as one that writes.

| Preset (`@formio/uag`) | `readOnlyHint` | `destructiveHint` | `idempotentHint` | Use for |
|---|---|---|---|---|
| `reads(title)` | `true` | `false` | `true` | Lookups, searches, summaries; also tools that only echo or validate what they are given. |
| `creates(title)` | `false` | `false` | `false` | Tools that create a record. |
| `overwrites(title)` | `false` | `true` | `true` | Tools that replace values in an existing record. |

`openWorldHint` is `true` in all three. Written out, `reads('CRM pipeline summary')` is:

```js
annotations: { title: 'CRM pipeline summary', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
```

### execute(args, extra)

`execute` receives the validated arguments (an empty object for a tool that takes none) and `extra`, a `ToolExtra`: `extra.project` is the project serving the request, and `extra.authInfo` is the caller's `AuthRequest`. The same tool runs for MCP clients and for Agent API research, with the same arguments, and in both cases `authInfo` is the identity the work runs as.

| You need | Use |
|---|---|
| The project | `extra.project` (a `UAGProjectInterface`). A bound tool's `bind` also receives it. In your own server, `server.uagProject` is the same object. |
| A form | `await project.getForm('contact')`, by machine name, name or id. `null` when it does not exist. |
| The caller's permissions | `extra.authInfo.formPermissions(form)`: `{ create, read, update, delete }`. |
| Submissions | `form.find(query, auth)`, `form.count(query, auth)`, `form.loadSubmission(id, auth)`. Pass `extra.authInfo` so Form.io applies the caller's permissions. |
| To save | `form.submit(form.convertToSubmission(values), auth)`: runs the form's create or update chain, hooks and actions included, and forwards the submission to Form.io. An optional third argument adds fields to the request the chain's middleware sees. |
| A response | `project.mcpResponse(templateName, data, isError?)` (rendered template), or `project.mcpJSONResponse(data, isError?)` (JSON text plus `structuredContent`). |

`execute` returns an MCP tool result, `{ content: [{ type: 'text', text }], isError? }`. Report failures the model can act on (a missing form, no permission, a bad argument) as a result with `isError: true` and a sentence that says what to do next. A thrown exception also reaches the client as an error result, with the exception's message as its text, so do not let messages that carry URLs, keys or internal details escape.

The full methods of the project and form interfaces are in [Node.js API](/developers/node-api#the-project-uagprojectinterface).

### Bound tools

A tool's `bind(project)` builds the part of the tool that depends on the project (`inputSchema`, `annotations`, `execute`, ...), as the built-in tools are built. Its static `name`, `title` and `description` are used unless `bind` returns its own, so the tool's name is known without a project. Use one when, for example, an argument is limited to the project's forms:

```js
const { z } = require('zod');

/** read_contact: a contact by id, on any of the project's forms. */
module.exports = {
    name: 'read_contact',
    title: 'Read a contact',
    description: 'Read one contact by its submission id.',
    bind(project) {
        return {
            annotations: { title: 'Read a contact', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
            inputSchema: {
                form_name: z.enum(project.formNames),
                submission_id: z.string()
            },
            async execute({ form_name, submission_id }, { project, authInfo }) {
                const form = await project.getForm(form_name);
                const submission = await form?.loadSubmission(submission_id, authInfo);
                return project.mcpJSONResponse(submission ? submission.data : { error: 'Not found.' }, !submission);
            }
        };
    }
};
```

The UAG builds its tool list on every `/mcp` request and every research plan, so `bind` runs each time: keep it cheap, and load libraries or other slow state once, outside it. A `bind` that throws stops startup, as a duplicate name does. A bare function in `config.tools` stops startup with a message showing this shape.

### Tools in the Agent API

The Agent API offers tools to agent engines for research when a task's criteria component lists them in `uagTools`. Custom tools qualify when they are annotated read-only. Each is converted for the engine: its Zod shape becomes a JSON schema, arguments the model sends are validated with the same schema, and the call runs in process with the caller's identity. A remote engine on an engine server calls the same tools back over `/mcp` with a scoped token that lists only them. See [Engine server](/developers/engine-server#research-and-scoped-tokens).

## Settings, routes and components

A module that brings a whole capability uses more keys: `settings`, `routes`, `components`, `initialize` and `close`. A module with any of them needs a `name` and an `apiVersion`, the version of the [module API](#the-module-api) it is written against: version 1, from UAG 2.0.0. A module that uses the UAG's own members of the API (licenses, engines, converters) also says `host: 'uag'`, so a server other than the UAG refuses it at startup instead of failing on the first request.

```js
// npm install @formio/uag-extras@^1
import { UAGDocument } from '@formio/uag-extras/modules/ai-document';
server.use(UAGDocument);
```

Several modules are used together as a list, `server.use([UAGDocument, Extract])`, in a plugins file or a module file too; one given twice (by `name`) is used once, and two versions of one stop startup. Once used, a module's component is in `/uag-js/uag.use.js` and the portal script, its routes answer on every form, and `GET {project}/plugins` lists it as `module:<name>`, which is the quickest way to check it is loaded. An operator leaves a module out with `MODULES_DISABLED=address-check`.

This page's example is a module that checks a postal address: `address-check`, with the route `POST {form}/address-check/check` and the component `uagaddresscheck`.

```js
// address-check/index.js (CommonJS, for the uag command and the image; server.use() uses an ES module by its default export)
/** @type {import('@formio/uag').UAGModule} */
module.exports = {
    name: 'address-check',                    // lowercase and "-"; a module used twice is used once
    title: 'Address check',
    version: '1.0.0',
    apiVersion: 1,                            // the module API it is written against
    host: 'uag',                              // it uses the UAG's members of the API
    settings(config, env) {                   // what the module reads as api.settings; throw to stop startup
        const maxLength = Number(config.addressCheck?.maxLength ?? env.ADDRESS_CHECK_MAX_LENGTH ?? 200);
        if (!(maxLength > 0)) throw new Error('maxLength: must be above 0');
        return { maxLength };
    },
    routes: {
        form: {
            'POST /address-check/check': {
                rateLimit: { limit: 30, windowMs: 60000 },   // a default; the operator's own setting wins
                handler: (req, res, api) => {
                    const address = String(req.body?.address || '').trim();
                    if (!address) throw api.errors.create(400, 'Send an address to check.', 'invalid_request');
                    if (address.length > api.settings.maxLength) throw api.errors.create(413, `At most ${api.settings.maxLength} characters.`, 'payload_too_large');
                    return { valid: /\d/.test(address), address };
                }
            }
        }
    },
    components: [{ type: 'uagaddresscheck', script: require.resolve('./dist/address-check.min.js'), style: require.resolve('./dist/address-check.css') }],
    initialize: (api) => api.log.info(`checks addresses of up to ${api.settings.maxLength} characters`),
    close: (api) => {}                        // timers, pools: stop them here (also on SIGTERM under uag and the image)
};
```

| Key | What the UAG does with it |
|---|---|
| `apiVersion`, `host` | Startup stops when this UAG does not provide that version of the module API, or when the module needs another host. |
| `settings` | Called once at startup, before the project loads, with the server's configuration and the environment. It returns a plain object, never a promise: that object, frozen, is `api.settings`. An error it throws stops startup, naming the module. |
| `routes.form` | Each `"<METHOD> <path>"` answers on every form, by path and by id: behind the caller authentication of agent operations, the JSON body limit, a request id, the rate limits of its `name` (below), the caller's access to the form (`access`, below) and the Agent API's error shape `{ requestId, error, code }`. A path is fixed, with no parameters (`/:id`), and is compared without case or a trailing slash: two modules with one route stop startup, and so does a path whose first segment is one the form's own routes use (`/`, `/submission`, `/exists`, `/agent`, `/action`, `/actions`), so `/submission/notes` is refused too. Put a module's routes under its own name, `/<module-name>/…`: the UAG never takes those. On a form open to [anonymous visitors](#anonymous-visitors), they reach the routes too. |
| `components` | Each script is served at `/uag-js/components/<type>.js` and added to `uag.use.js` and `portal.js`; each style to `uag-js.css` and `portal.css`. A script is a built browser script that registers the component, not an ES module: the UAG parses it at startup, and refuses one that does not parse, since browsers get every component in one script. A script changed on disk after startup that no longer parses is left out of `uag.use.js` and `portal.js`, with a warning in the log. Two modules with one component type stop startup. A component type is lowercase letters and digits, with no `-` (`[a-z][a-z0-9]*`); start it with `uag`. |
| `pluginTypes` | The plugin types the module defines, as any module may; or a function of the module's API, `(api) => [...]`, for plugin types that need it. |
| `initialize` | Called once at startup, after the project, the plugins and the engines are loaded, before any request. An error it throws stops startup. |
| `close` | Called once when the server is destroyed (`await server.destroy()`), in the reverse order the modules were used. The `uag` command and the Docker image destroy the server on `SIGTERM` or `SIGINT`: they stop taking connections, call `server.destroy()` and exit with 0, or with 1 when that fails or takes more than 10 seconds. |

`use()` every module before the server starts (`router()`): a module with these keys used later stops startup. A module may still add any Express router to every form with `formRoutes`, the lower-level hook `routes.form` is built on: those routes get no access check, no conflict check, and none of the agent operations' protections.

### The handler

A route's handler is `(req, res, api)`:

| | |
|---|---|
| `req.form` | The form the route was called on: `id`, `name`, `path`, `title`, and `definition`, the stored form's JSON (its `components`). Find a component with `api.forms.componentAt(req.form, path)`, from the stored form, never from the request. |
| `req.auth` | The caller, already checked against the route's `access`: a signed-in caller, or an [anonymous visitor](#anonymous-visitors) on a form open to them. Pass it to `api.files.read`. |
| `req.body` | The JSON the client sent, within the agent operations' body limit. |
| `req.signal` | Aborts when the client goes away: pass it to `api.files.read` and to the engine. |
| `req.requestId` | The request id, also in the `X-Request-Id` header and in the UAG's logs. |

It answers in one of three ways:
- **Return the JSON**: `return { valid: true }` answers `200 { "valid": true }`.
- **Throw a refusal**: `throw api.errors.create(413, 'At most 200 characters.', 'payload_too_large')` answers `413 { "requestId": "…", "error": "At most 200 characters.", "code": "payload_too_large" }`. Any other error answers 500 with no detail; the details are in the UAG's log under the request id.
- **Stream progress**: `return api.stream(req, res, async ({ signal, progress }) => { … return result; })`. Call `progress(fraction, message)` with a number from 0 to 1 and an optional message: `progress(0.5, 'Checking the street')`. A client that accepts `text/event-stream` gets `progress` events (`{ "progress": 0.5, "message": "Checking the street" }`), then `done` (`{ "result": … }`) or `failed` (`{ "status", "requestId", "error", "code" }`); any other client gets `{ "result": … }` as JSON. In both, what `run` returns is under `result`.

A route's `access` is the form methods a caller needs, one of which is enough: by default `['create', 'update']`, what filling in the form takes. Give other methods (`['read']`), or `false` for a route that checks access itself; the check runs before the handler, with the same `401` and `403` answers as the Agent API. A route's `name` is the operation its rate limits are counted under, `agentApi.rateLimits.caller[name]`; it defaults to the module's name, may not be one of the UAG's own (`extract`, `decide`, `generate`, `chat`, `capabilities`), and its `rateLimit` is the default the operator's setting overrides.

```js
'POST /address-check/check': {
    async handler(req, res, api) {
        // The caller's create or update access to the form was checked before this runs.
        await api.requireLicense();
        const engine = api.engines.select({ needs: ['text'] });   // a handle: generate checks the license
        return api.stream(req, res, async ({ signal, progress }) => {
            progress(0.2, 'Asking the engine');
            const answer = await engine.generate({ instructions: `Is this a postal address? ${req.body.address}`, format: 'text', signal });
            return { verdict: answer.text };
        });
    }
}
```

### Anonymous visitors

A visitor who is not signed in reaches a module's routes on a form with [`uagAnonymous: "true"`](/developers/form-properties#uaganonymous) whose Anonymous role may create submissions, as they reach its agent operations, under the same anonymous limits per address and in total (`AGENT_ANONYMOUS_RATE_LIMIT`, `AGENT_ANONYMOUS_TOTAL_RATE_LIMIT`; see [Security](/developers/security#anonymous-visitors)). On any other form they get `401`. A route that must not be public declares an `access` the Anonymous role lacks, such as `['update']` (anonymous visitors are admitted for create), or checks `req.auth.user` itself (see [Modules and plugins](/developers/security#modules-and-plugins) in Security). Anonymous visitors also share one caller for `agentApi.rateLimits.caller`; to count them per address, key your own limit with `api.callerKey(req)`, which gives `anonymous:<ip>` for them.

### Components

A module's component is a function of the page's `Formio` that returns the formio.js module; the build wraps it in a script that registers it once `Formio` is on the page. The UAG wraps each component script in its own `try`, so one that throws while loading is logged and the others still register. It builds on `Formio.uagClient`, the public browser API of `@formio/uag-js` (set when the UAG is registered, so look it up when used): the UAG's URL, the user's token, the installed plugins, `stream()` for routes, and Markdown rendering. See [For module components: `client`](/developers/renderer#for-module-components-client) for every member. It never bundles formio.js: it uses the one the page registered.

```js
// address-check/client.js
export default function addressCheck(Formio) {
    const TextField = Formio.Components.components.textfield;
    class AddressCheckComponent extends TextField {
        static schema(...extend) { return TextField.schema({ type: 'uagaddresscheck', label: 'Address', key: 'address' }, ...extend); }
        async check() {
            const client = Formio.uagClient;
            const answer = await client.stream(client.formUrl(this.root) + '/address-check/check', { address: this.dataValue }, {
                form: this.root,
                onEvent: (name, data) => { if (name === 'progress') this.emit('addressCheckProgress', data); }   // show it in a status element
            });
            return answer.result;   // a streamed route answers { result }
        }
    }
    return { components: { uagaddresscheck: AddressCheckComponent } };
}
```

Build it with the published build (it needs `esbuild`: install it as a dev dependency, or name it to `npx` as below), which writes `dist/address-check.mjs` (for bundlers), `dist/address-check.min.js` (the script `components` points at, also for CDNs) and `dist/address-check.css`, with their integrity values:

```bash
npx -p @formio/uag-extras@^1 -p esbuild uag-build-client client.js --name address-check --style style.css --out dist
```

Components reach browsers three ways, always matching the installed module: the UAG adds them to `uag.use.js` and the portal script; an application with a bundler imports the module's client and calls `Formio.use()` with it; a page without one loads the module's script from a CDN, such as jsDelivr, after `uag.use.js`, or from the UAG itself, `{uag}/uag-js/components/<type>.js` (and `.css`), after registering `@formio/uag-js` with its own options (see [Or load it from the UAG](/developers/renderer#or-load-it-from-the-uag)).

### The module API

A module gets one `api`, version 1, in its routes, `initialize`, `close`, a function `pluginTypes`, and its MCP tools (`extra.module` in a tool's `execute`):

| Member | What it does |
|---|---|
| `name`, `apiVersion`, `host` | The module's name and API version, and the server it runs on: `{ name: 'uag', version }`. |
| `settings`, `log` | The resolved settings (frozen), and a log whose messages name the module. |
| `plugins.get/list/settings` | The plugin registry: plugins by type and name, and their operator settings. |
| `requireAccess(auth, form, methods)` | Throws 403, as the Agent API does, unless the caller may use the form with one of `methods`. Routes get this check from `access` (after the caller check, which answers 401 to a caller who is not signed in, except on a form open to [anonymous visitors](#anonymous-visitors)); use it for anything else. |
| `requireLicense()` | Throws 403 `license_required` unless Agentic Formflow is allowed. |
| `files.read(form, value, auth, { maxBytes, component, signal })` | A stored file value's bytes, read with the caller's credentials and the file component's storage check (a value pointing elsewhere is refused before any fetch). |
| `converters.identify/route/accept/run/list` | File types from their bytes, the converter route to the representations a plugin reads, and running it. |
| `engines.select({ name, needs })` | An engine that generates and reads what is needed, as `{ name, model, accepts, generate(request) }`. Its `generate` answers 403 `license_required` unless Agentic Formflow is allowed. Throws 503 `no_engine` when no enabled engine fits. Modules never get the engine itself. |
| `stream(req, res, run, { heartbeatMs })` | Answers with what `run` returns, as JSON or as server-sent progress events (above). |
| `callerKey(req)` | A key per caller, for limits: the user, the token or the key, and for anonymous callers their address. |
| `markdown.sanitize/fromHtml`, `pdf.pageCount`, `forms.componentAt/componentByKey`, `errors.create/is` | Helpers. |

Modules never get the project object or an engine's credentials through the API: what it gives keeps the UAG's checks (access, license, file storage, rate limits) in one place, and stays stable within a major version. Anything a module reaches outside `api` and `req.form`'s members may change in a minor release. The API is not a sandbox, though: a module runs in the UAG process with everything the process can reach. Use only modules you trust.

### Testing a module

`@formio/uag/testing` runs a module's API and routes without a Form.io project or a running UAG: the real errors, streaming, form lookups, converters and engine handles, with stand-ins for the caller, the license, the engines and the files.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const { createTestModuleApi, mountModuleRoutes, testForm, testAuth } = require('@formio/uag/testing');
const AddressCheck = require('../index.js');

const form = testForm({ _id: 'f1', name: 'shipping', path: 'shipping', components: [{ type: 'uagaddresscheck', key: 'address' }] });

test('settings come from the configuration', async () => {
    const api = await createTestModuleApi(AddressCheck, { config: { addressCheck: { maxLength: 20 } } });
    assert.equal(api.settings.maxLength, 20);
});

test('the route refuses an empty address', async () => {
    const app = await mountModuleRoutes(AddressCheck, { form, auth: testAuth(), engines: [{ name: 'fake', generate: async () => ({ text: 'yes' }) }] });
    const res = await supertest(app).post('/shipping/address-check/check').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'invalid_request');
});
```

The kit needs `@formio/uag` (a peer dependency of your module); the example also uses [`supertest`](https://www.npmjs.com/package/supertest), a dev dependency to install. `createTestModuleApi(module, { settings | config, env, plugins, engines, licensed, files })` resolves the settings as the server does. `mountModuleRoutes(module, { form, auth, ...the same })` mounts the routes on an Express app by the form's path and by `form/<id>`, with the access check and the error shape (no rate limits). `testForm(definition, { files })` reads base64 (`data:`) file values itself, and any other through `files`, `(value, { component, maxBytes }) => Buffer | null` (or a promise of one); `createTestModuleApi` and `mountModuleRoutes` take `files` too, for a form that has none of its own (a form's own `files` wins). `testAuth({ permissions, user, admin })` is a caller with those permissions: a list (`['read']`) or `{ read: true }`. To try a module in a real UAG in process, see the contract tests in the `@formio/uag-extras` source repository.

### Writing one

Start from the samples in the `@formio/uag-extras` source repository: in a clone of it, `npm run new -- modules <name> --component` starts a module with a route, a component and tests, and its contribution guide covers the review such a module gets. A module may also live in its own package: export it from a CommonJS file for the `uag` command and the image, depend on `@formio/uag` as a peer, and build its component with the published build above. `server.use()` uses an ES module by its default export, even when it has named exports too, and logs a warning for an object with none of a module's keys, which adds nothing.

## Plugins

A **module** customizes your UAG deployment: it is the one place you wire the server — your project template, form actions, MCP tools, hooks, interface overrides, and which plugins to load. A **plugin** is one capability of a known type — "convert Word documents to PDF", "extract a document's exact text" — that describes itself, so operators can enable it and form builders can select and configure it. Modules can bring plugins; plugins never change how the server itself works.

A module lists its plugins in `plugins`, and any plugin types it defines in `pluginTypes`. They are added to the UAG's one plugin registry in the order modules are used, and never merged with each other. Plugins files (`UAG_PLUGINS`, or each folder under `/app/plugins` in the image) add more the same way, and a plugin may use a type another of them defines. See [Plugins](/developers/plugins).

```js
module.exports = {
    config: { /* ... */ },
    plugins: [require('./my-converter')]
};
```

### Documents as task inputs

A file component that is a task's input, or in its `uagContext`, is read for the engines (see [Documents as input](/developers/form-properties#documents-as-input)) through the installed converters: every file type with a route to text is read, the built-in converters giving PDF (its text layer), text, Markdown, CSV, JSON, HTML and XML, and converters from plugins the rest. To read another format, add a converter plugin; there are no file readers in the module configuration.

## Overriding built-in tools

`config.toolOverrides` changes the built-in tools by name. Each override is merged over the built-in definition with Lodash `defaultsDeep`, so the fields you set win and the rest stay:

```js
toolOverrides: {
    get_forms: {
        description: 'List the CRM forms the user can use. Call this before get_form_fields whenever the user wants to add, find or update a contact.'
    }
}
```

| Key | Tool |
|---|---|
| `get_forms` | List the forms tagged `uag`, with the caller's permissions. |
| `get_form_fields` | The fields a form needs. |
| `get_field_info` | Rules and formats for specific fields. |
| `collect_field_data` | Validate and accumulate values in conversation. |
| `confirm_form_submission` | Summarize collected data before submitting. |
| `submit_completed_form` | Create the submission. |
| `find_submissions` | Search submissions, or count them. |
| `submission_update` | Change an existing submission. |
| `agent_provide` | A task's fields and criteria for the agent to fill. |
| `agent_decide` | A task's decision questions as JSON. |
| `fetch_external_data` | Options for resource, URL-backed select and data source fields. |
| `read_document` | The text of a file uploaded to a submission. |

What each tool does is covered in [MCP tools](/developers/mcp-tools). The useful overrides are `description` and `title`, which change how the model uses a tool. Overriding `execute` replaces the implementation. `inputSchema` is merged key by key into Zod objects; to change a tool's arguments, write a custom tool instead.

Because only tools with a name are registered, `{ name: '' }` removes a built-in tool:

```js
toolOverrides: { fetch_external_data: { name: '' } }
```

## Response templates

Every built-in tool answers the model with a rendered [Lodash template](https://lodash.com/docs/4.17.15#template). Templates are Markdown with `<%= value %>` (insert), `<%- value %>` (insert, HTML-escaped) and `<% code %>` (JavaScript, for loops and conditions); `_` is Lodash inside a template.

`config.responseTemplates` maps template names to template source. A name that matches a built-in template replaces it; any other name adds a template your tools can render with `project.mcpResponse(name, data)`. The built-in templates are the `.md` files in [`src/templates`](../../../src/templates), one per name.

```js
const fs = require('fs');
const path = require('path');

responseTemplates: {
    // Replace a built-in template.
    getAvailableForms: fs.readFileSync(path.join(__dirname, 'templates/getAvailableForms.md'), 'utf8'),
    // Add one for a custom tool.
    crmPipelineSummary: fs.readFileSync(path.join(__dirname, 'templates/crmPipelineSummary.md'), 'utf8'),
}
```

To change a built-in template, copy its file from `src/templates` and edit it. The data it receives is whatever its tool passes; read the tool in [`src/tools`](../../../src/tools) for the exact shape. For example, `get_forms` renders `getAvailableForms` with:

```js
{
    forms: [{ name, title, description, permissions: { create, read, update, delete }, hasAccess }],
    totalForms
}
```

| Template | Rendered by |
|---|---|
| `getAvailableForms`, `noFormsAvailable` | `get_forms` |
| `getFormFields`, `getFormFieldsEmpty`, `getFormFieldsError`, `fieldList`, `fieldRules` | `get_form_fields` |
| `getFormFieldsInfo`, `fields`, `fieldRules`, `getFormFieldsError` | `get_field_info` |
| `collectedData`, `allFieldsCollected`, `fieldCollectedNext`, `fields`, `fieldRules`, `fieldValidationErrors` | `collect_field_data` |
| `confirmFormSubmission`, `collectedData`, `fieldCollectedNext`, `fields`, `fieldRules`, `fieldValidationErrors` | `confirm_form_submission` |
| `formSubmitted`, `submitValidationError`, `collectedData` | `submit_completed_form` |
| `submissionsFound`, `noSubmissionsFound`, `submissionCount`, `submissionSearchError`, `submissionPartialIdAmbiguous`, `submissionPartialIdNotFound` | `find_submissions` |
| `submissionUpdated`, `submissionUpdateError`, `submissionNotFound`, `submitValidationError`, `collectedData` | `submission_update` |
| `agentProcessData`, `fieldList`, `fieldValues`, `submissionNotFound`, `uagComponentNotFound` | `agent_provide` |
| `submissionNotFound` | `agent_decide` |
| `fetchExternalData`, `fetchExternalDataError`, `formData`, `fieldValidationErrors` | `fetch_external_data` |
| `formNotFound`, `submissionNotFound` | `read_document` (its other answers are JSON) |
| `formNotFound` | Most tools, when `form_name` names no form. |

Templates are read when the project initializes at startup and compiled once, so a changed template file takes effect on the next restart.

## Custom actions

An action is configurable middleware attached to a form. Each instance of it on a form has its own settings, and runs before or after the save for the methods it is configured for. Actions are how a module connects data the agent collected to your other systems.

```ts
type ActionInfo = {
    name: string;            // the key in module.actions, and the "name" of each instance
    title: string;
    description: string;
    priority: number;        // default priority for new instances; higher runs first
    premium?: boolean;
    defaults: {
        handler: string[];   // 'before' and/or 'after'
        method: string[];    // 'create', 'update', 'read', 'delete', 'index'
    };
    access?: {
        handler: boolean;    // false: the handler is fixed, not offered in the settings form
        method: boolean;     // false: the methods are fixed
    };
};

interface Action {
    info: ActionInfo;
    platform?: boolean;      // Form.io implements this action too: the UAG never runs it
    settingsForm(form: FormInterface): Promise<Component[]>;
    projectSettings?(form: FormInterface): Promise<Component[]>;
    executor(form: FormInterface, action: FormAction, handler: string, method: string):
        Promise<(req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => Promise<any>>;
}
```

| Member | Meaning |
|---|---|
| `info` | Describes the action. A getter is fine. |
| `platform` | `true` for an action Form.io implements too. The UAG never runs such an action; see [Actions in proxy mode](#actions-in-proxy-mode). Leave it unset on your own actions. |
| `settingsForm(form)` | Form.io components for one instance's settings. Their values arrive as `action.settings` in `executor`. |
| `projectSettings(form)` | Enterprise: components for settings stored, encrypted, in the project's settings (API keys for a third-party service). Read them as `form.project.settings`. |
| `executor(form, action, handler, method)` | Prepares one instance and returns the middleware that runs per request. |

### Lifecycle

```pipeline
request reaches the form's route -> before actions, highest priority first -> the forward to Form.io* -> after actions -> response
```

1. **Building.** When a form's submission chain is built, `executor` is called for each action instance on the form, for each handler and method it is configured for. A form has two chains, built separately: its routes', at startup, and the one `form.submit()` uses (the MCP tools, for example), on first use. Both are built again after a `PROJECT_TTL` refresh brings a changed project. Do slow work here: read settings, create clients, compile patterns.
2. **Ordering.** For one request, the matching instances run in two groups: `before` instances, then the operation itself, then `after` instances. Within a group they run by `priority`, highest first. For a create or an update, the operation is the forward to Form.io, a fixed step after every `before` instance, so a `before` action's changes always reach Form.io, which validates and stores them and runs its own actions on them.
3. **Conditions.** Before each run, the instance's condition is checked: a field compared with a value, or custom JavaScript or JSONLogic. When it does not hold, the action is skipped.
4. **Running.** The middleware gets the Express request and response:
   - in a `before` handler, `req.submission` is the submission about to be saved. Change `req.submission`; changes made only to `req.body` are not saved;
   - in an `after` handler, `res.resource.item` is the submission as Form.io saved it, with its `_id`. When Form.io refuses the forwarded request, the caller gets Form.io's error and no `after` instance runs;
   - `req.auth` is the caller's `AuthRequest`.
5. **Continuing.** Call `next()` to continue, or `next(error)` to stop the request with that error. A thrown error stops it too.

The UAG runs a form's actions for the requests it handles: submissions created and updated through its MCP tools, the saves of "Agent: Run task" runs, and requests to the form's routes on the UAG. A submission saved directly to the Form.io server does not pass through the UAG, so the module's actions do not run for it.

### Attaching an action to a form

Add an instance to the project template, so the module installs it:

```json
"contact:leadScore": {
  "title": "Lead Score",
  "name": "leadScore",
  "form": "contact",
  "priority": 20,
  "method": ["create", "update"],
  "handler": ["before"],
  "settings": { "sourceFields": "title, notes", "rules": [{ "keyword": "budget", "points": 30 }] }
}
```

Or post one to a form on an Open Source server:

```http
POST /form/{formId}/action HTTP/1.1
Host: forms.example.com
x-admin-key: <ADMIN_KEY>
Content-Type: application/json

{
  "data": {
    "name": "leadScore",
    "title": "Lead Score",
    "method": ["create", "update"],
    "handler": ["before"],
    "priority": 20,
    "settings": { "sourceFields": "title, notes", "rules": [] }
  }
}
```

The UAG reads a project's actions when it loads the project, so a new instance takes effect after the next `PROJECT_TTL` refresh or a restart.

### Built-in actions

| Action | From | What it does |
|---|---|---|
| `save` | Form.io | Saves the submission. |
| `login` | Form.io | Signs a user in against resources. |
| `role` | Form.io | Adds or removes a role on a user. |
| `webhook` | Form.io | Calls a URL with the submission. |
| `email` | Form.io | Sends an email. |
| `group` | Form.io | Group permissions. |
| `agentRunTask` | the UAG | "Agent: Run task": runs one of the form's tasks on the submission, before the save or after it in the background. See [Workflows](/developers/workflows). |

### Actions in proxy mode

The UAG runs in proxy mode: Form.io stores every submission and runs its own actions on the forwarded request. The UAG never runs the actions Form.io implements, `save`, `login`, `role`, `webhook`, `email` and `group` (all six are marked `platform: true`, and their names are excluded too), so none of them runs twice. Every other action is an extension and runs in the UAG: the UAG's own `agentRunTask`, and every action a module adds.

A module action registered under the name of one of Form.io's actions (its own `webhook`, say) is not run by the UAG either, flag or not: Form.io runs its own action of that name on the forwarded request, and running both would do the work twice. To change what happens on a save, add an action under a name of your own instead.

In a portal stage connected to the UAG, a form's list of available actions is Form.io's list followed by the extension actions Form.io does not know, and an extension action's settings form is the one its `settingsForm` returns. Every other action's settings form comes from Form.io.

## Hooks

`hooks` adds middleware to every submission request, or around actions, without attaching an action to each form. A hook is a function that receives the form (and, for action hooks, the action instance) and returns an Express middleware, an array of them, or nothing. It is called when the form's chain is built.

| Hook | Where its middleware runs |
|---|---|
| `before:access:<op>` | First, before the caller's access to the form is checked. Its middleware may set `req.forwardAuth`: an `AuthRequest` the submission is checked and forwarded to Form.io as instead of the caller. `req.auth` stays the caller for everything else, actions included. "Agent: Run task" uses it to create a submission on a user's behalf with an agent role. |
| `before:submission`, `before:submission:<op>`, `before:<formName>:<op>` | After the access check (on an update, once the stored submission is loaded into `req.submission`, before the request's data replaces it), and before the `before` actions. `<op>` is `create`, `read`, `update`, `delete` or `index`. |
| `after:<formName>:<op>`, `after:submission:<op>`, `after:submission` | After the response is prepared. |
| `form:action`, `<handler>:form:action`, `<handler>:form:action:<method>`, `<handler>:form:<actionName>:<method>`, `<handler>:<formName>:<actionName>:<method>` | At the start of the handler group (`before` or `after`) that has a matching action instance: all of the group's action hook middleware runs first, then its actions by priority. |

```js
module.exports = {
    hooks: {
        // Stamp every contact saved through the UAG.
        'before:contact:create': async (form) => (req, res, next) => {
            req.submission.metadata = { ...(req.submission.metadata || {}), source: 'uag' };
            next();
        }
    }
};
```

`<formName>` is the form's name. Several modules can register the same hook; each one's middleware is added in order.

## The login page

Remote MCP clients, such as claude.ai connectors, sign users in through the browser, at `/auth/authorize` on the UAG's public URL. The page exists only with `MCP_OAUTH=true`, and answers `404` until the UAG's database is in use (see [Node.js API](/developers/node-api#the-uag-database)). Clients that get tokens with `client_credentials` never load it.

The built-in page renders the login form from `auth.loginForm` (`LOGIN_FORM`) with formio.js and completes the OAuth flow. To brand it, or to change how users sign in, replace the page with `config.auth.authAppHtml`, the page's HTML as a string:

```js
module.exports = {
    config: {
        auth: { authAppHtml: fs.readFileSync(path.join(__dirname, 'authorize.html'), 'utf8') }
    }
};
```

The `AUTHORIZE_HTML` environment variable does the same with the HTML itself as its value, read once when the routes are built, at startup. When both are set, `authAppHtml` wins.

A replacement page must:

1. Load `config.js` (relative to `/auth/authorize`, so `/auth/config.js`). It sets `window.authConfig = { loginForm, authEndpoint: 'authorize' }`. The endpoint is relative to the page, so it also works when the UAG is mounted under a path: post to `authConfig.authEndpoint` as given rather than to a fixed `/auth/authorize`.
2. Sign the user in to Form.io, for example by rendering `authConfig.loginForm` with formio.js, and get their Form.io token (`Formio.getToken()`).
3. POST JSON to `authConfig.authEndpoint` with the OAuth parameters from the page's query string and the token:

   ```json
   {
     "client_id": "…", "code_challenge": "…", "code_challenge_method": "S256",
     "redirect_uri": "…", "response_type": "code", "scope": "…", "state": "…",
     "jwt": "<the user's Form.io token>"
   }
   ```
4. Follow the `redirect` URL in the response: `{ "redirect": "<redirect_uri>?code=…&state=…" }`.

The UAG answers `400` when `jwt` or `code_challenge` is missing or the `redirect_uri` is not allowed, and `401` when the Form.io project does not confirm the token. The [custom module example's `authorize.html`](../../samples/custom-module/module/authorize.html) is a complete page to start from: a Bootstrap layout around the same login flow.

The example module loads its `authorize.html` exactly this way, with `auth: { authAppHtml: fs.readFileSync(path.join(__dirname, 'authorize.html'), 'utf8') }`.

## Worked example: a CRM module

The module below gives an agent a CRM: a **Contact** resource it can add to, search and update with the built-in tools; a `crm_pipeline_summary` tool that counts contacts by stage; and a **Lead Score** action that scores each contact from keywords before it is saved.

```text
module/
├── index.js
├── project.json
├── actions/
│   └── leadScore.js
├── tools/
│   └── pipelineSummary.js
└── templates/
    └── crmPipelineSummary.md
```

### index.js

```js
/**
 * A small CRM module for the Form.io UAG: a Contact resource, the
 * crm_pipeline_summary tool and the Lead Score action.
 *
 *   Docker:   mount this folder at /app/module
 *   Node.js:  server.use(require('./module'))
 */
const fs = require('fs');
const path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

module.exports = {
    config: {
        // Installed into the project at startup when the project lacks it (TEMPLATE_SYNC).
        template: require('./project.json'),
        // A new template for the new tool, next to the built-in ones.
        responseTemplates: {
            crmPipelineSummary: read('templates/crmPipelineSummary.md')
        },
        // Tune a built-in tool for this domain.
        toolOverrides: {
            get_forms: {
                description: 'List the CRM forms the user can use. Call this before get_form_fields whenever the user wants to add, find or update a contact.'
            }
        },
        tools: [require('./tools/pipelineSummary')]
    },
    actions: {
        leadScore: require('./actions/leadScore')
    }
};
```

### project.json

The Contact resource is tagged `uag`, so the agent sees it. Signed-in users may create, read and update contacts. The template also installs the Save Submission action and a Lead Score instance with its keyword rules.

```json
{
  "title": "CRM",
  "version": "2.0.0",
  "name": "crm",
  "roles": {
    "administrator": { "title": "Administrator", "description": "A role for Administrative Users.", "admin": true, "default": false },
    "authenticated": { "title": "Authenticated", "description": "A role for Authenticated Users.", "admin": false, "default": false },
    "anonymous": { "title": "Anonymous", "description": "A role for Anonymous Users.", "admin": false, "default": true }
  },
  "forms": {},
  "resources": {
    "contact": {
      "title": "Contact",
      "type": "resource",
      "name": "contact",
      "path": "contact",
      "display": "form",
      "tags": ["uag"],
      "properties": {
        "description": "A person the sales team is in touch with: a lead, a qualified prospect or a customer."
      },
      "components": [
        { "type": "textfield", "key": "firstName", "label": "First Name", "input": true, "validate": { "required": true } },
        { "type": "textfield", "key": "lastName", "label": "Last Name", "input": true, "validate": { "required": true } },
        { "type": "email", "key": "email", "label": "Email", "input": true, "validate": { "required": true } },
        { "type": "textfield", "key": "company", "label": "Company", "input": true },
        { "type": "textfield", "key": "title", "label": "Job Title", "input": true },
        {
          "type": "select", "key": "stage", "label": "Stage", "input": true, "dataSrc": "values", "defaultValue": "lead",
          "data": { "values": [
            { "label": "Lead", "value": "lead" },
            { "label": "Qualified", "value": "qualified" },
            { "label": "Customer", "value": "customer" },
            { "label": "Lost", "value": "lost" }
          ] },
          "validate": { "required": true }
        },
        { "type": "textarea", "key": "notes", "label": "Notes", "input": true },
        {
          "type": "number", "key": "leadScore", "label": "Lead Score", "input": true, "disabled": true,
          "description": "Calculated by the server when the contact is saved. Never ask the user for it."
        },
        { "type": "button", "key": "submit", "label": "Submit", "input": true, "action": "submit" }
      ],
      "access": [
        { "type": "read_all", "roles": ["administrator", "authenticated", "anonymous"] }
      ],
      "submissionAccess": [
        { "type": "create_all", "roles": ["administrator", "authenticated"] },
        { "type": "read_all", "roles": ["administrator", "authenticated"] },
        { "type": "update_all", "roles": ["administrator", "authenticated"] },
        { "type": "delete_all", "roles": ["administrator"] }
      ]
    }
  },
  "actions": {
    "contact:save": {
      "title": "Save Submission",
      "name": "save",
      "form": "contact",
      "priority": 10,
      "method": ["create", "update"],
      "handler": ["before"]
    },
    "contact:leadScore": {
      "title": "Lead Score",
      "name": "leadScore",
      "form": "contact",
      "priority": 20,
      "method": ["create", "update"],
      "handler": ["before"],
      "settings": {
        "sourceFields": "title, notes",
        "rules": [
          { "keyword": "budget", "points": 30 },
          { "keyword": "decision maker", "points": 25 },
          { "keyword": "director", "points": 15 },
          { "keyword": "this quarter", "points": 20 }
        ]
      }
    }
  },
  "access": [
    { "type": "read_all", "roles": ["administrator", "authenticated", "anonymous"] }
  ]
}
```

### tools/pipelineSummary.js

The tool only reads, so it is annotated read-only, which also lets a task list it in `uagTools`. It counts with the caller's identity, so a user only counts the contacts they may read.

```js
const { z } = require('zod');

const STAGES = ['lead', 'qualified', 'customer', 'lost'];

/**
 * crm_pipeline_summary: how many contacts are at each stage. It only reads,
 * so it is annotated read-only and a task may list it in `uagTools`.
 */
module.exports = {
    name: 'crm_pipeline_summary',
    title: 'CRM pipeline summary',
    description: 'Count the contacts at each pipeline stage (lead, qualified, customer, lost), for every company or for one. Use this when the user asks how many leads, prospects or customers there are.',
    annotations: {
        title: 'CRM pipeline summary',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
    },
    inputSchema: {
        company: z.string().optional().describe('Count only the contacts at this company (exact name).')
    },
    async execute({ company }, extra) {
        // The caller's identity. Its project is the UAG project serving the request.
        const auth = extra.authInfo;
        const project = extra.project;
        const form = await project.getForm('contact');
        if (!form) {
            return project.mcpResponse('formNotFound', { formName: 'contact' }, true);
        }
        if (!auth.formPermissions(form).read) {
            return { content: [{ type: 'text', text: 'You do not have permission to read contacts.' }], isError: true };
        }
        const counts = [];
        for (const stage of STAGES) {
            const query = { 'data.stage': stage, ...(company && { 'data.company': company }) };
            // Counted with the caller's permissions: Form.io applies them.
            counts.push({ stage, count: await form.count(query, auth) });
        }
        return project.mcpResponse('crmPipelineSummary', {
            company: company || null,
            counts,
            total: counts.reduce((sum, row) => sum + row.count, 0)
        });
    }
};
```

### templates/crmPipelineSummary.md

```markdown
## Pipeline<% if (company) { %> for <%= company %><% } %>

<%= total %> contact(s):
<% counts.forEach(function(row) { %>
- **<%= row.stage %>**: <%= row.count %><% }); %>

Report these numbers as they are. To list the contacts at one stage, call `find_submissions` on the `contact` form with a `search_query` on `stage`.
```

For `{ company: 'Acme' }` with three leads, two qualified contacts and one customer, the model receives:

```markdown
## Pipeline for Acme

6 contact(s):

- **lead**: 3
- **qualified**: 2
- **customer**: 1
- **lost**: 0

Report these numbers as they are. To list the contacts at one stage, call `find_submissions` on the `contact` form with a `search_query` on `stage`.
```

### actions/leadScore.js

The action runs before the save, so its result is part of what the UAG forwards to Form.io. It reads the configured fields and writes the total of the matching keywords' points to `leadScore`. Its handler is fixed to `before`; the methods can be changed per instance.

```js
/**
 * Lead Score: before a contact is saved, add up the points of each keyword
 * found in its source fields and write the total to `leadScore`.
 */
module.exports = {
    get info() {
        return {
            name: 'leadScore',
            title: 'Lead Score',
            description: 'Scores a contact from keywords in its fields, before it is saved.',
            // Among the before actions, higher priorities run first.
            priority: 20,
            defaults: {
                handler: ['before'],
                method: ['create', 'update']
            },
            // Scoring only makes sense before the save.
            access: {
                handler: false,
                method: true
            }
        };
    },

    /** The settings each instance of the action is configured with. */
    async settingsForm(form) {
        return [
            {
                type: 'textfield',
                key: 'sourceFields',
                label: 'Fields to read',
                description: 'Comma-separated data paths.',
                defaultValue: 'title, notes',
                input: true
            },
            {
                type: 'datagrid',
                key: 'rules',
                label: 'Keywords',
                input: true,
                components: [
                    { type: 'textfield', key: 'keyword', label: 'Keyword', input: true },
                    { type: 'number', key: 'points', label: 'Points', input: true }
                ]
            }
        ];
    },

    /**
     * Runs when the form's handlers are built (per chain, handler and
     * method), not per request: prepare everything here.
     */
    async executor(form, action, handler, method) {
        const settings = action.settings || {};
        const fields = String(settings.sourceFields || '').split(',').map((field) => field.trim()).filter(Boolean);
        const rules = (settings.rules || [])
            .filter((rule) => rule && rule.keyword)
            .map((rule) => ({ keyword: String(rule.keyword).toLowerCase(), points: Number(rule.points) || 0 }));

        return async (req, res, next) => {
            // In a "before" handler, req.submission is what will be saved.
            const data = req.submission && req.submission.data;
            if (!data) return next();
            const text = fields.map((field) => String(data[field] || '')).join(' ').toLowerCase();
            data.leadScore = rules.reduce((score, rule) => (text.includes(rule.keyword) ? score + rule.points : score), 0);
            next();
        };
    }
};
```

A contact with the job title "Director of IT" and the note "Has budget approved for this quarter." scores 15 + 30 + 20 = 65.

### Run it

This compose file runs Form.io Open Source, MongoDB and the UAG with the module mounted. Replace every `CHANGEME`, and set `LICENSE_KEY` in your shell to a license that includes the UAG, which the UAG's database needs.

```yaml
services:
  mongo:
    image: mongo
    restart: always
    # The UAG's database (MCP sign-in) needs a license that includes the UAG (LICENSE_KEY).
    networks:
      default:
        aliases: [mongo.local]
    volumes:
      - crm-data:/data/db

  formio:
    image: formio/formio
    restart: always
    networks:
      default:
        aliases: [formio.local]
    depends_on:
      - mongo
    ports:
      - "3001:3001"
    environment:
      NODE_CONFIG: '{"mongo": "mongodb://mongo:27017/formio", "jwt": {"secret": "CHANGEME"}, "mongoSecret": "CHANGEME"}'
      ROOT_EMAIL: admin@example.com
      ROOT_PASSWORD: CHANGEME
      ADMIN_KEY: CHANGEME

  formio-uag:
    image: formio/uag
    restart: always
    depends_on:
      - formio
    ports:
      - "3200:3200"
    volumes:
      - ./module:/app/module
    environment:
      PORT: 3200
      PROJECT: http://formio.local:3001
      ADMIN_KEY: CHANGEME
      JWT_SECRET: CHANGEME
      # Browser sign-in for remote MCP clients, with its codes in the UAG's database,
      # which needs a license that includes the UAG.
      LICENSE_KEY: ${LICENSE_KEY:-}
      MCP_OAUTH: "true"
      MONGO: mongodb://mongo.local:27017
      # The login form the browser renders on /auth/authorize.
      LOGIN_FORM: http://localhost:3001/user/login
      DEBUG: formio:*

volumes:
  crm-data:
```

```bash
docker compose up -d
docker compose logs -f formio-uag
```


When the UAG starts, it installs the Contact resource and its two actions into the project, then serves them. Connect an MCP client to `http://localhost:3200/mcp` (see [Connect Claude](/developers/connect-claude)), sign in, and try:

- "Add a contact: Dana Reyes, dana@example.com, Director of Operations at Acme. She has budget for this quarter."
- "How does the pipeline look for Acme?"
- "Move Dana Reyes to qualified."

The first request ends in `submit_completed_form`; before the save, Lead Score sets `leadScore` to 65. The second calls `crm_pipeline_summary` with `company: "Acme"`. The third uses `find_submissions` and `submission_update`, and Lead Score runs again on the update.

To use the module from your own server instead, `server.use(require('./module'))` (see [Node.js API](/developers/node-api)).

## Next steps

- [Form properties](/developers/form-properties): tasks, criteria and agent fields on the forms in your template.
- [MCP tools](/developers/mcp-tools): the built-in tools your module works with.
- [Engines and routing](/developers/engines): add Agent API engines in `config`.
