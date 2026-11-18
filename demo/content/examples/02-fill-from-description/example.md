---
title: Fill a form from a description
summary: A person describes what they need in their own words, and the form's other fields fill themselves in from it.
group: Fill in forms
mode: form
docs: ../../developers/renderer.md#set-up-the-form
highlight: uag, uagField
---

**Agent Input**, part of the UAG's browser library `@formio/uag-js`, reads what the person wrote in one field (**Describe your request**) and fills in the rest of the form from it. You choose which fields it fills by giving each one the same task name in its `uag` property (here `fill`), and you mark the field to read with `uagField: "input"`.

The AI only fills the fields in; the person can change any of them. Nothing is saved until the person checks the form and submits it, and the form's own validation applies to every value, whoever entered it.

Try it: type a request and click outside the box, or pick a sample, to see the form fill in. The **What the UAG did** panel beside the form shows the request to the UAG and what the AI returned for each field.

## Try these

- Hi, this is Dana Whitfield (dana.whitfield@example.com). On March 4th I was charged $129.99 twice for the same order. Could you refund the duplicate charge?
- My name is Sam Ortega and my email is sam.ortega@example.com. Since last Tuesday, the 14th, I have not been able to sign in to my account. Every time I try, it says my password is wrong, even after resetting it.
- Lee Park here, lee.park@example.com. I'd like to suggest adding a dark mode. I use the site late at night and the bright pages are hard on the eyes.
