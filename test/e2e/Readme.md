# UAG End-to-End Tests

Run with:

```
yarn test:e2e
```

## Requirements

| Requirement | Used for |
|-------------|----------|
| Docker (with `docker compose`) | Spins up Form.io OSS + MongoDB for layers 1 and 3 |
| `CLAUDE_API_KEY` env var (or in the root `.env`) | Real Claude API calls in layers 2 and 3. Suites that need it are skipped when it is not set. |
| A built `lib/` (`yarn build`) | The UAG server is booted from the compiled output |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_CLAUDE_MODEL` | `claude-opus-5` (layer 3), `claude-haiku-4-5` (layer 2) | Override the Claude model used by the tests |

## Layers

**Layer 1 — MCP protocol** (`layer1.mcp-protocol.e2e.mjs`, no Claude):
Boots Form.io OSS + Mongo (Docker) and the UAG server (local process, from
`./lib`, with the test module in `./module`). A real MCP client exercises the
streamable-http transport: authentication, tool listing, uag-tag filtering,
field discovery, data collection, validation, submission, and the
`agent_provide_data` criteria prompt — with results verified directly against
the Form.io REST API.

**Layer 2 — uag-claude integration** (`layer2.claude-integration.e2e.mjs`):
Runs the real `integrations/claude` server against a stub UAG MCP server with
real (cheap) Claude API calls. Covers authentication, the local MCP client
tool loop, tool error handling, and UAG-unreachable behavior.

**Layer 3 — full-stack flows** (real Claude, full stack):

- *Conversational Forms* (`layer3.conversational.e2e.mjs`): Claude acts as a
  conversational front-end for the uag-tagged `customer` resource. The test
  plays the user with scripted turns ("I would like to add a new Contact",
  the contact's details, a submit confirmation) and asserts the conversation
  produces a correct submission in Form.io — including the conditionally
  required `otherReferral` field.
- *Agentic Workflows* (`layer3.agentic.e2e.mjs`): boots the full stack
  including the uag-claude integration. An application submission is created
  in Form.io, then `/agent/claude/agent_provide_data` is invoked (as a
  Form.io Webhook action would). The agent reads the submission, follows the
  criteria configured on the form via `uag`/`uagField` component properties,
  and writes its assessment back into the submission. Asserted: deterministic
  accept/reject recommendation based on GPA, a 1-10 essay score, and that the
  applicant's own answers are untouched.

## Test project

The stack uses `test/e2e/module` as the UAG runtime module. Its
`template.json` extends the `examples/local` project with:

- a `referralSource` (required select) + `otherReferral` (conditionally
  required textfield) pair on the `customer` resource, and
- an `application` form (trimmed college application) whose
  "For Office Use Only" panel carries the assessment criteria Content
  component (`uag=application`, `uagField=criteria`) and the agent-fillable
  fields `aiEssayScore`, `aiRecommendation`, and `aiSummary`.

Each spec file boots its own stack and tears it down (including the Mongo
volume), so runs are isolated and repeatable.
