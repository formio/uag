---
title: Node.js API
description: Embed the UAG in your own Node.js and Express application with UAGServer, and reach its project, forms and tools from your code.
section: Extend
order: 10
---

The `formio/uag` Docker image is one way to run the UAG. The other is to embed it: install `@formio/uag` from npm, create a `UAGServer`, and mount its router in an Express application you own. You then control the process, the configuration and the modules, and your own routes run next to `/mcp` and `/agent/*`.

This page covers the `UAGServer` class and its configuration, modules, the project and form interfaces your code and custom tools work with, the package's exports, and the `uag` command. For what goes inside a module, see [Modules](/developers/modules). For engines, see [Engines and routing](/developers/engines).

## Requirements

| Requirement | Why |
|---|---|
| Node.js 22 or later | `@formio/uag`, `@formio/appserver-core` and every engine package declare `"node": ">=22.0.0"`. |
| `--no-node-snapshot` | Form logic (conditionals, calculated values, custom validation) runs in `isolated-vm`, which needs Node's startup snapshot turned off. Pass it to `node`, or set `NODE_OPTIONS=--no-node-snapshot`. The `uag` command adds it for you. |
| A Form.io project | `PROJECT` must point at a reachable Open Source server (with `ADMIN_KEY`) or an Enterprise project (with `PROJECT_KEY` and a `LICENSE_KEY`). Without one, `router()` throws. |
| `BASE_URL` and `JWT_SECRET` | The authentication endpoints (`/auth/*`, `/.well-known/*`) need `BASE_URL`, and tokens the UAG issues are signed with `JWT_SECRET`. See [Deployment](/developers/deployment). |

## Install

```bash
npm install @formio/uag express dotenv
# Engines are separate packages. Install the ones you will enable:
npm install @formio/uag-jev @formio/uag-claude
```

`isolated-vm` compiles a native module on install, so build images need `make`, `python3` and `g++` (on Alpine: `apk add make python3 g++`).

## A minimal server

```js
// server.js
require('dotenv/config');
const express = require('express');
const { UAGServer } = require('@formio/uag');

async function main() {
    const server = new UAGServer();
    const app = express();
    // Loads the project, installs the module template, enables the engines
    // and mounts /mcp, /agent/*, /auth/* and the project routes.
    app.use(await server.router());
    const port = process.env.PORT || 3200;
    app.listen(port, () => console.log(`UAG on http://localhost:${port}`));
}

main().catch((err) => {
    console.error('Failed to start the UAG:', err);
    process.exit(1);
});
```

```bash
PROJECT=http://localhost:3001 ADMIN_KEY=CHANGEME JWT_SECRET=CHANGEME \
BASE_URL=http://localhost:3200 node --no-node-snapshot server.js
```

`require('dotenv/config')` loads a `.env` file from the working directory, as the `uag` command does.

> **Note:** Mount the router at the root of your application (`app.use(router)`, not `app.use('/uag', router)`). MCP clients look for `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` at the root of `BASE_URL`, and the login page posts to the absolute path `/auth/authorize`.

## A server with a module, engines and your own routes

```js
// server.js
require('dotenv/config');
const express = require('express');
const { UAGServer } = require('@formio/uag');
const crm = require('./module');            // see /developers/modules

async function main() {
    const server = new UAGServer({
        // Instances to enable. This list replaces UAG_ENGINES when it is set.
        engines: [
            'jev',
            { name: 'deep', type: 'claude', options: { model: 'claude-opus-5-5', researchEffort: 'high' } },
        ],
        routing: { value: ['deep'], timeouts: { jev: 2000, deep: 60000 } },
        agentApi: { threshold: 0.6 },
    });
    server.use(crm);

    const app = express();
    // Your routes first, so they win over the UAG's catch-all project routes.
    app.get('/healthz', (req, res) => res.json({ ok: true }));
    app.use(await server.router());

    // Once router() has resolved, the project is loaded.
    console.log('Forms the UAG exposes:', server.uagProject.formNames.join(', '));
    app.listen(process.env.PORT || 3200);
}

