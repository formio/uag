---
title: Chat widget
summary: Any form the UAG can fill can be filled in as a chat: the widget asks for what the form needs, then submits it once the person confirms.
group: Chat widget
mode: chat
docs: ../../developers/chat.md#embed-a-chat
highlight: uagChatInstructions
---

One call in the page code, `Formio.createChat`, shows a form as a chat. After each message, the UAG fills in what it can and asks for what is still missing. The questions come from the form: its fields, labels, descriptions, options and validation. When the form is complete, the widget shows a summary, and the person confirms before it is submitted, through the UAG, like any other submission.

`uagChatInstructions` adds instructions of your own. This form's ask the chat to be brief and friendly, ask for one thing at a time, and use the person's name. You can change the widget's text, buttons and styles.

Try it: type a message, or pick a sample to start.

## Try these

- Hi, I have a question about opening hours.
- I'd like to report a problem with my order.
- Can I suggest a feature?
