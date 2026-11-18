---
title: Leave unsure answers to the person
summary: The AI says how sure it is of each choice. When it is not sure enough, it marks its pick for the person to check and offers the other likely options.
group: Fill in forms
mode: form
docs: ../../developers/form-properties.md#uagconfidencefield
highlight: uagThreshold, uagUncertainBand, uagConfidenceField
---

When the AI answers a choice, it also says how sure it is: its **confidence**, a number from 0 (a guess) to 1 (certain). The form, not the AI, sets how sure is sure enough. Below that, the AI still fills in its best guess, but marks it "Please check this." and offers the other likely options as buttons, so a guess never looks like a sure answer.

Use it where a wrong answer costs more than asking. Three settings in this form do it:

- **What is the message about?** has `uagThreshold: 0.7`. When the AI is at least 0.7 sure of the topic, it selects it. Below 0.7, it still selects its best guess, but marks it for the person to check and shows buttons for the other likely options.
- **Confidence in the topic** receives that number, because the topic field names it in `uagConfidenceField`. It is an ordinary field, so the form's ordinary logic can use it. Here a note asks the person to check the topic when the confidence is below 0.7. It could as well show an extra page, or send the submission to a reviewer.
- **Does the sender ask to be contacted?** is a yes/no checkbox, so it uses a range instead of a threshold. The AI rates how likely the answer is yes, and how likely it is no. `uagUncertainBand: 0.3-0.7` makes 0.3 to 0.7 the gray zone. The box is ticked when yes is above 0.7 and no is below 0.3, and cleared in the opposite case. If the message does not mention it at all (both below 0.3), the box is left alone. Anything else sets the box to the likelier answer and marks it for the person to check.

The marks guide the person; they do not stop a submit. To make the person check each marked answer before moving on, turn on Agent Input's `requireReview` option.

Try the samples in order:

1. A thank-you note is plainly feedback. The topic is selected, with a confidence near 1, and no note appears.
2. This message is both a request and a problem. The AI is asked twice, with the options in a different order; when its two answers differ, as they usually do here, the topic counts as unsure. The topic is filled in but marked to check, and the note appears. The message plainly asks for a call back, so the box is ticked.
3. This one barely says what it is about. See what the AI decides, and what it marks for you to check.

## Try these

- Thanks for fixing the issue so quickly last week, everything works now.
- I want to change the email on my account, but the settings page shows an error every time I try. Please call me back.
- I'm writing about my account. Things have been a bit different lately and I'm not sure what to make of it.
