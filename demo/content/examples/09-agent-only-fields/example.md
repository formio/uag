---
title: Agent-only form fields
summary: Mark a field as the agent's, and any value a person submits for it is thrown away, so only the agent can set it.
group: Workflows
mode: workflow
docs: ../../developers/form-properties.md#uagauthoritative
highlight: uagAuthoritative
---

Some fields must come from the agent and nobody else: a priority that routes work, a flag that holds something for review, a score. `uagAuthoritative: "true"` marks them. Whenever a submission is created or updated through the UAG, any value the browser sent for those fields is thrown away first, so the only value saved is the agent's.

This form leaves the two fields open so you can try. Type a summary, choose a priority, and submit: the saved submission comes back without your values, and the agent's appear a few seconds later.

This applies to submissions sent through the UAG. To also protect the fields from someone who sends a submission straight to Form.io, the action can act with an agent role of its own; see the developer docs.

## Try these

- Please update the phone number on our account when you get a chance. No rush.
- Everything is down for our whole office and nobody can work. Please help now!
