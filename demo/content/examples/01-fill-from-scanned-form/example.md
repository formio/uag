---
title: Fill an online form from a scanned paper form
summary: A person uploads a scan of a paper form they filled in by hand, and the online version of the form fills itself in from it.
group: Fill in forms
mode: form
docs: ../../developers/ai-document.md
highlight: plugin, instructions, target, uagField
---

Paper forms do not go away: people print them, fill them in by hand, and send a scan or a photo. This example reads that scan into the online version of the same form, in two steps, each of which the person can see and correct:

1. An **AI Document** component reads the scan. Its `analyze` process gives the document to a model that reads images, with the form designer's `instructions`: transcribe each handwritten field as `Section, Label: value`. The transcript goes into the form's **What the scan says** field, its `target`.
2. **Agent Input** fills the form's fields from that transcript, as in [Fill a form from a description](../02-fill-from-description/example.md): the transcript field is the task's input (`uagField: "input"`), and each panel names the task in `uag`.

The scan is turned into a PDF by the UAG's built-in image converter, so a PNG, a JPEG and a scanned PDF all work. Nothing is saved until the person checks the form and submits it, and the form's own validation applies to every value. Correct a line of the transcript and leave the field, and the form follows.

The page code waits for the AI Document's result, then asks Agent Input to read the transcript. The [blank paper form](paper-form.pdf) and the [sample scan](sample-scan.jpg) are the two sides of this example: the paper the person filled in, and what their scanner made of it.

This example needs the AI Document module and its `analyze` process in the UAG (the `formio/uag-documents` add-on), and an engine that reads documents, such as Claude.

## Try these

- [Use the sample scan](sample-scan.jpg)
