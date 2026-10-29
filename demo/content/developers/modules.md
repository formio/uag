---
title: Modules
description: Package forms, MCP tools, actions, response templates and a login page into a module that configures the UAG for your domain.
section: Extend
order: 20
---

A module is a JavaScript object that extends the UAG. It can give the project the forms and resources your use case needs, add MCP tools, add form actions, change what the built-in tools say to the model, and replace the login page. One module can be mounted into the Docker image, loaded by the `uag` command, or passed to `server.use()` in your own server, and published to npm for others to use.

This page describes each part of a module, then builds a complete one: a small CRM with a Contact resource, a pipeline tool and a lead-scoring action.

## The module object

```ts
type UAGModule = {
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
| `config.responseTemplates` | Replacements for the built-in response templates, and new templates for your tools. | [Response templates](#response-templates) |
| `config.auth.authAppHtml` | The HTML of the login page for remote MCP sign-in (`MCP_OAUTH`). | [The login page](#the-login-page) |
| `actions` | Custom form actions, by name. | [Custom actions](#custom-actions) |
| `hooks` | Middleware added around submission requests and actions. | [Hooks](#hooks) |
| `config.engines`, `config.engineTypes`, `config.routing`, `config.agentApi` | Engines and how fields are routed to them. | [Engines and routing](/developers/engines) |
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

A mounted module runs inside the UAG's own installation in `/app`, so `require()` finds the UAG's dependencies, such as `zod` and `lodash`, from `/app/node_modules`. It cannot `require('@formio/uag')` by name: the image is that package. The examples on this page therefore spell out annotations as plain objects rather than importing the `reads()` preset. A module that needs its own dependencies can bring them in its own `node_modules` folder.

### With the uag command

```bash
UAG_MODULE=./module npx uag
```

`UAG_MODULE` names a file or folder, resolved against the working directory.

### In your own server

```js
const { UAGServer } = require('@formio/uag');
const server = new UAGServer();
server.use(require('./module'));
app.use(await server.router());
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

Each entry in `config.tools` is a tool object, `ToolInfo`:

```ts
type ToolInfo = {
    name?: string;                     // snake_case, unique across all tools
    title?: string;
    description?: string;              // what the tool does, and when the model should call it
    inputSchema?: ZodRawShape;         // { argument: zod schema }
    annotations?: ToolAnnotations;     // whether it reads or writes
    execute?: (args: any, extra: { authInfo: AuthRequest; [key: string]: any }) => Promise<CallToolResult>;
};

interface ToolAnnotations {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
}
```

A tool without a `name` is skipped. Names must be unique: a custom tool with a built-in tool's name makes the MCP server fail to build, and every `/mcp` request with it. The built-in names are listed under [Overriding built-in tools](#overriding-built-in-tools).

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

