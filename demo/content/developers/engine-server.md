---
title: Engine server
description: Run engines in their own container behind the remote engine protocol, and implement a compatible engine server in any language.
section: Extend
order: 50
---

The engine server, `@formio/uag-engines` (image `formio/uag-engines`), runs engine packages in a process of their own. The UAG reaches them with its built-in `remote` engine type, over a small JSON protocol. Model API keys and model traffic then stay in the engine server's container, and the UAG holds no model credential.

The engine server holds no Form.io credential either. Every request from the UAG carries only the engine server key. For research, the UAG adds a short-lived scoped token, which the engine server uses to call back into the UAG's `/mcp` for the task's read-only tools, with the caller's identity.

This page covers running the engine server, its configuration and security, the remote engine protocol in full, and how to implement a compatible server in another language.

```sequence
participants: UAG*, Engine server, Model APIs
UAG -> Engine server: decide / extract, Bearer engine server key, X-Request-Id
Engine server -> Model APIs: the model call, with the model's key
Engine server -> UAG: research: /mcp with a scoped token and the X-Request-Id
UAG --> Engine server: only the task's read-only tools
Engine server --> UAG: answers; the UAG validates them (Run task then saves)
```

## When to use it

| | Engines in the UAG | Engines on an engine server |
|---|---|---|
| Model keys live in | the UAG | the engine server only |
| Model traffic leaves from | the UAG | the engine server |
| Research tool calls | in process | back to the UAG's `/mcp`, with a scoped token |
| Network policy | one egress rule set | the UAG needs no egress to model APIs |
| Containers | one | two, on a private network |

Use it when model credentials and egress to model providers must be isolated from the service that holds Form.io credentials, or to scale and update engines separately. Any mix works: `UAG_ENGINES=jev,claude:remote` keeps Jev in the UAG and moves Claude out.

## Run it with Docker Compose

`formio/uag-engines` includes the official engines: `jev`, `claude`, `openai`, `grok` and `gemini`.

```yaml
services:
  formio-uag:
    image: formio/uag:rc
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
    image: formio/uag-engines:rc
    environment:
      UAG_ENGINES: jev,claude
      TYPESAFE_API_KEY: ${TYPESAFE_API_KEY}
      CLAUDE_API_KEY: ${CLAUDE_API_KEY}
      UAG_ENGINE_SERVER_KEY: ${UAG_ENGINE_SERVER_KEY}
      UAG_SERVER: http://formio-uag:3200   # where research calls /mcp
    # No published port: only the UAG, on the same private network, reaches it.
```

```bash
# .env
UAG_ENGINE_SERVER_KEY=$(openssl rand -hex 32)
```

On the UAG, `<name>:remote` is an instance hosted on an engine server. By default it uses the engine with the same name there; `UAG_ENGINE_<NAME>_ENGINE` names a different one. The engine server resolves and configures its own instances exactly as the UAG does, from its own `UAG_ENGINES` and `UAG_ENGINE_*` variables.

The image runs as the `node` user, exposes port 3300, and has a health check that calls `/health` with the key (every route requires it). Without Docker:

```bash
npm install @formio/uag-engines@rc @formio/uag-claude@rc
UAG_ENGINES=claude CLAUDE_API_KEY=... UAG_ENGINE_SERVER_KEY=... \
UAG_SERVER=http://formio-uag:3200 npx uag-engines
```

## Configuration

### The engine server

