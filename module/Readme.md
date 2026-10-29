# UAG modules

<sub>[Form.io UAG](../README.md) &rsaquo; this page</sub>

A **module** is a JavaScript object that configures the UAG for a domain. It can give the project the forms and resources the use case needs, add MCP tools, change what the built-in tools say to the model, add form actions, and replace the login page. This folder holds the empty module the `formio/uag` image starts with; mount your own over it.

The complete guide, with a worked CRM module, is [Modules](https://ai.form.io/developers/modules) ([source](../demo/content/developers/modules.md)). A runnable example is [`demo/samples/custom-module`](../demo/samples/custom-module).

## Load a module

| Where | How |
|---|---|
| Docker | Mount it over `/app/module`: `-v "$PWD/module:/app/module"`, or `volumes: ["./module:/app/module"]` in Compose. |
| The `uag` command | `UAG_MODULE=./module npx uag` (a file or folder, resolved against the working directory). |
| Your own server | `server.use(require('./module'))` before `await server.router()`. Several modules can be used; their `config` objects merge, later ones winning. |

A module mounted into the image runs inside the UAG's own installation, so it can `require()` the UAG's dependencies (`zod`, `lodash`) but not `@formio/uag` itself.

## The module object

```js
module.exports = {
    config: {
        template: require('./project.json'),   // forms, resources, roles and actions the project needs
        tools: [],                             // custom MCP tools (ToolInfo objects)
        toolOverrides: {},                     // changes to built-in tools, by tool name
        responseTemplates: {},                 // replaced or new response templates, by name
        auth: { authAppHtml: undefined },      // the HTML of the /auth/authorize login page
        engines: undefined,                    // Agent API engine instances; overrides UAG_ENGINES
        engineTypes: {},                       // engine types this module provides, by type name
        routing: {}, agentApi: {},             // engine routing, thresholds, timeouts, rate limits
    },
    actions: {},                               // custom form actions, by action name
    hooks: {},                                 // middleware around submission requests and actions
};
```

| Key | What to know |
|---|---|
| `config.template` | A Form.io project template (an Open Source `/export`, or an Enterprise **Export Template**). Only what the project is missing is installed, matched by key; nothing the project has is changed. `TEMPLATE_SYNC` sets when: `boot` (default), `refresh`, or `off`. Tag forms `uag` so agents see them. |
| `config.tools` | Each entry is a `ToolInfo` object: `name` (snake_case, unique), `description`, `inputSchema` (a Zod raw shape), `annotations`, and `execute(args, extra)`. A tool without `annotations` is treated as one that writes; only read-only tools can be listed in a task's `uagTools`. Get the project from `extra.authInfo.project`. |
| `config.toolOverrides` | Merged over the built-in tool with Lodash `defaultsDeep`, so the fields you set win and the rest stay. `{ name: '' }` removes a tool. |
| `config.responseTemplates` | Lodash templates keyed by name. A built-in name (the files in [`src/templates`](../src/templates)) replaces that template; any other name adds one your tools render with `project.mcpResponse(name, data)`. See the [template example](../demo/samples/custom-module/module/templates/Readme.md). |
| `config.auth.authAppHtml` | Replaces the login page with your own HTML (or set `AUTHORIZE_HTML`). `LOGIN_FORM` still names the Form.io login form the page renders. |
| `actions` | Each action has `info`, `settingsForm(form)` and `executor(form, action, handler, method)`, which returns Express middleware. In a `before` handler, change `req.submission`; in an `after` handler, read `res.resource.item`. Actions run for submissions saved through the UAG, not for those saved directly to Form.io. |
| `config.engines`, `config.engineTypes` | Engines are enabled here or in `UAG_ENGINES`, never by a top-level `engines` key on the module. See [Engines and routing](../README.md#engines-and-routing). |

Every other `config` key is a server option, such as `cors` or `templateSync`; see the [Node.js API](https://ai.form.io/developers/node-api).
