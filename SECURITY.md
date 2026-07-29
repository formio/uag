# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities privately via one of:

- Email: [security@form.io](mailto:security@form.io)
- GitHub: [privately report a vulnerability](https://github.com/formio/uag/security/advisories/new) on this repository

Include a description of the issue, steps to reproduce, and the affected package (`@formio/uag`, `@formio/uag-claude`) or image (`formio/uag`, `formio/uag-claude`) and version. We will acknowledge receipt within 5 business days.

## Supported versions

Only the latest published version of each package and image receives security fixes.

## Scope notes

- The UAG is a server you deploy. It holds credentials for the Form.io deployment it is bound to — `PROJECT_KEY` or `ADMIN_KEY` — and signs its own JWTs with `JWT_SECRET`. Treat all three as secrets and supply them through your platform's secret store rather than a committed file.
- `BASE_URL` is published in the `.well-known` OIDC (PKCE) definitions and used for authentication callbacks. Point it at the URL clients actually reach, and use a public URL only when remote agents genuinely need to connect in.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` disables TLS certificate verification for **all** outbound requests. It exists for local and internal deployments using self-signed certificates — never set it on a deployment reachable from outside your network.
- `CORS` defaults permissively for ease of local development. Restrict it before exposing the UAG beyond a trusted network.
- Integrations under `integrations/` run their own MCP client and connect outward to the UAG, so the UAG does not need to be publicly reachable for them to work. Prefer a private network over a public endpoint where possible.
