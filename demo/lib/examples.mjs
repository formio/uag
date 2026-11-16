/**
 * The feature examples: one folder per example under content/examples, named
 * `<nn>-<slug>`, where `nn` is its place in the catalog. Each folder holds:
 *
 * - `example.md`: front matter (`title`, `summary`, `group`, `mode`, `docs`, and
 *   `highlight`, the properties to mark in the form shown), then what the
 *   feature does. A `## Try these` list, when there is one, is the example's
 *   sample text, offered as buttons beside the live form.
 * - `form.json`: the form, as the demo project's template holds it (see
 *   scripts/sync-examples.mjs), and as the live example loads it.
 * - `action.json` (optional): an action the form needs, such as Agent: Run task.
 * - `page.js` (optional): page code the example needs beyond rendering the form,
 *   run with the rendered form as `form`. `UAG_PROJECT_URL` in it stands for the
 *   project's URL on the UAG. It is shown in the example's page code, and the
 *   live example runs the same text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SOURCE, escapeHtml, parseFrontMatter, renderMarkdown, siteLink } from './docs.mjs';

/** The catalog's groups, in order. */
export const GROUPS = ['Fill in forms', 'Workflows', 'Chat widget'];

/** How the live example renders its form: with Agent Input, then a task after the save, or as a chat. */
export const MODES = ['form', 'workflow', 'chat'];

const REQUIRED = ['title', 'summary', 'group', 'mode', 'docs'];

/** The parts of a form a reader writes; the template adds access and ids. */
const FORM_KEYS = ['title', 'name', 'path', 'type', 'display', 'tags', 'properties', 'components'];

/** `example-<slug>` for the form's path; `example<Slug>` (camel case) for its key in the template. */
export function formPathOf(slug) {
    return `example-${slug}`;
}
export function formKeyOf(slug) {
    return `example${slug.replace(/(^|-)([a-z0-9])/g, (match, dash, char) => char.toUpperCase())}`;
}

/** Lines of `## Try these` (a list), taken out of the body. */
function takeSamples(body) {
    const match = /^## Try these\s*\n((?:[ \t]*[-*] .*(?:\n|$))+)/m.exec(body);
    if (!match) return { body, samples: [] };
    const samples = match[1].split('\n').map((line) => line.replace(/^[ \t]*[-*] /, '').trim()).filter(Boolean);
    return { body: body.slice(0, match.index) + body.slice(match.index + match[0].length), samples };
}

/** One example's folder, read and checked. Throws, naming the folder, on anything missing or unknown. */
export function readExample(folder, { contentRoot, links } = {}) {
    const name = path.basename(folder);
    const fail = (message) => { throw new Error(`content/examples/${name}: ${message}`); };
    const parsed = /^(\d+)-([a-z0-9-]+)$/.exec(name);
    if (!parsed) fail('a folder must be named <number>-<slug>');
    const [, order, slug] = parsed;
    const source = path.join(folder, 'example.md');
    if (!fs.existsSync(source)) fail('example.md is missing');
    const { meta, body: raw } = parseFrontMatter(fs.readFileSync(source, 'utf8'));
    for (const key of REQUIRED) if (!meta[key]) fail(`front matter needs ${key}`);
    if (!GROUPS.includes(meta.group)) fail(`group must be one of ${GROUPS.join(', ')}`);
    if (!MODES.includes(meta.mode)) fail(`mode must be one of ${MODES.join(', ')}`);
    const root = contentRoot || path.resolve(folder, '..', '..');
    const context = {
        dir: folder,
        contentRoot: root,
        repoRoot: path.resolve(root, '..', '..'),
        source: links?.source || DEFAULT_SOURCE.source,
        sourceFile: links?.sourceFile || DEFAULT_SOURCE.sourceFile,
        releaseTag: links?.releaseTag || DEFAULT_SOURCE.releaseTag,
    };
    const docs = siteLink(meta.docs, context);
    if (!docs || !docs.startsWith('/developers')) fail('docs must link a developer page');

    const formFile = path.join(folder, 'form.json');
    if (!fs.existsSync(formFile)) fail('form.json is missing');
    let form;
    try { form = JSON.parse(fs.readFileSync(formFile, 'utf8')); }
    catch (error) { fail(`form.json: ${error.message}`); }
    if (form.path !== formPathOf(slug)) fail(`form.json's path must be ${formPathOf(slug)}`);
    if (!Array.isArray(form.tags) || !form.tags.includes('uag')) fail('form.json must be tagged uag');
    if (!Array.isArray(form.components)) fail('form.json needs components');
    const extra = Object.keys(form).filter((key) => !FORM_KEYS.includes(key));
    if (extra.length) fail(`form.json holds what the template adds: ${extra.join(', ')}`);

    const pageFile = path.join(folder, 'page.js');
    const page = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, 'utf8').trim() : null;
    if (page && meta.mode === 'chat') fail('page.js is for form and workflow examples');

    const actionFile = path.join(folder, 'action.json');
    const action = fs.existsSync(actionFile) ? JSON.parse(fs.readFileSync(actionFile, 'utf8')) : null;
    if (meta.mode === 'workflow' && !action) fail('a workflow example needs action.json');

    const { body, samples } = takeSamples(raw);
    const highlight = String(meta.highlight || '').split(',').map((item) => item.trim()).filter(Boolean);
    const json = JSON.stringify(form, null, 2);
    for (const property of highlight) if (!json.includes(`"${property}"`)) fail(`highlight names ${property}, which form.json does not use`);
    return {
        slug,
        order: Number(order),
        folder: name,
        href: `/examples/${slug}`,
        title: meta.title,
        summary: meta.summary,
        group: meta.group,
        mode: meta.mode,
        docs,
        highlight,
        samples,
        html: renderMarkdown(body, context).html,
        form,
        action,
        page,
    };
}

