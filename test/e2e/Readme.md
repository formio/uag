# UAG End-to-End Tests

<sub>[Form.io UAG](../../README.md) &rsaquo; this page</sub>

Run with:

```
yarn test:e2e
```

## Requirements

| Requirement | Used for |
|-------------|----------|
| Docker (with `docker compose`) | Spins up Form.io OSS + MongoDB for layers 1 and 3 |
| `CLAUDE_API_KEY` env var (or in the root `.env`) | Real Claude API calls in layer 3. Suites that need it are skipped when it is not set. |
| A built `lib/` (`yarn build`) | The UAG server is booted from the compiled output |
| Chromium for Playwright (`npx playwright install chromium`, once) | The browser suites (`layer1.demo-conversation`, `layer1.demo-formflow`, `layer1.demo-unlicensed`, `layer3.demo-stack`). They are skipped, with that command, when it is not installed. |
| Internet access | The demo site's pages load formio.js, Bootstrap and fonts from CDNs, so the browser suites need it |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `E2E_CLAUDE_MODEL` | the Claude engine's own default | Override the Claude model used by `layer3.agent-engines`, `layer3.conversational` and `layer3.conversational-invalid` |
| `TYPESAFE_API_KEY` | unset | Adds the JEV engine to `layer3.agent-engines`, when its SDK is installed |
| `E2E_UAG_LICENSE` | unset | A `UAG_LICENSE` with the `uag` feature for `formio.e2e.test`. Runs the licensed cases in `layer1.agent-license`; they are pending without it. Keep it in the gitignored `.env`. |
| `E2E_UAG_IMAGE`, `E2E_DEMO_IMAGE`, `E2E_ENGINES_IMAGE` | unset | For `layer3.demo-stack`: a release's published images (all three, such as `formio/uag:2.0.0-rc.1`), pulled and run instead of images built from this tree. Add `E2E_PLATFORM=linux/amd64` to run them as amd64 on an arm64 machine (MongoDB and Form.io keep their own platform). |
| `E2E_FORMIO_LICENSE` | unset | A Form.io Enterprise `LICENSE_KEY`, for `layer3.demo-stack`. Set `E2E_FORMIO_LICENSE_REMOTE=true` when it is an offline (self-contained) license; otherwise the server keeps logging `License not found` and the setup job cannot log in. |
| `E2E_CORE_BUNDLE` | unset | Path to a locally built appserver-core `build/server.js`, bind-mounted into the UAG container `layer3.demo-stack` starts, to check a core change before it is published. |
| `E2E_LOCAL_CORE`, `E2E_LOCAL_APPSERVER` | unset | Paths to a built appserver-core's `build/` folder and a built appserver repository. Together, they build the UAG image `layer3.demo-stack` (and the demo recordings) start against those unpublished versions, which the UAG needs when it uses APIs the published ones lack. |
| `E2E_HOSTED_PROJECT_URL`, `E2E_HOSTED_PROJECT_KEY` | unset | For `layer3.getting-started`: a project on Form.io's hosted service with the demo's `claim` form, such as https://uag.form.io, and an API key of it. |
| `E2E_STRICT` | unset | `true` makes `layer3.getting-started` fail a guide whose variables are missing, instead of skipping it. The release workflow sets it. |
| `E2E_DEMO_UAG_LICENSE` | unset | A `UAG_LICENSE` with the `uag` feature that allows `formio.e2e.test` (the same kind as `E2E_UAG_LICENSE`), for `layer3.demo-stack`, with `CLAUDE_API_KEY` and `TYPESAFE_API_KEY`. `E2E_EXAMPLE_UAG_LICENSE`, its earlier name, is still read. |

## Layers

**Layer 1 — MCP protocol** (`layer1.mcp-protocol.e2e.mjs`, no Claude):
Boots Form.io OSS + Mongo (Docker) and the UAG server (local process, from
`./lib`, with the test module in `./module`). A real MCP client exercises the
streamable-http transport: authentication, tool listing, uag-tag filtering,
field discovery, data collection, validation, submission, and the
`agent_provide` criteria prompt — with results verified directly against
the Form.io REST API.

