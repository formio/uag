# Developer documentation content

Each `*.md` file here (except this one) is one page under `/developers/<slug>`, where the
slug is the file name; `index.md` is `/developers` itself. The demo server renders them
with `marked` (GitHub-flavored Markdown, raw HTML allowed) inside the site layout.

## Front matter

Every page starts with:

```
---
title: Agent API
description: One sentence, used for the page subtitle, the sidebar tooltip and the meta description.
section: Build
order: 40
---
```

`section` is one of `Start here`, `Concepts`, `Build`, `Extend`, `Operate`. The sidebar
groups pages by section in that order, and sorts each group by `order`.

## Conventions

- One `#` heading is generated from `title`; start the body with prose or `##`.
- Every heading gets an anchor; `##` headings also feed the "On this page" list.
- Links between pages: `/developers/<slug>` (and `#anchor`). Demo pages:
  `/examples/conversation`, `/examples/workflow`, `/examples/formflow`, `/contact`.
- Source links: `https://github.com/formio/uag/blob/main/<path>`.
- Images: `/images/<file>`, from `demo/public/images`.
- Callouts: a blockquote whose first word is bold, `> **Note:**`, `> **Warning:**`, `> **Tip:**`, `> **Important:**`.
- Code fences carry a language (`bash`, `json`, `js`, `ts`, `yaml`, `http`, `dockerfile`, `text`, ...).
- Architecture pictures are SVG files in `demo/public/images` (`uag-*.svg`), shared with the repository README. Keep them on their own white card so they read on light and dark pages.
- Diagrams are fenced blocks drawn as SVG by `server/diagrams.mjs`: ` ```sequence ` (participants and messages) and ` ```pipeline ` (steps joined by `->`). See that file for the syntax.
