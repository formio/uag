# @formio/uag-engines

<sub>[Form.io UAG](https://github.com/formio/uag/blob/main/README.md) &rsaquo; [Engines](https://github.com/formio/uag/blob/main/README.md#engines-and-routing) &rsaquo; this page</sub>

Runs engine packages for the Form.io UAG in their own process, behind the remote engine protocol. The UAG reaches them with its built-in `remote` engine type. Model API keys and model traffic then stay in this container, and the UAG holds no model credential. Any engine package works here, unchanged.

The engine server holds no Form.io credential. The UAG never sends it one: every request carries only the engine server key. For research, the UAG adds a short-lived scoped token, and the engine server uses it to call the UAG's `/mcp`. The token allows only the task's read-only tools, with the caller's identity.

## Run it

The `formio/uag-engines` image includes the official engines: `jev`, `claude`, `openai`, `grok` and `gemini`.

```yaml
services:
  formio-uag:
    image: formio/uag:2
    environment:
      UAG_ENGINES: jev:remote,claude:remote
      UAG_ENGINE_JEV_URL: http://uag-engines:3300
      UAG_ENGINE_JEV_KEY: ${UAG_ENGINE_SERVER_KEY}
      UAG_ENGINE_CLAUDE_URL: http://uag-engines:3300
      UAG_ENGINE_CLAUDE_KEY: ${UAG_ENGINE_SERVER_KEY}
      JWT_SECRET: ${JWT_SECRET}            # signs the scoped tokens for research
      # ... PROJECT, keys and the rest of the UAG's settings
    depends_on:
      uag-engines:
        condition: service_healthy

  uag-engines:
    image: formio/uag-engines:2
    environment:
      UAG_ENGINES: jev,claude
      TYPESAFE_API_KEY: ${TYPESAFE_API_KEY}
      CLAUDE_API_KEY: ${CLAUDE_API_KEY}
      UAG_ENGINE_SERVER_KEY: ${UAG_ENGINE_SERVER_KEY}
      UAG_SERVER: http://formio-uag:3200   # where research calls /mcp
    # No published port: only the UAG, on the same private network, reaches it.
```

On the UAG, `<name>:remote` is an instance hosted here; by default it uses the engine of the same name on the engine server (`UAG_ENGINE_<NAME>_ENGINE` names another). Any mix works: `UAG_ENGINES=jev,claude:remote` keeps `jev` in the UAG, with its key there, and moves only Claude.

Without Docker: `npm install @formio/uag-engines @formio/uag-claude`, then run `npx uag-engines` with the same variables.

## Settings

| Variable | Meaning | Default |
|---|---|---|
| `UAG_ENGINE_SERVER_KEY` | **Required.** The key every request must carry, at least 32 characters. The UAG's `remote` instances send it as `UAG_ENGINE_<NAME>_KEY`. | |
| `UAG_ENGINES` | The engine instances to host, as on the UAG: `jev,fast:claude,local:openai`. | |
| `UAG_ENGINE_<NAME>_<SETTING>` and each engine's own variables | Each instance's settings, resolved as on the UAG. See each engine's README. | |
| `UAG_SERVER` | The UAG's URL, for research. Research calls go to `${UAG_SERVER}/mcp`, never to a URL taken from a request. Without it, research extracts are refused. | |
| `UAG_ENGINE_PATH` | Absolute directories with more engine packages installed, such as a mounted volume. | |
| `PORT`, `HOST` | Where it listens. The `formio/uag-engines` image sets `HOST=0.0.0.0`. | `3300`, `127.0.0.1` |
| `SHUTDOWN_TIMEOUT` | On SIGTERM or SIGINT, how long to let requests in flight finish before exiting, in milliseconds. | `10000` |
| `DEBUG` | `formio:uag:engine-server` also logs each engine failure's stack. Without it, each failure is one line on stderr: the request id, the route, and the error's name, status and message, never the request. | |

Engines are resolved as on the UAG: an instance named in `UAG_ENGINES` is looked up as `@formio/uag-<type>`, then `uag-engine-<type>`, from the `node_modules` of this package's installation and the directories above it, then from `<dir>/node_modules` of each directory in `UAG_ENGINE_PATH`; never from the working directory, `NODE_PATH` or Node's global folders.

## Security

- Every route, including `/health`, needs `Authorization: Bearer <UAG_ENGINE_SERVER_KEY>`. The key is compared in constant time, before the request body is read.
- Keep the engine server on a private network that only the UAG reaches, and do not publish its port. It warns at startup when it listens on a public address.
- Research uses only the tools that the request asks for and the UAG's `/mcp` lists for the scoped token. Every call is recorded, and the calls this server made are what it reports back, whatever the engine says. No model can write: the token allows only read-only tools.
- When the UAG abandons a request (its routing timeout), the engine is aborted, research stops (also while it is still connecting), and the MCP connection is closed.
- Engine errors are passed on only when the engine marks them safe to show (`EngineError`); anything else is reported as "The engine failed". Every failure is logged here in one line, with the error's message: a provider SDK's message can name an account or a URL, so treat these logs as private.

## Protocol

`GET /health`, `GET /v1/engines`, `POST /v1/engines/:name/decide` and `POST /v1/engines/:name/extract`, all JSON, with `protocol: 1` in every body. See [`@formio/uag-sdk/protocol`](https://github.com/formio/uag/blob/main/packages/engine-sdk/protocol.js) for the shapes.

Decide and extract calls may carry the Agent API request's `X-Request-Id`. The engine server sends it on with every research request to the UAG's `/mcp` and puts it in its logs, so a logging proxy can group every leg of a run. Only a short token (up to 128 letters, digits, `.`, `_`, `:` or `-`) is passed on; the header is optional either way, and the protocol version is unchanged.

## Building the image

From the repository root:

```
docker build -f packages/engine-server/Dockerfile -t formio/uag-engines .
```

To add an engine package, either derive an image (the image runs as `node`, so switch to `USER root` for `RUN npm install --prefix /engines uag-engine-acme`, then back to `USER node`, with `ENV UAG_ENGINE_PATH=/engines`), or mount a directory that contains `node_modules/uag-engine-acme` and list it in `UAG_ENGINE_PATH`.

License: MIT.
