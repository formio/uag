---
title: Human answers take priority
summary: If the person changes a field and then rewrites their request, the AI updates its own answers but leaves the person's changes alone.
group: Fill in forms
mode: form
docs: ../../developers/renderer.md#rules-agent-input-keeps
highlight: uag
---

**Agent Input**, part of the UAG's browser library `@formio/uag-js`, fills the form from what the person writes in **Describe your request**, and fills it again whenever they rewrite it. Each time, it updates only the fields it filled itself and the ones still empty. A field the person typed in, picked or corrected belongs to them: it is never overwritten, and the AI does not answer it again.

The same holds when the AI is unsure and offers options (see [Leave unsure answers to the person](../05-confidence/example.md)): once the person picks one, it is theirs.

Try it: pick the first sample, change the **Name** field, then pick the second sample. The email, topic and subject change to match the new text; the name stays as you typed it.

## Try these

- This is Casey Brooks, casey@example.com. I have a question: do you ship to Canada?
- Casey again, from my work address casey.brooks@example.org. Actually there is a problem: my last order arrived damaged.
