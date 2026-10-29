# Demo recordings

<sub>[Form.io UAG](../../README.md) &rsaquo; [Demo site](../README.md) &rsaquo; this page</sub>

The animated GIFs in the documentation are recorded from the demo site by the Playwright scripts in this folder, so they can be re-recorded whenever the demo changes. Each GIF follows a storyboard below; each scene in [`scenes/`](./scenes) is that storyboard written as code.

```bash
yarn build                       # the UAG from this checkout
yarn demo:record                 # all three; or: yarn demo:record formflow
```

Each recording runs on a stack the recorder starts and stops itself, with **real engines** (JEV and Claude):

| Recording | Stack | Needs, in the root `.env` |
|---|---|---|
| Conversation forms | The e2e Open Source stack: Form.io Open Source and its portal, the UAG, the engine server, the flow proxy and the site | `TYPESAFE_API_KEY`, `CLAUDE_API_KEY` |
| Agentic workflow, Agentic Formflow | The demo self-hosted on Form.io Enterprise, with the Enterprise portal (`PORTAL_ENABLED=1`): the [layer 3 demo suite's](../../test/e2e/layer3.demo-stack.e2e.mjs) stack, in [`enterprise.mjs`](./enterprise.mjs). It builds the UAG image from this tree, so it takes a few minutes, then connects a portal stage, **UAG Gateway**, to the UAG ([Connecting the Enterprise portal](../content/developers/deployment.md#connecting-the-enterprise-portal)). `E2E_LOCAL_CORE` (appserver-core's `build/`) and `E2E_LOCAL_APPSERVER` (the appserver repository) build the image against unpublished local builds of both, as for the layer 3 suite. | Also `E2E_FORMIO_LICENSE` and `E2E_DEMO_UAG_LICENSE` (or `E2E_EXAMPLE_UAG_LICENSE`) |

