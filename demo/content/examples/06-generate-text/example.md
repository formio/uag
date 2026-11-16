---
title: Generate written text
summary: A model writes a text field, such as a draft reply, from the rest of the form, and the person edits it before saving.
group: Fill in forms
mode: form
docs: ../../developers/agent-api.md#generate
highlight: uag, uagField
---

`agent/generate` writes a task's open fields (text, dates, amounts) from the data the form already has. Here the task is `reply`: its **criteria**, a content component with `uagField: "criteria"`, tells the model what to write, and the reply field names the task in `uag`.

The criteria is the model's whole briefing. It is part of the form, so the person designing the form controls what the model writes, and it changes with the form, not in code.

Nothing is saved by generating. The page code calls the operation when the form's **Draft a reply** button is pressed, and puts the draft into the field, where the person can change it before submitting.

Pick a sample to fill in the message, then press **Draft a reply**.

## Try these

- Hi! I love the new update, but the font in the menus is now very small on my phone. Is there a way to make it bigger?
- I was charged twice for the same order on the 4th. Could you look into it?
- Can I move my booking from Friday to the following Monday?