| Variable | Meaning | Default |
|---|---|---|
| `UAG_ENGINE_SERVER_KEY` | **Required.** The key every request must carry, at least 32 characters. The engine server refuses to start without one. | |
| `UAG_ENGINES` | The engine instances to host, as on the UAG: `jev,fast:claude,local:openai`. At least one, or it refuses to start. | |
| `UAG_ENGINE_<NAME>_<SETTING>` and each engine's own variables | Each instance's settings, resolved as on the UAG. See [Engines and routing](/developers/engines#the-official-engines). | |
| `UAG_SERVER` | The UAG's URL, for research: research calls go to `${UAG_SERVER}/mcp`, never to a URL taken from a request. Must be `http` or `https`. Without it, research extracts are refused. | |
| `UAG_ENGINE_PATH` | Absolute directories, separated by `:`, with more engine packages installed. | |
| `PORT`, `HOST` | Where it listens. The `formio/uag-engines` image sets `HOST=0.0.0.0`. | `3300`, `127.0.0.1` |
| `SHUTDOWN_TIMEOUT` | On SIGTERM or SIGINT, how long to let requests in flight finish before exiting, in milliseconds. | `10000` |
| `DEBUG` | `formio:uag:engine-server` also logs each engine failure's stack. Without it, each failure is one line on stderr: the request id, the route, and the error's name, status and message, never the request. | |

Engines on the engine server get an empty host configuration (`config` is `{}`), so an engine that sizes its client's timeout from `routing.timeouts` uses its default there. Set timeouts on the UAG; it aborts the call when they pass.

### The UAG's remote instances

| Setting | Variable | Default |
|---|---|---|
| `url` | `UAG_ENGINE_<NAME>_URL` | required: the engine server, such as `http://uag-engines:3300`, without a user name or password (`key` authenticates the UAG) |
| `key` | `UAG_ENGINE_<NAME>_KEY` | required (secret): the engine server key, at least 32 characters |
| `engine` | `UAG_ENGINE_<NAME>_ENGINE` | the instance name: the engine's name on the engine server |
| `timeout` | `UAG_ENGINE_<NAME>_TIMEOUT` | `10000`: milliseconds for each attempt to describe the engine at startup |

At startup, each remote instance asks the engine server for its engine's kind and model (`GET /v1/engines`). While the engine server is unreachable or answers `5xx`, it retries with the backoff the UAG uses for `PROJECT`: `PROJECT_RETRIES` attempts (default 5), starting at `PROJECT_RETRY_DELAY` (default 5000 ms) and doubling, up to 60 s. A refused key (`401`, `403`), any other error status, an answer that is not the protocol, or a server that does not host the engine stops startup at once:

```text
The "claude" engine could not start: the engine server at http://uag-engines:3300 does not host an engine named "claude" (it hosts "jev").
```

The instance then behaves as a local engine of that kind: a decision instance reports the remote engine's `maxOptions`, an agent instance its `toolUse`, and both report its model.

## Security

- **One key, checked first.** Every route, including `/health`, needs `Authorization: Bearer <UAG_ENGINE_SERVER_KEY>`. The key is compared in constant time (as SHA-256 digests, whatever its length), before the request body is read. A missing or wrong key is `401`.
- **No Form.io credentials.** The UAG never sends the engine server a project key, admin key or a user token it can use. Research uses a scoped token that is valid only for `/mcp` of the project it was issued for, only for the task's read-only tools, and only for the research timeout. The caller's own token travels inside it sealed, so the engine server cannot read it.
- **A fixed callback address.** Research connects to `UAG_SERVER` from the engine server's configuration, never to an address in a request.
- **Calls it can vouch for.** The engine server offers the model only the tools that the request asks for and that the UAG's `/mcp` lists for the token. It records every call, and reports the calls it made, whatever the engine says.
- **Aborts.** When the UAG abandons a call (its routing timeout), the connection closes, the engine's signal fires, research stops, and the MCP connection is closed.
- **Errors.** An engine's error message is passed on only when the engine marked it safe (`EngineError`). Anything else is answered as "The engine failed (see the engine server logs)" and logged there.
- **Private network.** Keep the engine server on a network only the UAG reaches, and do not publish its port. At startup it warns when it listens on a public address: one that is not loopback, link-local, RFC 1918, carrier-grade NAT (100.64.0.0/10) or an IPv6 unique-local address.

## Research and scoped tokens

A task researches when its criteria component lists read-only tools in `uagTools`, in `{form}/agent/generate` and in an "Agent: Run task" action that answers the whole task. With a remote agent engine:

1. The UAG issues a **scoped token**: a JWT signed with `JWT_SECRET` for this project, carrying the caller's identity and the task's tool names. The identity is administrator, or the caller's own token, sealed: a UAG bearer token, the signed-in user's Form.io token (`x-jwt-token`), or, in an "Agent: Run task" run, a token the UAG signs for the submitter with their own roles (admin roles left out), never the agent role's, or the caller's own token for a run without an agent role. Anonymous callers and portal team members below team admin have none to carry, so they cannot research through an engine server. A tool that is not annotated read-only is never put in one. It expires with the research timeout (`agentApi.research.timeout`, 120 s by default).
2. The UAG sends `POST /v1/engines/<name>/extract` with `tools` and `maxIterations`, and the token in `X-UAG-Scoped-Token`. Work that needs no tools gets no token.
3. The engine server connects an MCP client to `${UAG_SERVER}/mcp` with `Authorization: Bearer <scoped token>`, lists the tools, and gives the engine those that were both requested and listed.
4. The UAG's `/mcp` recognizes the scoped token: it refuses one issued for another project, checks the sealed token again on every call the way the project checks `x-jwt-token` (never as an administrator unless the scoped token says so), runs as that identity, and lists and allows only the token's tools that are read-only.
5. The engine calls tools through the engine server, which forwards each call over MCP and records it.
6. The engine server answers with the values, and the `toolCalls` it recorded. It closes the MCP connection.

Scoped tokens are refused by a form's agent operations (`{form}/agent/*`) and `/agent/capabilities` (`401`): they can never start another task.

Scoped tokens are signed with the UAG's `JWT_SECRET`. Set it explicitly, to the same value on every UAG replica: without it, each UAG process signs with a random secret of its own, so a research call that reaches another replica (or the same one after a restart) is refused. When the UAG cannot issue a scoped token at all, a researching remote engine fails with "The remote engine cannot research without a scoped token. Set JWT_SECRET on the UAG."

## Request ids

Every Agent API request has an id: the caller's `X-Request-Id` when it is a short token, otherwise one the UAG generates. The UAG returns it in the `X-Request-Id` response header and in error bodies, and logs failures under it.

The id travels with the run:

1. The UAG's `remote` engine sends it as `X-Request-Id` on each `decide` and `extract` call it makes for that request.
2. The engine server sends it on with its research requests to the UAG's `/mcp`, and puts it in each failure's log line: `[uag-engines] [<id>] POST /v1/engines/claude/extract failed: ...` (with `DEBUG=formio:uag:engine-server`, the stack follows under the same id).

A logging proxy in front of both, such as the demo site's [flow proxy](https://github.com/formio/uag/blob/v2.0.0-rc.5/demo/flow/proxy.mjs), can then group the request, every engine call and every research call of one run.

The header is optional on every leg, and the protocol version does not change with it. Only an id of 1 to 128 letters, digits, `.`, `_`, `:` or `-` is accepted or passed on; anything else is dropped (the UAG generates its own instead). An "Agent: Run task" run carries the `X-Request-Id` of the submission request that started it, when that request sent one, and so does every run its save chains to. Engine calls with no such request behind them, such as a Run task on a save made through an MCP tool, carry none.

```js
const { REQUEST_ID_HEADER, safeRequestId } = require('@formio/uag-sdk/protocol');
REQUEST_ID_HEADER;                       // 'x-request-id'
safeRequestId('run-2026-10-23:42');      // 'run-2026-10-23:42'
safeRequestId('bad id with spaces');     // undefined
```

## The remote engine protocol

Version 1. JSON over HTTP, with the version in the path and in every body: the path lets future versions run side by side, and the body catches a proxy that mixes them up.

```text
GET  /v1/engines                 -> { protocol, engines: [{ name, kind, model, maxOptions?, toolUse? }] }
POST /v1/engines/:name/decide    { protocol, state, questions }
                                 -> { protocol, model, answers, usage? }
POST /v1/engines/:name/extract   { protocol, instructions, state, fields, schema, tools?, maxIterations? }
                                 -> { protocol, model, values, toolCalls?, usage? }

Authorization: Bearer <engine server key>     every request
X-UAG-Scoped-Token: <scoped token>            research extracts only
X-Request-Id: <request id>                    optional, on decide and extract
errors: { protocol, error, expose }           with a 4xx or 5xx status
```

The engine server also serves `GET /health` (`{ "status": "ok", "engines": <count> }`) for health checks; the UAG does not call it.

### GET /v1/engines

```http
GET /v1/engines HTTP/1.1
Host: uag-engines:3300
Authorization: Bearer 3f9c…
Accept: application/json
```

```json
{
  "protocol": 1,
  "engines": [
    { "name": "jev", "kind": "decision", "model": "jev-1.13.0", "maxOptions": 255 },
    { "name": "claude", "kind": "agent", "model": "claude-opus-5-5", "toolUse": true }
  ]
}
```

Each engine needs a valid name (lowercase letters, digits and `-`, starting with a letter, at most 63 characters), a `kind`, and a non-empty `model`. A decision engine needs `maxOptions`, a whole number of at least 2. An agent engine without `toolUse: true` is passed over for tasks that research.

### POST /v1/engines/:name/decide

```http
POST /v1/engines/jev/decide HTTP/1.1
Host: uag-engines:3300
Authorization: Bearer 3f9c…
Content-Type: application/json
X-Request-Id: 6f1c2a1e-8d0b-4c7e-9a52-0d7f3b2e9c41
```

```json
{
  "protocol": 1,
  "state": {
    "instructions": "Triage the claim from the description.",
    "input": { "What happened?": "My car was stolen from the driveway overnight." },
    "today": "Friday, October 23, 2026 (2026-10-23)"
  },
  "questions": {
    "choice:triage.claimType": {
      "type": "choice",
      "instructions": "Based on `input`, which kind of claim is this?",
      "options": { "Auto: collision": null, "Theft": "Something was stolen." }
    },
    "affirm:triage.injuryInvolved": {
      "type": "noul",
      "instructions": "Based on `input`, was anyone injured?"
    }
  }
}
```

```json
{
  "protocol": 1,
  "model": "jev-1.13.0",
  "answers": {
    "choice:triage.claimType": {
      "type": "choice", "choice": "Theft",
      "probabilities": { "Auto: collision": 0.04, "Theft": 0.96 }, "confidence": 0.92
    },
    "affirm:triage.injuryInvolved": { "type": "noul", "probability": 0.03 }
  },
  "usage": { "inputTokens": 412, "outputTokens": 9 }
}
```

`state` must have `input` (an object) and `today` (a string); each question must be a `choice`, `score` or `noul` with `instructions`. Question ids are opaque: answer with the ids you were sent. The shapes of questions and answers are the engine contract's; see [Engine SDK](/developers/engine-sdk#decision-engines). The engine server passes on only the answers to questions that were asked.

### POST /v1/engines/:name/extract

```json
{
  "protocol": 1,
  "instructions": "Write the adjuster's summary of the claim.",
  "state": {
    "input": { "What happened?": "A tree fell on the garage during the storm on Tuesday." },
    "today": "Friday, October 23, 2026 (2026-10-23)"
  },
  "fields": [
    { "path": "summary", "label": "Summary", "type": "textarea", "description": "", "rule": "Plain text." },
    { "path": "lossDate", "label": "Date of loss", "type": "datetime", "description": "", "rule": "An ISO 8601 date.", "format": "date" }
  ],
  "schema": {
    "type": "object",
    "properties": { "summary": { "type": "string" }, "lossDate": { "type": "string", "format": "date" } }
  },
  "tools": [
    { "name": "find_submissions", "description": "Find existing form submissions…", "inputSchema": { "type": "object", "properties": { } } }
  ],
  "maxIterations": 10
}
```

```json
{
  "protocol": 1,
  "model": "claude-opus-5-5",
  "values": { "summary": "A tree fell on the insured's garage during Tuesday's storm.", "lossDate": "2026-10-20" },
  "toolCalls": [{ "name": "find_submissions", "isError": false }],
  "usage": { "inputTokens": 2310, "outputTokens": 88 }
}
```

`instructions` must be a string, `fields` a list of objects with a `path`, and `schema` an object. `tools` is present only for research, and then `maxIterations` must be a positive whole number and the request carries `X-UAG-Scoped-Token`. The engine server passes on only the values for paths in `schema.properties`.

### Errors

An error is a `4xx` or `5xx` status with:

```json
{ "protocol": 1, "error": "This engine server does not host an engine named \"claude\".", "expose": true }
```

`expose` says whether the message may be shown to Agent API callers. The UAG shows it when `expose` is `true`, and otherwise reports "The engine server answered HTTP <status>." Either way the call is an engine failure, and routing tries the next engine.

| Status | When (the `@formio/uag-engines` server) |
|---|---|
| `400` | A body in another protocol version or of the wrong shape; invalid JSON; a `decide` to an agent engine or an `extract` to a decision engine; a research extract without a scoped token, or to an engine without `toolUse`. |
| `401` | A missing or wrong engine server key. |
| `404` | No engine with that name; an unknown route. |
| `413` | A body larger than 5 MB. |
| other `4xx` | Another problem reading the body keeps its own status, such as `415` for a character set the server does not read. |
| `502` | The engine failed. `expose` is `true` only for an `EngineError`. |
| `503` | A research extract when `UAG_SERVER` is not set. |

On the UAG side, a call that cannot reach the engine server fails with "The engine server could not be reached." (the UAG's debug log, `DEBUG=formio:uag:remote`, names the URL; callers are never told it), and an answer that does not follow the protocol with "The engine server's answer did not follow the remote engine protocol: <why>." A missing `model` in an answer falls back to the model the engine server described.

### Checking messages with the SDK

`@formio/uag-sdk/protocol` exports the checks both sides use. A JavaScript engine server can validate with them; a server in another language can use them as the specification.

| Export | Use |
|---|---|
| `PROTOCOL_VERSION` | `1`. |
| `SCOPED_TOKEN_HEADER` | `'x-uag-scoped-token'`. |
| `REQUEST_ID_HEADER`, `safeRequestId(value)` | `'x-request-id'`, and the check for a short, safe id. |
| `checkDecideRequest(body)`, `checkExtractRequest(body)` | Validate a request; throw a `ProtocolError` (with `status`, 400) naming the problem. |
| `checkDescription(body)`, `checkDecisionResponse(body)`, `checkExtractResponse(body)` | Validate a response, as the UAG does. |
| `checkVersion(body, side?)` | Refuse another version, naming both. |
| `errorBody(message, expose?)` | `{ protocol: 1, error, expose }`. |

## Embedding the engine server

`@formio/uag-engines` exports its Express app, for a server of your own:

```js
const { createEngineServer } = require('@formio/uag-engines');

async function main() {
    const { app } = await createEngineServer({
        env: process.env,                 // UAG_ENGINES, UAG_ENGINE_SERVER_KEY, UAG_SERVER, UAG_ENGINE_PATH
        types: { keywords: require('uag-engine-keywords') },   // types resolved before packages
    });
    app.listen(3300, '10.0.0.5');
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
```

| Export | What it is |
|---|---|
| `createEngineServer({ env?, config?, types?, root?, connect? })` | Loads the engines and builds the app. Throws `EngineServerConfigError` for a missing or short key, a bad `UAG_SERVER`, or no engines. |
| `engineServerApp({ engines, key, uagServer, connect? })` | The app for engines you already loaded: `engines` is what `loadEngines` returns, `[{ engine, type, package?, version? }]`, not bare engines. `connect(url, token, requestId)` is the MCP client factory, for tests. |
| `keyMatches(presented, key)` | The constant-time key check. |
| `describe(engine)` | An engine as `GET /v1/engines` lists it. |
| `MIN_KEY_LENGTH` | `32`. |

## Adding engines to the image

```dockerfile
FROM formio/uag-engines:rc
# The image runs as "node", which cannot create /engines; install as root.
USER root
RUN npm install --prefix /engines uag-engine-acme
USER node
ENV UAG_ENGINE_PATH=/engines
```

Or mount a directory that holds `node_modules/uag-engine-acme` and list it in `UAG_ENGINE_PATH`. To build the image itself from the repository root: `docker build -f packages/engine-server/Dockerfile -t formio/uag-engines .`

## A compatible engine server in another language

Any server that speaks the protocol works with the UAG's `remote` type. It must:

1. Require `Authorization: Bearer <key>` on every route and compare it in constant time; answer `401` otherwise. Refuse to start with a key shorter than 32 characters, since the UAG refuses one.
2. Serve `GET /v1/engines` with `protocol: 1` and each engine's `name`, `kind`, `model`, and `maxOptions` (decision) or `toolUse` (agent).
3. Serve `POST /v1/engines/<name>/decide` and `/extract`: check `protocol: 1` and the body's shape, answer with `protocol: 1`, `model`, and only the answers or values that were asked for.
4. Answer errors as `{ protocol: 1, error, expose }`, with `expose: false` for anything that might carry internal details.
5. Stop work when the UAG closes the connection: that is how its routing timeout reaches you.
6. Optionally, log the `X-Request-Id` it sends, when it is a safe token, and send it on with research calls.
7. For research: connect an MCP client (Streamable HTTP) to the UAG's `/mcp` at a URL from your configuration, with `Authorization: Bearer <X-UAG-Scoped-Token>`; list the tools; offer the model only the requested tools that are listed; call them over MCP; stop after `maxIterations` rounds; and report the calls you made in `toolCalls`. If you do not support research, describe agent engines without `toolUse`.

The server below hosts one decision engine, `triage`, in Python with the standard library only. Its keyword scoring stands in for a model call.

```python
"""A minimal engine server for the Form.io UAG, in Python, with no dependencies.

It hosts one decision engine, "triage", behind remote engine protocol 1.

    UAG_ENGINE_SERVER_KEY=$(openssl rand -hex 32) python3 engine_server.py

On the UAG:

    UAG_ENGINES=triage:remote
    UAG_ENGINE_TRIAGE_URL=http://engines:3300
    UAG_ENGINE_TRIAGE_KEY=<the same key>
"""
import hashlib
import hmac
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = 1
KEY = os.environ.get("UAG_ENGINE_SERVER_KEY", "")
if len(KEY) < 32:
    raise SystemExit("UAG_ENGINE_SERVER_KEY must be at least 32 characters.")

ENGINES = {
    "triage": {"name": "triage", "kind": "decision", "model": "py-keywords-1", "maxOptions": 50},
}
REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
MAX_BODY = 5 * 1024 * 1024


def words(text):
    return set(re.findall(r"[a-z0-9]{3,}", str(text).lower()))


def state_words(state):
    found = set()

    def walk(value):
        if isinstance(value, str):
            found.update(words(value))
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)

    walk(state.get("input"))
    walk(state.get("context"))
    return found


def distribution(candidates, seen):
    hits = [1 + len(words(candidate) & seen) for candidate in candidates]
    total = sum(hits)
    return [hit / total for hit in hits]


def confidence(probabilities):
    n = len(probabilities)
    return max(0.0, (max(probabilities) - 1 / n) / (1 - 1 / n)) if n > 1 else 1.0


def answer(question, seen):
    if question["type"] == "choice":
        labels = list(question["options"])
        p = distribution([f"{label} {question['options'][label] or ''}" for label in labels], seen)
        best = p.index(max(p))
        return {"type": "choice", "choice": labels[best],
                "probabilities": dict(zip(labels, p)), "confidence": confidence(p)}
    if question["type"] == "score":
        p = distribution(question["levels"], seen)
        return {"type": "score", "score": sum(i * pi for i, pi in enumerate(p)),
                "probabilities": {str(i): pi for i, pi in enumerate(p)}, "confidence": confidence(p)}
    criteria = question.get("criteria") or {}
    yes, no = distribution([criteria.get("true", ""), criteria.get("false", "")], seen)
    return {"type": "noul", "probability": yes / (yes + no)}


class ProtocolError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def error(self, status, message, expose=True):
        self.send_json(status, {"protocol": PROTOCOL, "error": message, "expose": expose})

    def authorized(self):
        # Compare digests so the comparison takes the same time whatever the lengths.
        presented = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
        return hmac.compare_digest(hashlib.sha256(presented.encode()).digest(),
                                   hashlib.sha256(KEY.encode()).digest())

    def request_id(self):
        value = self.headers.get("X-Request-Id") or ""
        return value if REQUEST_ID.match(value) else None

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ProtocolError(413, "The request body is too large.")
        try:
            body = json.loads(self.rfile.read(length) or b"null")
        except ValueError:
            raise ProtocolError(400, "The request body is not valid JSON.")
        if not isinstance(body, dict):
            raise ProtocolError(400, "The request is not a JSON object.")
        if body.get("protocol") != PROTOCOL:
            raise ProtocolError(400, f"This side speaks remote engine protocol {PROTOCOL}.")
        return body

    def do_GET(self):
        if not self.authorized():
            return self.error(401, "Unauthorized.")
        if self.path == "/health":
            return self.send_json(200, {"status": "ok", "engines": len(ENGINES)})
        if self.path == "/v1/engines":
            return self.send_json(200, {"protocol": PROTOCOL, "engines": list(ENGINES.values())})
        self.error(404, f"No route for GET {self.path}.")

    def do_POST(self):
        if not self.authorized():
            return self.error(401, "Unauthorized.")
        match = re.fullmatch(r"/v1/engines/([a-z][a-z0-9-]{0,62})/(decide|extract)", self.path)
        if not match:
            return self.error(404, f"No route for POST {self.path}.")
        name, operation = match.groups()
        engine = ENGINES.get(name)
        if not engine:
            return self.error(404, f'This engine server does not host an engine named "{name}".')
        if (operation == "decide") != (engine["kind"] == "decision"):
            return self.error(400, f'The engine "{name}" is a {engine["kind"]} engine.')
        try:
            body = self.read_body()
            state, questions = body.get("state"), body.get("questions")
            if not isinstance(state, dict) or not isinstance(questions, dict):
                raise ProtocolError(400, '"state" and "questions" must be objects.')
            for qid, q in questions.items():
                if not isinstance(q, dict) or q.get("type") not in ("choice", "score", "noul"):
                    raise ProtocolError(400, f'The question "{qid}" is not a choice, score or noul question.')
            seen = state_words(state)
            answers = {qid: answer(q, seen) for qid, q in questions.items()}
        except ProtocolError as err:
            return self.error(err.status, str(err))
        except Exception as err:  # Never show an internal error to API callers.
            self.log_message("[%s] engine failure: %r", self.request_id() or "-", err)
            return self.error(502, "The engine failed (see the engine server logs).", expose=False)
        self.log_message("[%s] decided %d question(s)", self.request_id() or "-", len(answers))
        self.send_json(200, {"protocol": PROTOCOL, "model": engine["model"], "answers": answers})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3300"))
    ThreadingHTTPServer((os.environ.get("HOST", "0.0.0.0"), port), Handler).serve_forever()
```

Requires Python 3.9 or later. Try it:

```bash
export UAG_ENGINE_SERVER_KEY=0123456789abcdef0123456789abcdef
python3 engine_server.py &

curl -s -H "Authorization: Bearer $UAG_ENGINE_SERVER_KEY" http://localhost:3300/v1/engines
# {"protocol": 1, "engines": [{"name": "triage", "kind": "decision", "model": "py-keywords-1", "maxOptions": 50}]}

curl -s -X POST -H "Authorization: Bearer $UAG_ENGINE_SERVER_KEY" -H "X-Request-Id: run-42" \
  -d '{"protocol":1,"state":{"input":{"Description":"my bike was stolen from the garage"},"today":"x"},
       "questions":{"q1":{"type":"choice","instructions":"Which?","options":{"Collision":"A vehicle hit something.","Theft":"Something was stolen."}}}}' \
  http://localhost:3300/v1/engines/triage/decide
# {"protocol": 1, "model": "py-keywords-1", "answers": {"q1": {"type": "choice", "choice": "Theft",
#   "probabilities": {"Collision": 0.25, "Theft": 0.75}, "confidence": 0.5}}}
```

Then point a UAG at it with `UAG_ENGINES=triage:remote`, `UAG_ENGINE_TRIAGE_URL` and `UAG_ENGINE_TRIAGE_KEY`. With `DEBUG=formio:uag:remote`, the UAG logs at startup that `"triage"` is the decision engine `"triage"` (`py-keywords-1`) at that URL, and `/agent/capabilities` lists it with `"type": "remote"`.

## Next steps

- [Engines and routing](/developers/engines): route fields to remote instances.
- [Engine SDK](/developers/engine-sdk): write the engines the server hosts.
- [Security](/developers/security): credentials, scoped tokens and deployment boundaries.