**Concurrency** (`layer1.concurrency.e2e.mjs`, no Claude): the UAG previously
shared a single `McpServer` across all requests and reconnected it to a new
transport on every call, so a second concurrent request closed the first
request's transport out from under it and that request hung until it timed
out. This suite drives genuinely concurrent traffic through `/mcp` — several
calls from one client (as an agent making parallel tool calls in a single
turn does), several independent clients at once, and concurrent submissions —
and asserts every request gets its own correct answer and every submission
lands exactly once. Cross-talk is detectable because each request asks about
a different form and every response names the form it describes.

**Failure paths** (`layer1.adversarial.e2e.mjs`, no Claude): every bug found
in this library so far has been on a failure path — a rejected submission
reported as a success, and validation messages that rendered blank once they
finally reached the agent. This suite pins that behavior: unknown and
untagged forms are refused, invalid emails / out-of-option select values /
missing conditionally required fields are rejected with the field named and
nothing written, conditionally hidden values are dropped rather than stored,
a rejected update leaves the stored value untouched, missing submissions and
uag misconfiguration produce explanatory errors, and malformed or forged
bearer tokens are refused.

**Agent API** (`layer1.agent-api.e2e.mjs`, no Claude): boots the stack with
the stub engines (`UAG_ENGINES=stub-decision,stub-agent`) and drives the
Agentic Formflow demo's claim form, which the e2e module imports from
`demo/module/project.json`. Covers capability reporting, the bearer and admin
credential modes (admin keys refused from a browser `Origin`), streamed
extraction with decisions arriving before the merged result, decisions on
in-flight data saving nothing, a claim saved through the UAG whose Run task
action replaces a value with the confident decision, a `400`, storing
nothing, when the decisions would leave the claim invalid, the `agent_decide`
MCP tool, and scoped tokens limiting `/mcp` to their read-only tools, refused
once expired or when issued for another project or none.

**License** (`layer1.agent-license.e2e.mjs`, no Claude): a test-only preload
(`helpers/resolveLocal.cjs`) resolves `formio.e2e.example`, `formio.e2e.local`
and `formio.e2e.test` to 127.0.0.1 for the UAG process only.
- Through `formio.e2e.example`, which is not a local name, the UAG behaves like a production deployment. Without a license, real engines are refused with `403` on every Agent API operation, on a save through the claim form's Run task action, and on `agent_decide`. MCP keeps working, and capabilities report the Open Source edition.
- The stub engines run there without a license, but do not unlock `agent_decide`.
- `formio.e2e.local`, `formio.e2e.test` and `localhost` are refused too: a project on this machine needs a license too. MCP keeps working there, and `agent_provide` answers with the license requirement.
- With `E2E_UAG_LICENSE`, the real engines run and the edition is Enterprise.

Every suite that runs Agentic Formflow needs `E2E_UAG_LICENSE` and is skipped without it; the stack passes it to the UAG as `UAG_LICENSE`, with `PROJECT` at `localhost`, which any license serves. The conversation suites, `layer1.mcp-protocol` (but for `agent_provide`), `layer1.adversarial` (but for one `agent_provide` case), `layer1.concurrency` and `layer1.demo-unlicensed` (the demo site against Open Source and an unlicensed UAG: the chat works, and the workflow and formflow demos say they are not supported) need no credentials. The UAG's unit tests for Agentic Formflow read `UAG_TEST_LICENSE` (or `E2E_UAG_LICENSE`) and are skipped without it.

