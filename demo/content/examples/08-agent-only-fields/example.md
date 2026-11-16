---
title: Fields only the agent may set
summary: Fields marked as the agent's are removed from what a browser sends, so only the task can set them.
group: Workflows
mode: workflow
docs: ../../developers/form-properties.md#uagauthoritative
highlight: uagAuthoritative
---

Some fields must come from the agent and nobody else: a priority that routes work, a flag that holds something for review, a score. `uagAuthoritative: "true"` marks them. On every create and update sent to the UAG, the values a client sends for those fields are removed before anything runs, and the task's answer is the only one that gets saved.

This form leaves the two fields open, so you can try. Type a summary, choose a priority, and submit: the saved submission comes back without your values, and the agent's appear a few seconds later.

It protects requests sent to the UAG. To keep people off the fields on Form.io as well, the action can act with an agent role of its own; see the developer docs.

## Try these

- Please update the phone number on our account when you get a chance. No rush.
- Everything is down for our whole office and nobody can work. Please help now!
