---
title: Confidence and the unsure band
summary: Each decision comes with a confidence; below the threshold the form says it is unsure and leaves the choice to the person.
group: Fill in forms
mode: form
docs: ../../developers/form-properties.md#uagconfidencefield
highlight: uagThreshold, uagUncertainBand, uagConfidenceField
---

A decision engine says how sure it is. The form decides what "sure enough" means:

- `uagThreshold` is the confidence a choice needs. Below it, the field is **uncertain**: Agent Input suggests the likeliest option and its alternatives, and the person picks.
- `uagUncertainBand` is the range of probabilities treated as unsure for a yes/no field, such as a checkbox: inside it, the box is neither ticked nor cleared for the person.
- `uagConfidenceField` writes the confidence to another field, so ordinary conditions can act on it. Here, a note appears when the topic is uncertain.

Try the samples in order. The thank-you note is plainly feedback: the topic is chosen, with a confidence near 1. The second is both a request and a problem: the decision engine also asks with the options in reverse order, the answer changes, so the topic is only suggested, its confidence stays under the threshold, and the note appears. It plainly asks for a call back, so the follow-up box is ticked. The third barely says what it is about.

## Try these

- Thanks for fixing the issue so quickly last week, everything works now.
- I want to change the email on my account, but the settings page shows an error every time I try. Please call me back.
- I'm writing about my account. Things have been a bit different lately and I'm not sure what to make of it.