/** Every example under `dir`, in catalog order. */
export function loadExamples(dir, options = {}) {
    if (!fs.existsSync(dir)) return [];
    const examples = fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => readExample(path.join(dir, entry.name), options))
        .sort((a, b) => a.order - b.order);
    const slugs = new Set();
    for (const example of examples) {
        if (slugs.has(example.slug)) throw new Error(`content/examples: two examples are named ${example.slug}`);
        slugs.add(example.slug);
    }
    // Groups keep the catalog order: a group's examples are consecutive.
    const seen = [];
    for (const example of examples) {
        if (seen.at(-1) !== example.group) {
            if (seen.includes(example.group)) throw new Error(`content/examples/${example.folder}: its group, ${example.group}, is split by another`);
            seen.push(example.group);
        }
    }
    if (seen.some((group, index) => index && GROUPS.indexOf(group) < GROUPS.indexOf(seen[index - 1]))) {
        throw new Error(`content/examples: groups must come in the order ${GROUPS.join(', ')}`);
    }
    return examples;
}

/** The form as a reader writes it, pretty-printed, with each line holding a highlighted property marked. */
export function formHtml(example) {
    const marks = example.highlight.map((property) => `"${property}":`);
    return JSON.stringify(example.form, null, 2).split('\n').map((line) => {
        const html = escapeHtml(line);
        return marks.some((mark) => line.includes(mark)) ? `<mark>${html}</mark>` : html;
    }).join('\n');
}

/** An example's page.js with the project's URL on the UAG filled in. */
export function pageCodeOf(example, uagProjectUrl) {
    return example.page ? example.page.replaceAll('UAG_PROJECT_URL', uagProjectUrl) : '';
}

/** The page code that renders the example, with the site's UAG and project. */
export function scriptFor(example, { uagUrl, uagProjectUrl, projectUrl, formioJsVersion }) {
    const create = example.mode === 'chat' ? 'Formio.createChat' : 'Formio.createForm';
    const target = `document.getElementById('${example.mode === 'chat' ? 'chat' : 'form'}'), '${projectUrl}/${example.form.path}'`;
    const render = example.page
        ? [`  ${create}(${target}).then((form) => {`, ...pageCodeOf(example, uagProjectUrl).split('\n').map((line) => (line ? `    ${line}` : '')), '  });']
        : [`  ${create}(${target});`];
    return [
        `<link rel="stylesheet" href="${uagUrl}/uag-js/uag-js.css">`,
        `<script src="https://cdn.jsdelivr.net/npm/@formio/js@${formioJsVersion}/dist/formio.full.min.js"></script>`,
        '<!-- Registers @formio/uag-js with this UAG: forms tagged uag save through it, and get Agent Input and the chat. -->',
        `<script src="${uagUrl}/uag-js/uag.use.js"></script>`,
        '',
        `<div id="${example.mode === 'chat' ? 'chat' : 'form'}"></div>`,
        '<script>',
        ...render,
        '</script>',
    ].join('\n');
}