`openWorldHint` is `true` in all three. In a module mounted into the Docker image, write the object out instead (see [In Docker](#in-docker)):

```js
annotations: { title: 'CRM pipeline summary', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
```

### execute(args, extra)

`execute` receives the validated arguments and `extra`, whose `authInfo` is the caller's `AuthRequest`. The same tool runs for MCP clients and for Agent API research, and in both cases `authInfo` is the identity the work runs as.

| You need | Use |
|---|---|
| The project | `extra.authInfo.project` (a `UAGProjectInterface`). In your own server, `server.uagProject` is the same object. |
| A form | `await project.getForm('contact')`, by machine name, name or id. `null` when it does not exist. |
| The caller's permissions | `extra.authInfo.formPermissions(form)`: `{ create, read, update, delete }`. |
| Submissions | `form.find(query, auth)`, `form.count(query, auth)`, `form.loadSubmission(id, auth)`. Pass `extra.authInfo` so Form.io applies the caller's permissions. |
| To save | `form.submit(form.convertToSubmission(values), auth)`: runs the form's create or update chain, hooks and actions included, and forwards the submission to Form.io. An optional third argument adds fields to the request the chain's middleware sees. |
| A response | `project.mcpResponse(templateName, data, isError?)` (rendered template), or `project.mcpJSONResponse(data, isError?)` (JSON text plus `structuredContent`). |

`execute` returns an MCP tool result, `{ content: [{ type: 'text', text }], isError? }`. Report failures the model can act on (a missing form, no permission, a bad argument) as a result with `isError: true` and a sentence that says what to do next. A thrown exception also reaches the client as an error result, with the exception's message as its text, so do not let messages that carry URLs, keys or internal details escape.

The full methods of the project and form interfaces are in [Node.js API](/developers/node-api#the-project-uagprojectinterface).

### Tools in the Agent API

The Agent API offers tools to agent engines for research when a task's criteria component lists them in `uagTools`. Custom tools qualify when they are annotated read-only. Each is converted for the engine: its Zod shape becomes a JSON schema, arguments the model sends are validated with the same schema, and the call runs in process with the caller's identity. A remote engine on an engine server calls the same tools back over `/mcp` with a scoped token that lists only them. See [Engine server](/developers/engine-server#research-and-scoped-tokens).

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
| `agent_provide` | A task's fields and criteria for the agent to fill (`agent_provide_data` is its deprecated name, and an override under that key also applies to `agent_provide` when `agent_provide` has none). |
| `agent_decide` | A task's decision questions as JSON. |
| `fetch_external_data` | Options for resource, URL-backed select and data source fields. |

What each tool does is covered in [MCP tools](/developers/mcp-tools). The useful overrides are `description` and `title`, which change how the model uses a tool. Overriding `execute` replaces the implementation. `inputSchema` is merged key by key into Zod objects; to change a tool's arguments, write a custom tool instead.

Because only tools with a name are registered, `{ name: '' }` removes a built-in tool:

```js
toolOverrides: { fetch_external_data: { name: '' } }
```

## Response templates

Every built-in tool answers the model with a rendered [Lodash template](https://lodash.com/docs/4.17.15#template). Templates are Markdown with `<%= value %>` (insert), `<%- value %>` (insert, HTML-escaped) and `<% code %>` (JavaScript, for loops and conditions); `_` is Lodash inside a template.

`config.responseTemplates` maps template names to template source. A name that matches a built-in template replaces it; any other name adds a template your tools can render with `project.mcpResponse(name, data)`. The built-in templates are the `.md` files in [`src/templates`](https://github.com/formio/uag/blob/main/src/templates), one per name.

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

To change a built-in template, copy its file from `src/templates` and edit it. The data it receives is whatever its tool passes; read the tool in [`src/tools`](https://github.com/formio/uag/blob/main/src/tools) for the exact shape. For example, `get_forms` renders `getAvailableForms` with:

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
| `fetchExternalData`, `fetchExternalDataError`, `formData`, `fieldValidationErrors` | `fetch_external_data` |
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

1. **Building.** When a form's submission chain is built, `executor` is called once for each action instance on the form, for each handler and method it is configured for. This happens at startup, and again on the next use after a `PROJECT_TTL` refresh brings a changed project. Do slow work here: read settings, create clients, compile patterns.
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
| `form:action`, `<handler>:form:action`, `<handler>:form:action:<method>`, `<handler>:form:<actionName>:<method>`, `<handler>:<formName>:<actionName>:<method>` | Just before each matching action instance. |

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

The `AUTHORIZE_HTML` environment variable does the same with the HTML itself as its value.

A replacement page must:

1. Load `config.js` (relative to `/auth/authorize`, so `/auth/config.js`). It sets `window.authConfig = { loginForm, authEndpoint: '/auth/authorize' }`.
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

The UAG answers `400` when `jwt` or `code_challenge` is missing or the `redirect_uri` is not allowed, and `401` when the Form.io project does not confirm the token. The [custom module example's `authorize.html`](https://github.com/formio/uag/blob/main/demo/samples/custom-module/module/authorize.html) is a complete page to start from: a Bootstrap layout around the same login flow.

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
        const project = auth.project;
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
     * Runs once per form, handler and method when the form's handlers are
     * built, not per request: prepare everything here.
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

This compose file runs Form.io Open Source, MongoDB and the UAG with the module mounted. Replace every `CHANGEME`.

```yaml
services:
  mongo:
    image: mongo
    restart: always
    # Development host names (*.local): the project and the UAG's database are both
    # on development hosts, so the UAG may use its database without a license.
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
      # Browser sign-in for remote MCP clients, with its codes in the UAG's database.
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
