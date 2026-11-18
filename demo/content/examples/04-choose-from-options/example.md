---
title: Choose from a set of options
summary: The AI picks a choice field's option from the person's words, using a description of what each option means.
group: Fill in forms
mode: form
docs: ../../developers/form-properties.md#uagoptiondescriptions
highlight: uagOptionDescriptions
---

When the AI fills a select or radio field, it can only pick one of the field's options, never write something else. It also says how sure it is (see [Leave unsure answers to the person](../05-confidence/example.md)).

Before picking an option, the AI checks whether the text says anything about the field at all, using the field's label as the question. So write the label as a question the text itself answers ("What is it about?", not "Which team should handle it?"); otherwise the AI may decide the text does not mention it and leave the field empty.

Option labels alone are often too short to choose well. `uagOptionDescriptions` adds a sentence to each option saying what it covers, as you would explain it to someone filling in the form; for example, Billing: "Payments, charges, refunds, receipts and prices." It is a JSON object from each option's value to its description.

Try the samples. Each fits a single option, but only once you read the option descriptions: a receipt with the wrong amount is Billing, and an export that comes out empty is Product. **How urgent is it?** works the same way.

## Try these

- I was charged on the 1st but my receipt shows a different amount. Can you check which one is right? No rush.
- The export button gives me an empty file every time, and my report is due this afternoon.
- It would be great if the search remembered my last filters. Nothing is broken, it is just an idea.