main().catch((err) => {
    console.error('Failed to start the UAG:', err);
    process.exit(1);
});
```

The UAG's router ends with the project routes and an admin passthrough to the Form.io server, which answer for most paths. Register your own routes before `app.use(await server.router())`.

## What router() does

`await server.router()` does all of the startup work, in this order. Any step that fails rejects the promise, so a misconfigured server stops before it serves anything.

1. Connects to `PROJECT`, retrying with backoff (`retries`, `retryDelay`) while the project is unreachable, for example while a Form.io container in the same compose file is still starting.
2. Installs the module's project template, when `templateSync` allows it (see [Modules](/developers/modules#the-project-template)).
3. Loads the project's forms and resources, and registers every form tagged `uag`.
4. Enables the engines named in `config.engines`, or else `UAG_ENGINES`. An engine that is not installed, has a missing setting or a duplicate name stops startup, with the instance named in the error.
5. Logs the edition (Open Source or Enterprise) and whether Agentic Formflow is licensed.
6. Returns an Express `Router` with the routes below.

```pipeline
connect to PROJECT, with retries -> sync the module's template -> load the tagged forms -> load the engines -> log the edition -> mount the routes*
```

| Route | Served by | Purpose |
|---|---|---|
| `POST /mcp`, `GET /mcp` | `UAGRouter` | The MCP endpoint (Streamable HTTP, stateless: a new MCP server per request). Needs a bearer token. See [MCP tools](/developers/mcp-tools). |
| `GET /agent/capabilities`, `POST /agent/extract`, `/agent/decide`, `/agent/generate`, `/agent/provide` | `AgentRouter` | The Agent API. Mounted ahead of the project routes. See [Agent API](/developers/agent-api). |
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource` | PKCE provider | OAuth discovery for MCP clients. Only when `BASE_URL` is set. |
| `GET /auth/authorize`, `POST /auth/authorize`, `GET /auth/config.js`, `POST /auth/token`, `POST /auth/register` | PKCE provider | The login page and the OAuth endpoints. |
| `GET /status` | Server | The `status` object (package versions by default). |
| Form and submission paths, admin passthrough | Project router | Form.io's API for the project's forms, and admin requests forwarded to the Form.io server. |

## new UAGServer(config)

```ts
class UAGServer extends Server {
    constructor(config?: UAGConfig);
    use(module: UAGModule): void;
    router(): Promise<Router>;
    /** The loaded UAG project, once router() has built the project router. */
    get uagProject(): UAGProjectInterface | undefined;
    /** CORS exposed headers: the server's, plus X-Request-Id. */
    get exposedHeaders(): string[];
}
```

