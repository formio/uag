---
title: An agent helps you fill out a form
summary: The form fills in while the AI works: choices such as topic and urgency appear in a fraction of a second, and details such as name and email a few seconds later.
group: Fill in forms
mode: form
docs: ../../developers/renderer.md#how-results-arrive
highlight: uag, uagField
---

The UAG sends its answers back in batches, each as soon as it is ready. **Choice fields** (here topic, urgency and tone) are picked in milliseconds by a decision engine, an AI built to choose between options. **Value fields** (name, email, date) are written a few seconds later by a larger AI model. Agent Input fills each batch into the form as it arrives, so the choices are in place while the details are still being read.

There is nothing to set up for this: every form the UAG can fill (one with the `uag` tag) works this way. A field's `uagEngine` property can choose which AI answers it.

Try it: pick a sample and watch the **What the UAG did** panel. Under the `agent/extract` request, the choices and the values are listed in the order they arrived, with the time each took.

## Try these

- Hello, Jordan Avery here (jordan.avery@example.com). Since Monday, November 2nd, nothing I upload goes through, and I have a deadline tomorrow. Please help as soon as you can!
- Hi, I'm Robin Chen, robin.chen@example.com. Just wanted to say the new layout is lovely and much easier to read. Thank you!
- Alex Moreno (alex.moreno@example.com) here. Do you offer a yearly plan, and if so, what does it cost?
