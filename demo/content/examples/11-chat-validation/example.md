---
title: Validation in the chat widget
summary: The chat checks every answer against the form's own rules, and when one does not fit, it explains why in the form's words and asks again.
group: Chat widget
mode: chat
docs: ../../developers/chat.md#how-a-conversation-goes
highlight: validate
---

A chat fills in the same form, so the same rules apply. Every value the UAG takes from a message is checked against the form's validation: required fields, types, minimums and maximums, and patterns, using the form's own error messages. A value the form refuses is not kept; the chat says why and asks again. Nothing invalid can be submitted, because the save goes through the same checks.

This form wants a quantity from 1 to 10, an order code like `ABC-1234`, and a valid email. The first sample gives an order code without letters and a quantity over 10; the second gives the code in the wrong format and spells out the email. The AI may fix some answers on its own; whatever the form still refuses, the chat asks for again. Correct the answers in the chat.

## Try these

- Please change order 1234 to 25 units.
- My order code is abc1234 and I want 3. Send the confirmation to sam at example dot com.
