---
title: Run an agent task after a submission
summary: Saving the form starts an agent in the background, which reads the submission and saves its answers back to it.
group: Workflows
mode: workflow
docs: ../../developers/workflows.md#step-2-add-agent-run-task
highlight: uag, uagField, uagEngine, uagAgentDecides
---

An **Agent: Run task** action on the form runs a task on the server, with no one waiting. Here, after each new submission is saved, the `review` task reads the message, writes a one-line summary and chooses an urgency, and the UAG saves them as an update to the submission. The update's own actions run as for any update, so it can start the next task, send an email, or call a webhook.

The task's **criteria** (a content component with `uagField: "criteria"`) is the agent's briefing. `uagEngine: "agent"` sends the whole task to an agent engine, and `uagAgentDecides` lets it set the urgency, a choice field, on the server.

Submit the form, and watch the log: the save comes back at once, then the page reads the submission until the agent's answers are on it. The **Action** tab shows the action's settings.

## Try these

- Our team can't open any shared files since this morning, and we present to a client at 3pm today.
- When you have a moment, could you add my colleague to our shared workspace?
