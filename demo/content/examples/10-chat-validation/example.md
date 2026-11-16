---
title: Validation in the chat widget
summary: The chat holds every answer to the form's own validation, and asks again with the form's error when an answer does not fit.
group: Chat widget
mode: chat
docs: ../../developers/chat.md#how-a-conversation-goes
highlight: validate
---

A chat fills in the same form, so the same rules apply. Every value the UAG takes from a message is checked against the form's validation: required fields, types, minimums and maximums, patterns, and custom error messages. A value the form refuses is not kept; the chat says why, in the form's words, and asks again. Nothing invalid can be submitted, because the save goes through the same checks.

This form wants a quantity from 1 to 10, an order code like `ABC-1234`, and a valid email. Try the samples, which break each rule, and correct them in the chat.

## Try these

- Please change order 1234 to 25 units.
- My order code is abc1234 and I want 3. Send the confirmation to sam at example dot com.
