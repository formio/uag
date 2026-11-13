# Developer documentation content

Each `*.md` file here (except this one) is one page under `/developers/<slug>`, where the
slug is the file name; `index.md` is `/developers` itself. The static site build
(`demo/scripts/build.mjs`, through `demo/lib/docs.mjs`) renders them with `marked`
(GitHub-flavored Markdown, raw HTML allowed) inside the site layout.

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
- Every heading gets an anchor, the id GitHub gives it; `##` headings also feed the "On this page" list.
- Every link is a relative path, so the pages read on GitHub as well as on the site:
  - Links between pages: `./<slug>.md` (and `#anchor`); the site links `/developers/<slug>`.
  - Demos: their source folder, `../../public/apps/conversation` (`workflow`, `formflow`, `documents`); the site links the demo page, `/examples/conversation`.
- Source links: the file's path relative to the page, such as `../../samples/custom-module` or `../../../MIGRATING-2.0.md`. GitHub resolves it on any branch, and the site build turns it into a link to that path at the release the site is built for. Never link to a tag or `main` by hand. In a code block, `{{releaseTag}}` becomes that release's tag (`git clone -b {{releaseTag}} ...`). Site HTML uses `{{links.source}}` and `{{links.sourceFile}}`. The "Edit this page" link stays on `main`.
- Images: `../../public/images/<file>`; the site serves them at `/images/<file>`.
- Callouts: a blockquote whose first word is bold, `> **Note:**`, `> **Warning:**`, `> **Tip:**`, `> **Important:**`.
- Code fences carry a language (`bash`, `json`, `js`, `ts`, `yaml`, `http`, `dockerfile`, `text`, ...).
- Architecture pictures are SVG files in `demo/public/images` (`uag-*.svg`), shared with the repository README. Keep them on their own white card so they read on light and dark pages.
- Diagrams are fenced blocks drawn as SVG by `demo/lib/diagrams.mjs`: ` ```sequence ` (participants and messages) and ` ```pipeline ` (steps joined by `->`). See that file for the syntax.
