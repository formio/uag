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

Try the clear sample, then the vague one, and compare the confidence each topic gets.

## Try these

- My password reset email never arrives. I've tried three times today. Can someone call me back about it?
- I'm writing about my account. Things have been a bit different lately and I'm not sure what to make of it.
- Thanks for fixing the issue so quickly last week, everything works now.