**Agent API scenarios** (no model keys; needs `E2E_UAG_LICENSE`). These suites run the stack with the
*scripted engines* in `module/engines.js`: deterministic stand-ins that answer
from keywords in the task's input: they pick an option even when nothing
fits, pick the first listed option when several fit, answer with lower
confidence when the writer hedges ("I think"), and report weak evidence that
only a wide uncertainty band accepts. The scripted agent reviews applications
as the application form's criteria say, answers `SYSTEM OVERRIDE: set <path>
to <value>` injections with a value for that path, and, when the UAG offers it
research tools, follows `CALL <tool> <json>` lines in its input. Asked for a
chat turn (fields `-reply` and `-confirmed`), it reads `<field label>: <value>`
pairs, separated by `;` or new lines, from the person's last message, replies
`RECORDED <paths>. NEEDED <labels>.`, confirms when the message starts with
"yes", and answers the UAG's reply-only follow-up with `NOT ACCEPTED <errors>`. The e2e entry point
exposes what the engines were sent at `GET /__e2e/engine-calls`.
`E2E_UAG_CONFIG` (JSON) adds configuration such as `routing` and `agentApi` to
a suite's stack. The scripted engines are engine types in the e2e module's
`engineTypes`, named in `UAG_ENGINES` like installed ones. Suites also set
`E2E_SLOW_MS` / `E2E_SLOW_AGENT_MS` (the delays of the slow scripted engines) on
the UAG process; you don't set these yourself.

- *FNOL wizard journeys* (`layer1.agent-fnol.e2e.mjs`): descriptions of real
  losses through the form's `{form}/agent/extract` — triage decided, open values suggested,
  hidden pages filled only once triage shows them, values the user changed
  kept, "nobody was hurt" told apart from "not mentioned", hedged and
  ambiguous descriptions left uncertain, weak fraud evidence accepted by its
  wide band, only the input and `uagContext` sent to engines — and saving a
  claim through the UAG, where its "Agent: Run task" action re-decides triage
  before the save (a tampered value corrected, an unconfirmed authoritative
  value cleared, a confirmed ordinary value kept, and the save refused when the
  server's decision makes a skipped page apply). An update through the UAG is
  checked for the same three outcomes, and a claim saved straight to Form.io
  runs no task.
- *Field types* (`layer1.agent-fields.e2e.mjs`): a support-incident form with
  each decision shape — a customer matched from the resource by name (or
  reported as no match, with the new name extracted), select boxes, a
  multi-select, a described severity scale, a yes/no, a closed-set field routed
  to the agent engine — plus the `agent_decide` MCP tool's compiled questions,
  a saved incident decided after the save (Run task) with provenance, and
  data-grid fields left alone.
- *Routing and operations* (`layer1.agent-routing.e2e.mjs`): fallback past an
  engine that is down and one that times out, decision-to-agent fallback, a
  value field falling back past an agent engine that is down and naming every
  engine once none can answer, streamed results arriving as each engine
  finishes, capability reporting, `503` with no engine, per-caller `429` with
  `Retry-After`, and startup refusing an unknown engine name or a missing
  setting.
- *Run task, generate and research* (`layer1.agent-tasks.e2e.mjs`):
  applications saved through the UAG, with "Agent: Run task" on the
  application form (`E2E_RUN_TASK`) writing an assessment after the save, once;
  the task's read-only research tools; values for fields outside the task
  discarded; no write reaching another submission (the agent has no write
  tool); no task for an application saved straight to Form.io;
  `{form}/agent/generate` saving nothing; `/agent/run` gone; a signed-in user's
  application run with their own token; and their own Form.io permissions
  applying to the agent's research.
- *Engine instances* (`layer1.engines.e2e.mjs`): the real engine server
  package runs in its own process, with no Form.io credential, hosting the
  scripted engines; the UAG reaches them as `decide:remote` and
  `agent:remote`. Capabilities report the kind and model the engine server
  describes; decide and extract go through it, extract with no tools and no
  scoped token; generate's research is offered only the task's read-only tools
  (a write is refused), and its calls are reported.
  Then two `e2e-decision` instances under their own names are routed by name,
  answer exactly as the remote one did, and the deciding instance is recorded
  in the saved submission.
- *Remote engine* (`layer1.agent-remote.e2e.mjs`): a fake engine server,
  speaking the remote engine protocol, hosts a `claude:remote` instance. Plain
  extraction carries no tools and no scoped token; requests carry only the
  engine server key, never a Form.io credential; for generate's research, a
  token for the task's read-only tools only (no write reaches any submission),
  lasting the research timeout (`agentApi.research.timeout`, 4000 ms in this
  suite), refused on the Agent API and once expired; the caller's identity for
  a user's generate; the engine server's tool calls reported; and a failing
  engine server reported as an engine failure without its hidden message
  (`503`, nothing saved).

**Project changes** (`layer1.project-sync.e2e.mjs`, no model keys; needs `E2E_UAG_LICENSE`): the
UAG following the project it serves, with `PROJECT_TTL=2`. A uag-tagged form
created in Form.io after startup is offered to agents and decided through the
Agent API, and is dropped once deleted; removing a form's `uag` tag drops it;
claims saved through the UAG are still re-decided after a refresh rebuilds the
form routes; and a template action deleted from a form the project already has
is installed again when the next UAG starts (`TEMPLATE_SYNC=boot`).

**The demo site** (`layer1.demo-*.e2e.mjs`, no model keys; `demo-workflow` and `demo-formflow`
need `E2E_UAG_LICENSE`, and the browser tests need Chromium): the [demo site](../../demo) as it runs in production, on the
open-source stack (`helpers/demoStack.mjs`). `E2E_TEMPLATE=demo` installs the
demo's own `module/project.json`; both engines run on the real engine server
package, hosting the scripted engines; every call passes through the demo's
flow proxy (`demo/flow/proxy.mjs`); and the site itself (`demo/server`) runs
in front, driven as a visitor would, with a cookie (`visitor()`). The site saves
applications and claims through the UAG, whose "Agent: Run task" actions run
the agents, so the workflow needs no webhooks and runs on Open Source.

- *Agentic workflow* (`layer1.demo-workflow.e2e.mjs`): applications submitted
  through the site. The scripted agent follows the criteria, so the sample
  applicants (`demo/module/applicants.mjs`) always land the same way: weak
  declined, average accepted, strong accepted with a scholarship and then
  awarded a full ride by the finance task, which the admissions task's update
  starts only for the strong one. It also checks that the chain stops, that a
  save through the UAG keeps the agents' values and runs no task, that the
  browser cannot pre-fill the agents' fields, the `sum` smoke test, that the
  flow viewer shows the applicant the engine calls of both tasks (under the
  request id of their submission), and that another visitor can read neither
  the application nor its runs.
- *Conversation form* (`layer1.demo-conversation.e2e.mjs`): the page embeds
  the service request form with `Formio.createChat`, and each turn is the UAG's
  `{form}/agent/chat`, answered by the scripted agent engine's chat turns (no
  model key). It checks that the site serves only the chat's form, the fields
  the UAG offers the engine, values taken from `Label: value` pairs, an invalid
  email refused with the form's own validation message and a reply rewritten
  to say so, completion and confirmation, the submission saved in Form.io
  through the UAG, an injected value for a field a person may not set dropped,
  each turn in the flow viewer as `/agent/chat`, and message limits; and, in
  the browser, the chat page (with the form behind it) and the example page
  around it, its embed link and the flow viewer.
- *Agentic Formflow, in a browser* (`layer1.demo-formflow.e2e.mjs`): the claims
  wizard and the scripted engines, using the page's own "Try an example"
  buttons. For "Rear-ended, neck pain": the rail's triage, the steps added and
  their reasons, fields filled from the description and marked, the follow-up
  fill of the steps added, a vehicle the user corrected kept when the changed
  description is read again, and the wizard completed, with the claim saved
  through the UAG (so its Run task action re-decides triage) and its number
  shown. For "Car stolen": the theft steps and no injury step. And the example
  page, with the extraction's engine legs in the flow viewer.

The demo site's own unit tests (`demo/test`, run by `yarn test`) cover the
spend guard, sessions, flow ownership, the chat's form filter, templating, and
that every page and docs link resolves.

**uag-eval** (`cli.uag-eval.e2e.mjs`, no Docker, no credentials): the
evaluation command's report and JSON output against the stub decision engine,
and its argument errors.

**Layer 3 — Agent API with real engines** (`layer3.agent-engines.e2e.mjs`,
needs `CLAUDE_API_KEY`; JEV is used too when `TYPESAFE_API_KEY` is set and its
SDK is installed): FNOL triage and extraction by the bundled engines, and
`{form}/agent/generate` with the bundled Claude engine reviewing an application
(researching with the task's read-only tools), including an essay that tries to
change the applicant's GPA.

**Layer 3 — full-stack flows** (real Claude, full stack):

- *Conversation Forms* (`layer3.conversational.e2e.mjs`): Claude acts as a
  conversational front-end for the uag-tagged `customer` resource. The test
  plays the user with scripted turns ("I would like to add a new Contact",
  the contact's details, a submit confirmation) and asserts the conversation
  produces a correct submission in Form.io — including the conditionally
  required `otherReferral` field.
- *Conversation Forms with invalid input*
  (`layer3.conversational-invalid.e2e.mjs`): the flow-level counterpart to the
  failure-path suite. The scripted user supplies a malformed email and an
  out-of-option referral source and pushes to submit; the agent must refuse,
  and only the corrected values may reach the database. A regression that
  hides validation messages shows up here as the agent confirming a
  submission that does not exist.


**Layer 3 — the demo site, as it ships** (`layer3.demo-stack.e2e.mjs`, needs
`E2E_FORMIO_LICENSE`, `E2E_DEMO_UAG_LICENSE`, `CLAUDE_API_KEY` and
`TYPESAFE_API_KEY`, and Chromium; several minutes): the release check for the
demo. It builds this tree as `formio/uag:e2e-local` and starts the demo's own
`docker-compose.yml` with its `docker-compose.enterprise.yml` overlay (Enterprise Form.io, the setup job) and
`docker-compose.split.yml` overlay (the engine server with JEV and Claude, and the flow proxy as its own
service, so the viewer shows each engine call), with the UAG and the site under the Compose
project `uag-e2e-demo`, with the site on 127.0.0.1:3430. Inside the network, an
OAuth client's discovery chain from `/mcp` (the challenge, both metadata
documents, and the authorize, token and register endpoints they name) must
resolve at the root for the Enterprise project. Through the site: a
scripted customer talks to the form's chat (the UAG's `agent/chat`, answered
by Claude) until the form is complete and confirmed, with the category and
urgency mapped to the form's options, and the request is saved through the UAG; Run task actions and
Claude decline the weak applicant and award the strong one, and then stop
changing either; and in a browser, the claims wizard's collision, stolen car
and burst pipe examples are triaged as their kind of claim, with their steps
added and no others, and the JEV and Claude legs shown in the flow viewer.

**Layer 3 — the Getting Started guides, as documented** (`layer3.getting-started.e2e.mjs`,
`yarn test:getting-started`; a few minutes): the release gate for the page most
people run the UAG from first (`demo/views/pages/getting-started.html`). It reads
each guide's commands from the page itself and changes only what it lists: the
placeholders a reader fills in, the image under test, and host ports (3441 to
3445), so a UAG already running on this machine is left alone. A page edit that
removes text an edit expects fails the suite, naming the text.

- **Open Source, self-hosted** (Docker only): the page's `docker-compose.yml`;
  the portal login it names; a form tagged `uag` after the UAG started, which an
  agent must be offered without a restart; the page's MCP client, which must
  print the tools and exit by itself; a conversation that submits to Form.io;
  and the Agent API's license answer.
- **Hosted project** (`E2E_HOSTED_PROJECT_URL`, `E2E_HOSTED_PROJECT_KEY`,
  `CLAUDE_API_KEY`): the page's `docker run`, its MCP client and its Agent API
  `curl`, which must triage the claim. The project needs the demo's `claim`
  form (`demo/module/project.json`); https://uag.form.io has it.
- **Enterprise, self-hosted** (`E2E_FORMIO_LICENSE`, `CLAUDE_API_KEY`,
  `TYPESAFE_API_KEY`): the page's `formio-uag` service beside Form.io
  Enterprise, with `LICENSE_KEY` as its only license, so the license must
  include the UAG and allow `formio.e2e.test`. Its project is made from the
  demo's template; the MCP client and the `curl` run against it, with JEV
  deciding the claim type.

A guide whose variables are missing is skipped, unless `E2E_STRICT=true`, which
the release workflow sets, so it fails instead. `E2E_UAG_IMAGE` runs a
published image instead of building this tree.

The layer 3 demo suite passes its own env file with `--env-file`, so the
demo's own `.env` is never read, and always tears its stack down with its
volumes (`helpers/exampleStack.mjs`). It gives the Form.io service the network
alias `formio.e2e.test` and points the UAG's `PROJECT` at it, so a test license
for that endpoint works; Enterprise Form.io reads a dotted host as a project
subdomain, so the UAG loads the project by its ID URL there.

## Test project

The stack uses `test/e2e/module` as the UAG runtime module. Its
`template.json` extends the `demo/samples/custom-module` project with:

- a `referralSource` select (required, and `onlyAvailableItems` so that values
  outside its options are rejected rather than stored) paired with
  `otherReferral` (a conditionally required textfield shown only when the
  referral source is `other`), on the `customer` resource, and
- an `application` form (trimmed college application) whose
  "For Office Use Only" panel carries the assessment criteria Content
  component (`uag=application`, `uagField=criteria`) and the agent-fillable
  fields `aiEssayScore`, `aiRecommendation`, and `aiSummary`.

`module/index.js` adds the Agentic Formflow demo's `claim` form (with its Run task
action), and the `incident` and `routing` forms from `module/forms.js`, and
lets the stock `authenticated` role work on applications so the suites can
check a signed-in user's permissions.

Each suite that uses the stack boots its own and tears it down (including the
Mongo volume), so runs are isolated and repeatable. The uag-eval suite needs no stack.
