---
title: Generate written text
summary: The AI writes a text field, such as a draft reply, from the rest of the form, and the person edits it before saving.
group: Fill in forms
mode: form
docs: ../../developers/agent-api.md#generate
highlight: uag, uagField
---

The AI can write free-text fields, such as a reply, from what is already in the form. Here it writes the **Reply** field, which is marked with the task name `reply` in `uag`.

Its instructions are part of the form: the **Criteria** text (a content component marked `uagField: "criteria"`) tells the AI what to write, and it gets no other instructions. Because they live in the form, whoever designs the form controls what the AI writes, and can change it in the form builder without touching code.

Nothing is saved by generating. When the **Draft a reply** button is pressed, the page code asks the UAG's `agent/generate` for a draft and puts it into the **Reply** field, where the person can change it before submitting. Pressing the button again replaces the reply with a new draft.

Try it: pick a sample to fill in the message, then press **Draft a reply**.

## Try these

- Hi! I love the new update, but the font in the menus is now very small on my phone. Is there a way to make it bigger?
- I was charged twice for the same order on the 4th. Could you look into it?
- Can I move my booking from Friday to the following Monday?
