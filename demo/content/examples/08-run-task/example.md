---
title: Run an agent task after a submission
summary: Saving the form starts an agent in the background, which reads the submission and saves its answers back to it.
group: Workflows
mode: workflow
docs: ../../developers/workflows.md#step-2-add-agent-run-task
highlight: uag, uagField, uagEngine, uagAgentDecides
---

An **Agent: Run task** action on the form runs a task on the server, with no one waiting. Here, after each new submission is saved, an AI agent reads the message, writes a one-line summary and chooses an urgency (the fields of the form's `review` task), and the UAG saves them as an update to the submission. Saving that update runs the form's update actions, as any edit would, so it can start another task, send an email or call a webhook.

The **criteria** text (a content component marked `uagField: "criteria"`) is the agent's instructions. `uagEngine: "agent"` gives the whole task to a full AI agent instead of the fast decision engine. On the server, a choice field is normally saved only from the decision engine's answer, so `uagAgentDecides` lets the agent's choice of urgency be saved.

Try it: submit the form and watch the **What the UAG did** panel. The save comes back at once; then the page checks the saved submission every two seconds until the agent's summary and urgency appear on it. The **Action** tab shows the action's settings.

## Try these

- Our team can't open any shared files since this morning, and we present to a client at 3pm today.
- When you have a moment, could you add my colleague to our shared workspace?
