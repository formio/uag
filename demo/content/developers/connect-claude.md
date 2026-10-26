---
title: Connect Claude
description: Connect Claude Desktop through mcp-remote, or claude.ai through a remote connector, and let Form.io roles and permissions govern what the agent may do.
section: Build
order: 50
---

Claude can use your forms directly. Connected to the UAG, it lists the `uag`-tagged forms a user may use, asks for what each one needs, validates the answers against the form, and saves the submission, all as the user who signed in. Nothing about your forms is written into Claude: the form is the rulebook, read at the moment of use.

This page connects two Claude clients, and shows how Form.io roles decide what the agent may do. It follows the [custom module sample](https://github.com/formio/uag/tree/main/demo/samples/custom-module), a Community Edition project with **Customer** and **Employee** resources where managers onboard employees and employees onboard customers. No license is needed.

| Client | How it connects | What the UAG needs |
|---|---|---|
| **Claude Desktop** (any plan) | A local `mcp-remote` proxy, started by Claude Desktop, connects to the UAG and runs the login flow in your browser | Reachable from your machine; `localhost` is fine |
| **claude.ai and Claude Desktop custom connectors** (plans with connectors) | Anthropic's servers connect to the UAG over the internet | A public HTTPS URL, set as `BASE_URL` |

Either way the user signs in through the UAG's OAuth (PKCE) flow, with the project's own login form, and every tool call runs with that user's Form.io permissions.

## Run the sample

The sample runs Form.io Community Edition, MongoDB, the UAG, and nginx, which serves Form.io and the UAG on one port, `3000`. nginx sends `/mcp`, `/auth` and `/.well-known` to the UAG and everything else to Form.io, so one origin serves the forms, the login page and the MCP endpoint.

```bash
git clone https://github.com/formio/uag.git
cd uag/demo/samples/custom-module
# Replace every CHANGEME in docker-compose.yml first.
docker compose up -d
```

The UAG's settings in that file:

```yaml
  formio-uag:
    image: formio/uag
    volumes:
      - ./module:/app/module        # the module: its forms, roles, actions and templates
    environment:
      PROJECT: http://formio:3001
      ADMIN_KEY: CHANGEME
      JWT_SECRET: CHANGEME
      JWT_EXPIRE_TIME: 525600       # minutes: a year, so a demo login does not expire
      LOGIN_FORM: http://localhost:3000/employee/login
      BASE_URL: http://localhost:3000
      PROJECT_TTL: 10
```

`BASE_URL` is the address clients reach the UAG at, here through nginx. `LOGIN_FORM` is the form the login page loads, here the module's employee login, so the people who sign in are records in the Employee resource.

At startup the UAG installs the module's template: the **Customer** and **Employee** resources (both tagged `uag`), an **Employee Login** form, and the **Manager** and **Employee** roles.

### Create a manager and an employee

Open http://localhost:3000, log in as `admin@example.com` with the password from the Compose file, open the **Employee** resource and use **Enter Data** to create two records:

| First name | Last name | Email | Role | Password |
|---|---|---|---|---|
| Example | Manager | `manager@example.com` | Manager | a temporary password |
| Example | Employee | `employee@example.com` | Employee | a temporary password |

A Role Assignment action on the resource gives each new record the role selected.

## Roles and permissions govern the agent

The agent can do exactly what the signed-in user can do in Form.io, because every MCP tool call runs as that user. The sample's resources grant:

| Resource | Manager | Employee |
|---|---|---|
| Employee | Create, read, update, delete all | None |
| Customer | Create, read, update, delete all | Create, read, update, delete all |

Signed in as the employee, the agent can onboard a customer. Asked to add an employee, it sees from `get_forms` that the user has no create permission on Employee and says so; if it tried anyway, Form.io would refuse the submission. Signed in as the manager, it can do both.

You configure this with ordinary Form.io submission access on each form or resource:

```json
"submissionAccess": [
  { "type": "create_all", "roles": ["manager"] },
  { "type": "read_all",   "roles": ["manager"] },
  { "type": "update_all", "roles": ["manager"] },
  { "type": "delete_all", "roles": ["manager"] }
]
```

Because permissions live in the project, the same rules apply to people in the portal, to your applications, and to every agent. There is no separate agent policy to keep in step. With Form.io Enterprise, submission revisions also record which user changed each value.

> **Warning:** A user's permissions are the agent's permissions. An agent acting for an administrator can read and change anything in the project. Give agents to users with roles scoped to what they need.

## Claude Desktop with `mcp-remote`

Claude Desktop can run a local MCP server as a command. `mcp-remote` is a small proxy that connects to a remote MCP endpoint, handles the OAuth flow in your browser, and speaks MCP to Claude Desktop over stdio. Your UAG does not need to be public for this: the proxy runs on your machine.

```sequence
participants: Claude Desktop, mcp-remote, Browser, UAG*, Form.io
Claude Desktop -> mcp-remote: MCP over stdio, on your laptop
mcp-remote -> Browser: opens /auth/authorize the first time
Browser -> UAG: Form.io login, then the authorization code
UAG -> Form.io: confirms the user
mcp-remote -> UAG: /mcp with the user's token (cached in ~/.mcp-auth)
UAG -> Form.io: tool calls, with that user's permissions
```

### 1. Sign in once from the terminal

```bash
npx mcp-remote http://localhost:3000/mcp
```

Your browser opens the UAG's login page, which loads `LOGIN_FORM`. Sign in as the manager or the employee.

![The UAG login page, showing the project's own login form.](/images/login.png)

`mcp-remote` stores the token under `~/.mcp-auth`. To sign in as someone else later, delete it:

```bash
rm -rf ~/.mcp-auth
```

### 2. Add the server to Claude Desktop

In Claude Desktop, open **Developer → Open App Config File**.

![Opening the app config file from Claude Desktop's Developer menu.](/images/claude-app-config.png)

Add the UAG to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "formio-uag": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

Quit and reopen Claude Desktop. If it shows the login page again, sign in. Open **Settings**: the `formio-uag` server is listed among your connections.

![The formio-uag server connected in Claude Desktop.](/images/claude-local.png)

## claude.ai remote connectors

A remote connector is called by Anthropic's servers, not by your machine, so the UAG must be reachable from the internet over HTTPS:

1. Deploy the UAG behind TLS at a public URL, for example `https://uag.example.com`. With the sample's nginx layout, publish the nginx port.
2. Set `BASE_URL` to that URL. The OAuth discovery documents are built from it, and the connector follows them; a `BASE_URL` the connector cannot reach is the usual reason authentication fails.
3. Set `LOGIN_FORM` to a login form URL the user's browser can load.
4. In Claude, open **Settings → Connectors**, choose **Add custom connector**, and enter a name and the MCP URL, `https://uag.example.com/mcp`.

![Adding the UAG as a custom connector in Claude.](/images/claude-ai-add-connector.png)

5. Select **Connect** next to the connector. Claude opens the UAG's login page; sign in, and Claude returns as connected.

The connector discovers everything else itself: `/.well-known/oauth-protected-resource`, then `/.well-known/oauth-authorization-server`, dynamic client registration at `/auth/register`, and the PKCE exchange at `/auth/token`. A connector also works in Claude's mobile apps, including by voice.

For a local test of a remote connector, a tunnel (such as ngrok) to the nginx port works; set `BASE_URL` and `LOGIN_FORM` to the tunnel's URL and restart the UAG.

## Talk to your forms

Start a chat and say what you want, in your own words:

- "I would like to add a new customer."
- "I met a customer the other day. His name is Joe Smith and he is the CFO of Acme Inc."
- "What is the phone number of my customer Joe Smith?"
- "Joe Smith is already a customer. Add a note to call him next Tuesday."

![A conversation in which Claude adds a customer through the UAG.](/images/example-chat.png)

Behind each request Claude calls the UAG's tools: `get_forms` to find the Customer resource and check permissions, `get_form_fields` and `get_field_info` to learn the fields and their rules, `collect_field_data` to validate answers as they come, then `confirm_form_submission` and `submit_completed_form`. Searches use `find_submissions`, and changes `submission_update`. Watch the resource's **Data** tab in the portal to see records arrive.

Edit a resource in the portal (add a field, change an option, rewrite a description) and, within `PROJECT_TTL` seconds, Claude asks for the new field or offers the new option. Nothing in Claude changed.

## Shaping the agent with a module

The sample is a [module](/developers/modules): a folder mounted at `/app/module` that carries the project template, actions, response templates and tool overrides. This one overrides the `get_forms` description so Claude checks permissions before asking for fields:

```js
module.exports = {
  config: {
    template: require('./project.json'),
    responseTemplates: require('./templates'),
    toolOverrides: {
      get_forms: {
        description: 'Get a list of forms that the user has access to submit. You must call this tool before calling the `get_form_fields` tool to verify if the user has access to submit the form.',
      },
    },
  },
  actions: require('./actions'),
};
```

A module can also replace the login page, add MCP tools, and add form actions that run after the UAG has validated what the agent sent. See [Modules](/developers/modules).

## Troubleshooting

| Symptom | Cause |
|---|---|
| The login page says it cannot load the form | `LOGIN_FORM` does not point at a login form's JSON endpoint that the browser can reach. |
| Claude lists no forms, or says a form does not exist | The form is not tagged `uag`, the user lacks access, or the project cache has not refreshed. Restart the UAG to re-register at once. |
| `mcp-remote` keeps signing in as the wrong user | Delete `~/.mcp-auth` and sign in again. |
| A remote connector cannot authenticate | `BASE_URL` is not the public HTTPS URL the connector reaches. It reads the value from the discovery documents and follows it. |
| Every `/mcp` request returns `401` | `BASE_URL` is unset (then `/auth/token` and `/.well-known/*` are `404` too), or the client sends no bearer token. |
| The agent is refused an action the user expects to be allowed | The user's role lacks that permission on the form. Check its submission access. |

More in [Troubleshooting](/developers/troubleshooting).
