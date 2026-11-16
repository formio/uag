---
title: Chat widget
summary: Any form tagged uag can be filled in as a chat: the widget asks for what the form needs, then submits it.
group: Chat widget
mode: chat
docs: ../../developers/chat.md#embed-a-chat
highlight: uagChatInstructions
---

`Formio.createChat` renders a form as a chat. Each turn goes to the form's `agent/chat` on the UAG, which reads the person's message, fills in what it can, and asks for the rest, one thing at a time. The questions come from the form: its fields, labels, descriptions, options and validation. When the form is complete, the widget shows a summary, and the person confirms before it is submitted, through the UAG, like any other submission.

`uagChatInstructions` adds instructions of your own, such as a tone. The widget's text, buttons and styles are all templates you can change.

Type a message, or pick a sample to start.

## Try these

- Hi, I have a question about opening hours.
- I'd like to report a problem with my order.
- Can I suggest a feature?