The constructor checks that exactly one copy of `@formio/appserver-core` 2.20.0 or later is installed, and throws if not (see [assertSingleCore](#public-exports)). It then fills every option you leave out from the environment, so `new UAGServer()` with no arguments configures itself the way the Docker image does.

`UAGConfig` extends the application server's `ServerConfig` with the UAG's own options.

### UAG options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `baseUrl` | `string` | `BASE_URL`, else `''` | The URL clients reach the UAG at. Published in the OAuth discovery documents and used in `WWW-Authenticate` challenges. |
| `responseTemplates` | `UAGTemplateConfig` | `{}` | Lodash templates by name: replacements for built-in response templates, and new ones for your tools. See [Modules](/developers/modules#response-templates). |
| `toolOverrides` | `UAGToolOverride` | `{}` | Per built-in tool, fields merged over its definition (description, title, schema, `execute`). See [Modules](/developers/modules#overriding-built-in-tools). |
| `tools` | `ToolInfo[]` | `[]` | Custom MCP tools, served next to the built-in ones. |
| `engines` | `UAGEngineEntry[]` | `UAG_ENGINES` | Engine instances to enable: `"<type>"`, `"<name>:<type>"`, or `{ name, type, options }`, where `type` may be an engine type definition. When this is an array (even empty), `UAG_ENGINES` is ignored. |
| `engineTypes` | `Record<string, EngineTypeDefinition>` | none | Engine types your application provides, by type name. Resolved before the built-in types and installed packages. |
| `routing` | `UAGRoutingConfig` | `{ decision: ['decision', 'agent'], value: ['agent'] }` | Engine preference lists and per-engine timeouts. See [Engines and routing](/developers/engines#routing). |
| `agentApi` | `UAGAgentApiConfig` | see [Engines and routing](/developers/engines#agent-api-defaults) | Thresholds, timeouts, research limits and rate limits for Agentic Formflow. |
| `loginForm` | `string` | none | Declared on `UAGConfig`, but not read by this version. To change the login form, set `auth.loginForm` (`LOGIN_FORM`); to replace the login page, set `auth.authAppHtml`. See [Modules](/developers/modules#the-login-page). |

### Server options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `project` | `string` | `PROJECT`, else `''` | The project endpoint: the Open Source server URL, or the Enterprise project URL. |
| `projects` | `string[]` | `PROJECTS`, comma-separated | More project endpoints for the application server to load. The UAG serves the first project loaded (`uagProject`); leave this unset. |
| `license` | `string` | `UAG_LICENSE` | A license checked before `LICENSE_KEY`, which is always read too: a feature is on when either grants it. Prefer `LICENSE_KEY`. A license that includes the UAG enables Agentic Formflow and covers running against an Enterprise project. |
| `licenseRemote` | `boolean \| string` | `LICENSE_REMOTE` | Validate the license key with the license server. |
| `licenseServer` | `string` | `LICENSE_SERVER`, else the built-in license server | The license server's URL. |
| `submissionProxy` | `boolean \| string` | `true` | Where submissions go. `true` proxies them to the project's own submission API; a URL proxies them there; `false` uses `db`. |
| `processAsClient` | `boolean` | `true` | Evaluate form logic as a client would (the `processAsClient` flag in the evaluation context). |
| `ttl` | `number` (seconds) | `PROJECT_TTL`, else `900` | How often the project is re-read for changed forms and actions. `0` means never: only a restart picks up changes. |
| `templateSync` | `'boot' \| 'refresh' \| 'off'` | `TEMPLATE_SYNC`, else `'boot'` | When the module's project template is installed. See [Modules](/developers/modules#the-project-template). |
| `template` | `ProjectTemplate` | none | The project template the module needs the project to have. Usually set by a module. |
| `retries` | `number` | `PROJECT_RETRIES`, else `5` | Attempts to load the project at startup. Also used by `remote` engines to describe themselves. |
| `retryDelay` | `number` (ms) | `PROJECT_RETRY_DELAY`, else `5000` | First delay between attempts, doubled each time. |
| `cors` | `CorsOptions \| boolean \| string` | `CORS`, else `'true'` | `true` allows every origin, `false` turns CORS off, any other string is the allowed origin, an object is passed to the `cors` package. |
| `maxBodySize` | `string` | `MAX_BODY_SIZE`, else `'100mb'` | The JSON body limit for the server's routes. The Agent API has its own limit of 5 MB. |
| `cache` | `boolean` | `PROJECT_CACHE`, else `true` | With a database, store each project load there and fall back to it when the project cannot be loaded. |
| `db` | `DBConfig` | from `MONGO` and `MONGO_CONFIG` | Enterprise only: read and write submissions in MongoDB directly instead of proxying them. |
| `status` | `any` | the package versions | The body of `GET /status`. |
| `auth` | `AuthConfig` | see below | Credentials and the login flow. |

### auth options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `adminKey` | `string` | `ADMIN_KEY` | Open Source: the server's admin key. Also accepted as `x-admin-key` on the Agent API. |
| `projectKey` | `string` | `PROJECT_KEY` | Enterprise: the project's API key. Also accepted as `x-token` on the Agent API. |
| `secret` | `string` | `JWT_SECRET`; a random value per process when unset | Signs the tokens the UAG issues, and scoped tokens for remote research. Set it: a random secret invalidates every token at each restart. |
| `expire` | `number` (minutes) | `JWT_EXPIRE_TIME`, else `3600` | Lifetime of the tokens the UAG issues. |
| `portal` | `string` | `PORTAL_SECRET` | Enterprise: lets the Form.io portal connect to the UAG. |
| `pkce` | `boolean` | `true` | The OAuth (PKCE) provider that MCP clients authenticate with. |
| `loginForm` | `string` | `LOGIN_FORM`, else `<PROJECT>/user/login` | The login form's JSON URL, loaded by the browser on `/auth/authorize`. |
| `authAppHtml` | `string` | the built-in page | The HTML of the `/auth/authorize` page. See [Modules](/developers/modules#the-login-page). |
| `oidc` | `OIDCConfig` | from `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPE` (`openid profile email`), `OIDC_RESPONSE_TYPE` (`code`), `OIDC_RESPONSE_MODE` (`query`) | An OpenID Connect provider for sign-in. |
| `local` | `LocalAuthConfig` | none | Local login settings: `userfield`, `passfield`, `allowedAttempts`, `lockWait`, `attemptWindow`, `resources`. |

### Where a value comes from

For each option, the first of these wins:

1. A module's `config`, passed to `server.use()`. Modules are merged into the configuration with Lodash `merge`, so a later module overrides an earlier one key by key.
2. The object you pass to `new UAGServer(config)`.
3. The environment variable in the tables above.
4. The default.

> **Warning:** `merge` combines arrays element by element. If two modules both set `config.tools`, the second module's first tool is merged into the first module's first tool. Combine tool lists yourself and pass one array:
>
> ```js
> server.use({ config: { tools: [...crm.config.tools, ...billing.config.tools] } });
> ```

## server.use(module)

```ts
type UAGModule = ServerModule & { config?: UAGConfig };

type ServerModule = {
    config?: ServerConfig;
    db?: ServerDB;
    providers?: ProviderInterfaceLibrary;
    actions?: Record<string, Action>;
    processors?: AppServerProcessors;
    hooks?: Record<string, HookFn | HookFn[]>;
    ProjectInterface?: typeof ProjectInterface;
    FormInterface?: typeof FormInterface;
};
```

`use()` applies a module to the server: it merges `config`, adds `actions`, `providers` and `processors`, registers `hooks`, and sets `db`. Call it before `router()`: the project, its tools and its response templates are built from the configuration at startup.

`ProjectInterface` and `FormInterface` replace the classes the server builds the project and its forms from. The `UAGServer` constructor installs `UAGProjectInterface` and `UAGFormInterface`; a module that replaces them must extend the UAG's classes, or the UAG loses its MCP tools and Agent API. What each part of a module does is covered in [Modules](/developers/modules).

## The project: UAGProjectInterface

`server.uagProject` is the loaded project, an instance of `UAGProjectInterface`. Custom tools reach the same object through the caller's identity (`extra.authInfo.project`, see [Modules](/developers/modules#custom-mcp-tools)).

```ts
class UAGProjectInterface extends ProjectInterface implements FormflowHost {
    /** The UAG configuration (the merged module config). */
    get config(): UAGConfig;
    /** Every form and resource the project has, by machine name. */
    forms: Record<string, FormInterface>;
    /** The names of the forms tagged "uag". */
    get formNames(): string[];
    /** A form by machine name, name or id, or null. */
    getForm(nameOrId?: string): Promise<FormInterface | null>;
    /** The response templates (built at startup from responseTemplates and the built-ins). */
    uagTemplate: UAGTemplate | null;
    /** An MCP tool result whose text is a rendered response template. */
    mcpResponse(template: ResponseTemplate, data?: object, isError?: boolean): { content: { type: 'text'; text: string }[]; isError?: true };
    /** An MCP tool result carrying `data` as JSON text and as structuredContent. */
    mcpJSONResponse(data?: object, isError?: boolean): { content: { type: 'text'; text: string }[]; structuredContent: object; isError?: true };
    /** The engines enabled at startup. */
    engines: EngineRegistry;
    /** A fresh MCP server with every tool registered; a scope narrows it to read-only tools. */
    buildMcpServer(scope?: Pick<ScopedTokenClaims, 'tools'>): Promise<McpServer>;
    /** /mcp, and unless excluded, the Agent API. */
    uagRouter(includeAgentApi?: boolean): Router;
    /** The Agent API's routes under /agent. */
    agentRouter(): Router;
    /** Authenticate a /mcp request: a UAG bearer token or a scoped token. */
    authorizeRequest(req: SubmissionRequest, res: Response, next: NextFunction): Promise<void>;
    // FormflowHost: what Agentic Formflow reads from the host.
    formflowEngines(): EngineRegistry;
    formflowConfig(): FormflowConfig;
    formflowForm(name: string): Promise<FormflowForm | null>;
    formflowTools(): Promise<FormflowTool[]>;
}
```

`mcpResponse` takes a template name. Custom template names are not members of the `ResponseTemplate` enum; in TypeScript, cast them (`'crmPipelineSummary' as ResponseTemplate`), in JavaScript pass the string. Rendering a name that is neither in `responseTemplates` nor a built-in template throws `Failed to render template '<name>': Template '<name>' not found`.

Tools are built for every MCP request (`buildMcpServer`), so `toolOverrides` and `tools` are read each time. Response templates are read when the project initializes at startup, and each is compiled once and cached.

## Forms: UAGFormInterface

Every form and resource is a `UAGFormInterface`. A form tagged `uag` has `uag` set; its agent tasks are in `uagFields`.

```ts
class UAGFormInterface extends FormInterface implements FormflowForm {
    /** The form's UAG registration, or null when it is not tagged "uag". */
    uag: { name: string; title: string; description?: string; machineName?: string } | null;
    /** The form's tasks, by task name: criteria, fields, inputs and task settings. */
    uagFields: Record<string, UAGFields>;
    /** The form definition. */
    form: AppServerForm;

    // Reading and writing submissions, with the caller's permissions.
    find(query: Record<string, any>, auth?: AuthRequest): Promise<{ items: Submission[]; count: number; skip: number; limit: number }>;
    count(query: Record<string, any>, auth?: AuthRequest): Promise<number>;
    loadSubmission(id: string, auth?: AuthRequest): Promise<Submission | null>;
    /** Run the create (no _id) or update chain, actions included, and return the saved submission. */
    submit(submission: any, auth: AuthRequest): Promise<Submission | null>;

    // Fields and data.
    /** The fields still to collect, required and optional, with their rules and any validation errors. */
    getFields(submission: Submission, auth: AuthRequest, within?: string | string[]): Promise<FormFieldInfo>;
    getComponent(path: string): Component | undefined;
    getComponentInfo(component: Component, path: string): UAGComponentInfo;
    validateData(submission: Submission, auth: AuthRequest): Promise<FormFieldError[]>;
    /** Flat { "data.path": value } pairs to a submission. Comma-separated strings become select boxes or multi-values. */
    convertToSubmission(data?: Record<string, any>): Submission;
    /** A submission's values in form order, labeled, for templates. */
    formatData(data?: DataObject): UAGData;
    formatSubmission(submission: Submission): UAGSubmission;
    inputComponent(component: Component): boolean;
    isNestedComponent(component: Component): boolean;
}
```

Queries use Form.io's submission query syntax: `{ 'data.stage': 'lead' }`, `{ 'data.email__regex': '/@example\\.com$/i' }`, operators such as `__gt`, `__lt`, `__in`, `__ne`, and `limit`. Pass the caller's `AuthRequest`: with the default submission proxy, the request goes to Form.io with the caller's own token, so Form.io's permissions apply.

The types the form methods return:

```ts
type UAGComponentInfo = {
    path: string; label: string; type: string; format: string; description: string;
    validation: any; options?: { label: string; value: string }[];
    prompt?: string; nested?: boolean; rule?: string;
};
type FormFieldError = { label: string; path: string; error: string };
type FormFieldInfo = {
    rowIndex: number; total: number; totalRequired: number; totalRequiredCollected: number;
    errors: FormFieldError[];
    required: { rules: Record<string, string>; components: UAGComponentInfo[] };
    optional: { rules: Record<string, string>; components: UAGComponentInfo[] };
};
type UAGData = Array<{ label: string; value: any; path: string; prefix?: string }>;
type UAGSubmission = { _id?: string; data: UAGData; created?: string | Date; modified?: string | Date };
type UAGFields = {
    task: string;
    criteria: string;
    components: Record<string, UAGComponentInfo>;
    /** Data paths of the components flagged uagField: "input". */
    inputs?: string[];
    /** Custom properties of the task's criteria component, such as uagEngine and uagTools. */
    settings?: Record<string, string>;
};
```

### The caller: AuthRequest

Tools, actions and Agent API operations receive an `AuthRequest`: who is calling, and what they may do.

| Member | Meaning |
|---|---|
| `project` | The project the request is for. |
| `admin` | `true` for the admin or project key, and for scoped tokens issued for an admin caller. |
| `user` | The signed-in user's submission, or `null`. |
| `formPermissions(form)` | `{ create, read, update, delete }` for this caller on a form. |
| `checkFormMethodAccess(method)` | Whether the caller may perform a method on the request's form. |

## Calling Agentic Formflow in process

The Agent API is a thin HTTP layer over `FormflowService` from `@formio/appserver-core`, which `@formio/uag` re-exports as `Formflow`. Code running in the same process, such as a custom route, can call it directly once `router()` has resolved:

```js
const { Formflow, AuthRequest } = require('@formio/uag');

app.post('/internal/triage', express.json(), async (req, res) => {
    const project = server.uagProject;
    const auth = new AuthRequest(project, true);   // runs as administrator
    const service = Formflow.formflow(project);
    const result = await service.extract(
        { form: 'claim', task: 'triage', text: req.body.description },
        { auth, requestId: req.get('x-request-id'), identity: Formflow.identityOf(auth) }
    );
    res.json(result);   // { tasks, data, fields, errors, excluded, engines }
});
```

The service applies the same license check, permissions, routing, validation and rate limits as the HTTP endpoints, and throws `Formflow.FormflowError` with an HTTP `status` (and `code`) on failure. Its methods are `extract`, `decide`, `generate`, `provide` and `capabilities`, with the request bodies described in [Agent API](/developers/agent-api). `identity` decides who research tools and scoped tokens act as.

## Public exports

`require('@formio/uag')` exports:

| Export | Kind | What it is |
|---|---|---|
| `UAGServer` | class | The server. |
| `UAGModule` | type | `ServerModule & { config?: UAGConfig }`. |
| `assertSingleCore(core?, appserver?, version?)` | function | Throws unless one copy of `@formio/appserver-core` 2.20.0 or later is installed. The constructor calls it. Fix a second copy with `yarn dedupe @formio/appserver-core` (or your package manager's equivalent). |
| `UAGProjectInterface`, `UAGFormInterface` | classes | The project and form interfaces above. |
| `UAGConfig`, `UAGForm`, `UAGTemplateConfig`, `UAGToolOverride`, `UAGEngineEntry`, `UAGRoutingConfig`, `UAGRateLimit`, `UAGAgentApiConfig` | types | Configuration types (`src/config.ts`). |
| `UAGTemplate`, `ResponseTemplate` | class, enum | The response template renderer, and the built-in template names. |
| `UAGRouter(project)` | function | The `/mcp` router on its own. |
| `ToolInfo`, `ToolAnnotations`, `ParentInfo`, `DataUpdate`, `SearchQuery` | types | Tool definition types. |
| `reads(title)`, `creates(title)`, `overwrites(title)` | functions | Annotation presets for tools. |
| `escapeSearchPattern(value)` | function | Escape a literal for a `__regex` query (handles `/`). |
| `getTools(project)` and `getForms`, `getFormFields`, `getFieldInfo`, `collectData`, `confirmSubmission`, `submitCompletedForm`, `findSubmission`, `submissionUpdate`, `fetchExternalData`, `agentProvide`, `agentProvideData`, `agentDecide` | functions | The built-in tool factories: each takes the project and returns its `ToolInfo`. |
| `loadUAGEngines(config?, env?)` | function | Enable engines as `router()` does, returning an `EngineRegistry`. |
| `BUILT_IN_ENGINES`, `RemoteEngine`, `StubDecisionEngine`, `StubAgentEngine`, `MIN_KEY_LENGTH`, `UAG_ROOT` | values | The built-in engine types, the shortest engine server key (32), and the UAG's install root, where engine packages are looked up first. |
| `AgentRouter(project, authenticate)` | function | The Agent API router on its own. |
| Everything from `@formio/appserver` | various | `Server`, `ProjectInterface`, `FormInterface`, `AuthRequest`, `Action`, `ActionInfo`, `SubmissionRequest`, `SubmissionResponse`, `ServerConfig`, `Utils`, `Database`, the `Formflow` namespace and the rest of `@formio/appserver-core`. |

The package's types are in `lib/index.d.ts` (`"types": "lib/index.d.ts"`).

## The uag command

The package installs two commands: `uag`, which starts a server like the Docker image does, and `uag-eval` (see [Evaluation](/developers/evaluation)).

```bash
npx uag                                   # the UAG, no module
UAG_MODULE=./module npx uag               # with a module (a file or a folder)
UAG_ENGINES=claude CLAUDE_API_KEY=... npx uag
```

`uag`:

- loads `.env` from the working directory first, so a module that reads the environment sees it too;
- restarts itself with `--no-node-snapshot` when that flag is in neither the command line nor `NODE_OPTIONS`, forwarding `SIGINT`, `SIGTERM` and `SIGHUP` and exiting with the child's code;
- requires `UAG_MODULE`, resolved against the working directory, and passes it to `server.use()`;
- listens on `PORT` (default `3200`);
- prints the error and exits with code 1 when startup fails.

The Docker image runs `node --no-node-snapshot index.js`, whose `index.js` is the same start-up with the module in `/app/module`:

```js
// index.js in the image
const { start, fail } = require('./bin/uag');
start(require('./module')).catch(fail);
```

`bin/uag.js` also exports `start(module)` and `fail(error)` for scripts that want the same behavior with a module object of their own.

## Running without the snapshot

`isolated-vm`, which evaluates form logic in a sandbox, cannot run with Node's startup snapshot on. The ways to turn it off:

```bash
node --no-node-snapshot server.js
NODE_OPTIONS=--no-node-snapshot node server.js
npx tsx --no-node-snapshot server.ts
```

```dockerfile
ENV NODE_OPTIONS=--no-node-snapshot
```

The `uag` command and the Docker image set it themselves. Test runners need it too: the UAG's own tests run `mocha --no-node-snapshot`.

## Next steps

- [Modules](/developers/modules): forms, tools, actions, templates and the login page.
- [Engines and routing](/developers/engines): enable and route engines.
- [Deployment](/developers/deployment): environment variables, Docker and Kubernetes.
