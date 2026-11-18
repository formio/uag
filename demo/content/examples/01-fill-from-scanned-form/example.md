---
title: Fill an online form from a scanned paper form
summary: A person uploads a scan of a paper form they filled in by hand, and the online version of the form fills itself in from it.
group: Fill in forms
mode: form
docs: ../../developers/ai-document.md
highlight: plugin, instructions, target, uagField
---

Paper forms do not go away: people print them, fill them in by hand, and send a scan or a photo. This example reads that scan into the online version of the same form, in two steps, each of which the person can see and correct:

1. An **AI Document** field reads the scan. It sends the upload to an AI model that can read images, with instructions the form designer wrote in its `instructions` setting: copy each handwritten field as `Section, Label: value`. That transcript goes into the form's **What the scan says** field, the AI Document's `target`.
2. **Agent Input**, part of the UAG's browser library `@formio/uag-js`, fills the form's fields from the transcript, as in [Fill a form from a description](../02-fill-from-description/example.md). **What the scan says** is the field it reads (`uagField: "input"`), and every field it should fill carries the same task name in `uag` (here `fill`).

You can upload a PNG, a JPEG or a scanned PDF; the UAG turns images into a PDF before the AI reads them. Nothing is saved until the person checks the form and submits it, and the form's own validation applies to every value. If a line of the transcript is wrong, the person can correct it and click outside the box: the fields they have not changed themselves update to match.

A few lines of page code wait for the AI Document's result, then ask Agent Input to read it. Open the [blank paper form](paper-form.pdf) to see the original, and the [sample scan](sample-scan.jpg) to see a filled-in copy as a scanner captured it.

Try it: click **Use the sample scan**, or upload your own scan of the blank form (up to 3 MB), and watch the transcript appear and then the form fill in.

To run this on your own UAG, you need the AI Document add-on (`formio/uag-documents`) and an AI model that can read images, such as Claude.

## Try these

- [Use the sample scan](sample-scan.jpg)
