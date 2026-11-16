---
title: The person's own input wins
summary: When the description is read again, every value the person typed or changed stays as they left it.
group: Fill in forms
mode: form
docs: ../../developers/renderer.md#rules-agent-input-keeps
highlight: uag
---

Agent Input keeps a record of which values it wrote and which the person changed. When the description is read again, it updates only its own values and the empty ones. Whatever the person typed, chose or corrected is never overwritten, and it is never asked about again.

The same holds for the person's corrections to an uncertain suggestion: once they pick an option, it is theirs.

Try it: pick the first sample, change the **Name** field, then pick the second sample. The email and topic follow the new description; the name stays yours.

## Try these

- This is Casey Brooks, casey@example.com. I have a question: do you ship to Canada?
- Casey again, from my work address casey.brooks@example.org. Actually there is a problem: my last order arrived damaged.
