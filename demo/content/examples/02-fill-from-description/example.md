---
title: Fill a form from a description
summary: A person describes what they need in their own words, and the form's other fields fill themselves in from it.
group: Fill in forms
mode: form
docs: ../../developers/renderer.md#set-up-the-form
highlight: uag, uagField
---

Agent Input reads one field, the task's **input**, and fills in the rest of the form from what the person wrote there. Each field the task should fill names the task in its `uag` property; the input field also has `uagField: "input"`.

The values arrive as suggestions. Nothing is saved until the person reviews the form and submits it, and the form's own validation applies to every value, whoever entered it.

Leave the description field, or pick a sample, to see the form fill in. The log beside the form shows the `agent/extract` call and what each engine returned.

## Try these

- Hi, this is Dana Whitfield (dana.whitfield@example.com). On March 4th I was charged $129.99 twice for the same order. Could you refund the duplicate charge?
- My name is Sam Ortega and my email is sam.ortega@example.com. Since last Tuesday, the 14th, I have not been able to sign in to my account. Every time I try, it says my password is wrong, even after resetting it.
- Lee Park here, lee.park@example.com. I'd like to suggest adding a dark mode. I use the site late at night and the bright pages are hard on the eyes.