To record against stacks that are already running, set `RECORD_SITE_URL` (and `RECORD_PORTAL_URL`) for the Open Source one, and `RECORD_ENTERPRISE_SITE_URL`, `RECORD_ENTERPRISE_PORTAL_URL`, `RECORD_ENTERPRISE_EMAIL`, `RECORD_ENTERPRISE_PASSWORD` and `RECORD_ENTERPRISE_STAGE` (the connected stage's project id) for the Enterprise one.

It needs Chromium for Playwright (`npx playwright install chromium`) and Python 3 with Pillow (`pip install pillow`), which assembles the GIFs. They are written to `demo/public/images/demo-<name>.gif`.

## How a recording is made

- **Frames** come from Chromium's screencast, which sends a frame only when the screen changes, with its timestamp. Nothing is lost while the page is still, and the GIF stays small.
- **The cursor and captions** are drawn into the page by [`director.mjs`](./director.mjs): a pointer that glides to each control before it is used, and a numbered caption for each step of the storyboard.
- **Waiting is edited, not hidden.** Signing in is cut. Waiting for a model is sped up, with a "sped up" badge, so the viewer sees that work happened without watching it in real time. [`encode.py`](./encode.py) applies the cuts and speed-ups, resamples to 10 frames a second and writes the GIF at 960 pixels wide.
- **The frame** on an example page is its demo alone: the app on the left and the flow viewer ("Behind the scenes") on the right, filling a screen narrowed to 1024 pixels, with the site's navigation and the page around the demo covered. Every GIF shows what the agent did as well as what the user saw, large enough to read.
- **Close-ups.** In the portals, the director's `focus` frames the part a step is about: the forms list, a component's custom properties, a Run task action's settings. [`encode.py`](./encode.py) crops every frame to that view and pans between views, and never enlarges text past its own size; the caption follows the view.
- **Secrets stay out.** Key-like values on screen are shown as dots before they are recorded, and every stack's keys are random and thrown away with it.
- **Portals scroll the way a person would.** The Open Source portal shows a form in a fixed-height panel that scrolls on its own, so the scenes scroll that panel; scrolling the window would leave the bottom of the form cut off.

## Storyboards

### Conversation forms (`demo-conversation.gif`, about 40 s)

What it must show: the form is the whole script, a person talks in plain language to a chat embedded with `Formio.createChat`, the UAG's chat asks only for what is missing, and the result is an ordinary, validated Form.io submission. Everything runs on Form.io Open Source; Claude answers the chat as the UAG's agent engine.

| # | Screen | Action | Caption |
|---|---|---|---|
| 1 | Open Source portal, forms list | (Sign-in is cut.) Glide to **Service Request**, open it. | 1 · A Form.io form, tagged `uag`. Its fields are the whole script. |
| 2 | Form builder | Pause on the `uag` tag, then scroll the form's panel over Category and Urgency, whose options the agent will use, down to the end of the form. | (same) |
| 3 | Conversation Forms example | Click the suggestion "My internet has been down since last night". The turn is sped up; the flow viewer shows the form's `/agent/chat` and the engine call. | 2 · A person describes the problem. The UAG's chat reads the form: its fields, rules and options. |
| 4 | Same | Type name, email, address, how bad it is and when to call, in one sentence. Sped-up turn (one more if the chat still asks); the summary appears, mapped onto the form's own options. | 3 · One sentence fills several fields, mapped onto the form's own options. |
| 5 | Same | Click **Submit request** in the summary. The "Saved in Form.io" card appears. | 4 · The person checks the summary and submits. The form saves itself through the UAG. |
| 6 | Portal, **View Data** | Open the form's data: the new submission is in the table. | 5 · An ordinary Form.io submission, with the user's permissions. |

### Agentic workflow (`demo-workflow.gif`, about 45 s)

What it must show: the rubric lives in the form, an "Agent: Run task" action starts the agent after the save, the UAG saves its results as an update, and that update starts the second agent. No person reviews anything.

| # | Screen | Action | Caption |
|---|---|---|---|
| 1 | Enterprise portal, the **UAG Gateway** stage (connected to the UAG), College Application builder | (Sign-in is cut.) Open the **Admissions Review (Agent)** page of the wizard: the criteria content component. | 1 · The admissions rubric is a content component in the form. |
| 2 | Its settings, **API** tab | Open the criteria's settings: the custom properties `uag: admissions` and `uagField: criteria`. | 2 · Its custom properties make it the criteria of the `admissions` task. |
| 3 | **Actions → Agent: Run task (admissions)** | Open the action: its **Task** is `admissions`, and it runs **After the save, in the background**, on **Create**. The portal opens it because these screens use the stage connected to the UAG. | 3 · An "Agent: Run task" action runs the `admissions` task after each application is saved. |
| 4 | Agentic Workflow example | Choose the sample applicant Amara Okonkwo; step through her application to the essay; **Submit Form**. | 4 · An applicant submits. Nobody reviews it by hand. |
| 5 | Same, status page | "Under review". The admissions agent's run is sped up; the flow viewer shows the save through the UAG and the engine calls. The decision and scores appear. | 5 · The admissions agent scores the application. The UAG saves its results as an update. |
| 6 | Same | The finance agent's run is sped up; scroll to the scholarship award and its rationale. | 6 · That update runs the finance task's action, and the finance agent picks the award. |

### Agentic Formflow (`demo-formflow.gif`, about 70 s)

What it must show: the task is configured in the form, the person writes one description, a decision engine chooses the wizard's steps in a fraction of a second, an agent engine prefills the rest as suggestions, the person's own input always wins, and the claim is re-decided on the server when it is submitted.

| # | Screen | Action | Caption |
|---|---|---|---|
| 1 | Enterprise portal, the **UAG Gateway** stage (connected to the UAG), First Notice of Loss builder | (Sign-in is cut.) Open the settings of "Tell us what happened", **API** tab: `uag: triage` and `uagField: input`. | 1 · The claim form defines a `triage` task. The description is the text it reads. |
| 2 | The **Check our understanding** page | Open Claim type's settings, **API** tab: `uagThreshold: 0.6` and `uagConfidenceField`. The page appears when the claim type is empty or its confidence is under 0.6. | 2 · Claim type is a decision field. When JEV is under 60% sure, this page asks the person to check it. |
| 3 | **Actions → Agent: Run task (triage)** | Open the action: its **Task** is `triage`, it answers **Its decision fields only**, and it runs **Before the save** on **Create** and **Update**. The portal opens it because these screens use the stage connected to the UAG. | 3 · An "Agent: Run task" action re-decides the `triage` task on the server, before every create and update. |
| 4 | Agentic Formflow example, step 1 | Type the policy number, then the description: "Someone rear-ended me at the light on Main St and 4th Ave in Springfield yesterday around 5:30pm. My neck hurts." | 4 · The policyholder describes what happened, once. |
| 5 | Same | **Continue**. Open the step list: 5 steps became 9, each new one with its reason ("You described a collision"). The flow viewer shows `jev decide` in a few hundred milliseconds. | 5 · JEV classifies the claim in milliseconds, and the wizard adds only the steps that apply. |
| 6 | Step 2, When and where | The date, time and place are filled in and marked "Suggested from your description". Add the state to the place. | 6 · Claude fills in dates, places and names as suggestions. Your own input always wins. |
| 7 | Steps 3 to 8 | Step through quickly: injuries and the other driver prefilled, a police report number and contact details typed in (sped up). | 7 · Every step the description answered is already filled in. |
| 8 | Review, then confirmation | Tick the attestation, **Submit claim**, show the claim number. | 8 · Submitted. Its Run task action re-decided the claim on the server before it was saved. |
