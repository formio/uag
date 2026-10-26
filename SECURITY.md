# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities privately via one of:

- Email: [security@form.io](mailto:security@form.io)
- GitHub: [privately report a vulnerability](https://github.com/formio/uag/security/advisories/new) on this repository

Include a description of the issue, steps to reproduce, and the affected package (`@formio/uag`, `@formio/uag-sdk`, `@formio/uag-jev`, `@formio/uag-claude`, `@formio/uag-openai`, `@formio/uag-grok`, `@formio/uag-gemini`, `@formio/uag-engines`, `@formio/uag-renderer`, or the retired Claude integration, `@formio/uag-claude` 1.x) or image (`formio/uag`, `formio/uag-engines`, or the retired `formio/uag-claude`) and version. We will acknowledge receipt within 5 business days.

## Supported versions

Only the latest published version of each package and image receives security fixes. The retired Claude integration receives security fixes on its 1.3.x line, from the `1.x` branch.

## Scope notes

- The UAG is a server you deploy. It holds credentials for the Form.io deployment it is bound to — `PROJECT_KEY` or `ADMIN_KEY` — and signs its own JWTs, including the scoped tokens it sends an engine server for research, with `JWT_SECRET`. Enabled engines add model API keys: `TYPESAFE_API_KEY` (jev), `CLAUDE_API_KEY` or `ANTHROPIC_API_KEY` (claude), `OPENAI_API_KEY` (openai), `XAI_API_KEY` (grok), and `GEMINI_API_KEY` or `GOOGLE_API_KEY` (gemini). A `remote` engine adds the engine server key (`UAG_ENGINE_<NAME>_KEY`, the engine server's `UAG_ENGINE_SERVER_KEY`); with remote engines, the model keys live only on the engine server, which holds no Form.io credential. Treat all of these as secrets and supply them through your platform's secret store rather than a committed file.
- Enabling an engine sends submission data to its provider's API (TypeSafe for `jev`, Anthropic for `claude`, OpenAI or the server it is pointed at for `openai`, xAI for `grok`, Google for `gemini`): a task's criteria, its input (or, without an input, the whole submission except the fields being answered), its `uagContext` values and today's date, plus, when a task lists research tools in `uagTools`, whatever those tools return. Do not enable an engine for data that must not leave your deployment.
- No model is ever given a tool that may write: the UAG validates every value and saves it itself. Research tools (`uagTools`) are read-only, off by default, and run with the caller's identity — administrator access for webhooks using the project or admin key — so list only the tools a task needs, and only on forms whose submissions you trust: text in a submission can steer what a model looks up.
- Keep an engine server on a private network that only the UAG reaches, and do not publish its port: every request needs its key, but it is the gateway to your model keys. Engine packages are code the UAG runs: `UAG_ENGINES` and `UAG_ENGINE_PATH` choose which, so treat them like any other deployment setting.
- `BASE_URL` is published in the `.well-known` OIDC (PKCE) definitions and used for authentication callbacks. Point it at the URL clients actually reach, and use a public URL only when remote agents genuinely need to connect in.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` disables TLS certificate verification for **all** outbound requests. It exists for local and internal deployments using self-signed certificates — never set it on a deployment reachable from outside your network.
- `CORS` defaults permissively for ease of local development. Restrict it before exposing the UAG beyond a trusted network.
- Integrations under `integrations/` run their own MCP client and connect outward to the UAG, so the UAG does not need to be publicly reachable for them to work. Prefer a private network over a public endpoint where possible.
