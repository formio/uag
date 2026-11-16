---
title: Choose from a set of options
summary: A choice field is decided from the person's words, using a description of what each option means.
group: Fill in forms
mode: form
docs: ../../developers/form-properties.md#uagoptiondescriptions
highlight: uagOptionDescriptions
---

A select or radio field that belongs to a task is a **decision field**: the UAG chooses one of its options, and never writes a value that is not an option. A decision engine answers it with a confidence, so the form can tell a sure answer from a guess.

Each field's label is asked of the text first: does it say anything about this at all? Phrase it as the question the text answers ("What is it about?", not "Which team should handle it?"), or the decision engine finds nothing to decide.

Option labels alone are often too short to decide well. `uagOptionDescriptions` gives each option a sentence saying which situations it covers, in the form's own terms, as a person filling it would be told. It is a JSON object from each option's value to its description.

Try the samples: each fits one team, but only once you know what each team handles.

## Try these

- I was charged on the 1st but my receipt shows a different amount. Can you check which one is right? No rush.
- The export button gives me an empty file every time, and my report is due this afternoon.
- It would be great if the search remembered my last filters. Nothing is broken, it is just an idea.
