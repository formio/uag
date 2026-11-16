---
title: Streamed results
summary: Decisions arrive in a fraction of a second and values a few seconds later, each applied to the form as it comes.
group: Fill in forms
mode: form
docs: ../../developers/renderer.md#how-results-arrive
highlight: uag, uagField
---

The UAG answers an `agent/extract` call as a stream. Each group of engines sends its results as soon as it has them: **decision fields** (choices such as a topic, an urgency or a sentiment) are answered by a decision engine in milliseconds, and **value fields** (names, emails, dates) by a model a few seconds later. Agent Input applies each group to the form as it arrives, so the choices are in place while the values are still being read.

Nothing in the form asks for streaming; every form tagged `uag` gets it. Which engine answers which field comes from the UAG's routing, or from `uagEngine` on a field.

Pick a sample and watch the log: under the `agent/extract` call, the decisions and the values are listed in the order they arrived, with the time each took.

## Try these

- Hello, Jordan Avery here (jordan.avery@example.com). Since Monday the 3rd nothing I upload goes through, and I have a deadline tomorrow. Please help as soon as you can!
- Hi, I'm Robin Chen, robin.chen@example.com. Just wanted to say the new layout is lovely and much easier to read. Thank you!
- Alex Moreno (alex.moreno@example.com) here. Do you offer a yearly plan, and if so, what does it cost?
