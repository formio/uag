#!/usr/bin/env node
/**
 * Builds the demo site into static files (demo/dist by default): every page and
 * doc as HTML, the public assets, and the demo apps, with the build-time
 * settings of lib/config.mjs filled in. The output needs no server: any static
 * host that serves `<path>/index.html` for `<path>` and `404.html` for what it
 * does not have, with the headers of scripts/serve.mjs's securityHeaders.
 *
 *   yarn demo:build                       a local build, against http://localhost:3200
 *   NODE_ENV=production DEMO_UAG_URL=https://uag.example.com yarn demo:build
 *
 * A build is written to a temporary folder and moved into place only when every
 * page rendered and no secret from the environment appears in it, so a failed
 * build never leaves a partial site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy, isSecretName, readConfig } from '../lib/config.mjs';
import { escapeHtml } from '../lib/docs.mjs';
import { Docs } from '../lib/docs.mjs';
import { Views, pagesFor, render, siteValues } from '../lib/pages.mjs';
import { GROUPS, formHtml, loadExamples, pageCodeOf, scriptFor } from '../lib/examples.mjs';
import { PROFILES } from '../module/applicants.mjs';

/** Where a route's page is written: `/a/b` → `a/b/index.html`. */
export function fileOf(route) {
    const clean = route.replace(/^\/+|\/+$/g, '');
    return clean ? path.join(clean, 'index.html') : 'index.html';
}

/**
 * The pages and docs of the site, as `{ file, html, unlisted }`: `unlisted` for the
 * showcase, which no other page links to. Throws, naming the source, on any render error.
 */
export function renderSite(config) {
    const views = new Views(path.join(config.root, 'views'));
    const docs = new Docs(path.join(config.root, 'content/developers'), config.links);
    const out = [];
    const attempt = (source, fn) => {
        try {
            return fn();
        }
        catch (error) {
            throw new Error(`${source}: ${error.message}`);
        }
    };

    for (const page of pagesFor(config.showcasePath)) {
        out.push(attempt(`views/pages/${page.view}.html`, () => {
            const values = siteValues(config, page);
            // What a demo frame shows in place of a demo the UAG cannot run (see js/demo.js).
            if (page.app) {
                values.unsupported = { note: 'Conversation forms work everywhere, with no license.', href: `${config.showcasePath}/conversation`, label: 'Conversation Forms' };
                values.demoUnsupported = render(views.read('partials/demo-unsupported'), values);
            }
            // Shown by js/demo.js when a local UAG cannot run Agentic Formflow.
            if (page.unlisted) values.licenseNotice = render(views.read('partials/license-notice'), values);
            return { file: fileOf(page.route), html: views.page(page.view, values), unlisted: !!page.unlisted };
        }));
    }

    out.push(...renderExamples(config, views, attempt));

    for (const doc of docs.ordered) {
        if (doc.slug === 'index' && doc.href !== '/developers') continue;
        out.push(attempt(`content/developers/${doc.slug}.md`, () => {
            const { previous, next } = docs.neighbors(doc.slug);
            const page = { route: doc.href, view: 'developers', nav: 'developers', title: doc.slug === 'index' ? 'Developers' : doc.title, description: doc.description };
            const html = views.page('developers', siteValues(config, page, {
                doc,
                docsNav: docs.nav(doc.slug),
                toc: doc.headings.filter((heading) => heading.depth === 2).map((heading) => `<li><a href="#${heading.id}">${heading.text}</a></li>`).join(''),
                pager: [
                    previous ? `<a class="pager-prev" href="${previous.href}"><small>Previous</small>${previous.title}</a>` : '<span></span>',
                    next ? `<a class="pager-next" href="${next.href}"><small>Next</small>${next.title}</a>` : '<span></span>',
                ].join(''),
                source: `${config.links.github}/blob/main/demo/content/developers/${doc.slug}.md`,
            }));
            return { file: fileOf(doc.href), html };
        }));
    }

    out.push(attempt('views/pages/404.html', () => ({
        file: '404.html',
        html: views.page('404', siteValues(config, { route: '/404', view: '404', nav: '', title: 'Page not found', description: '' })),
    })));
    return out;
}

const codeBlock = (language, html) =>
    `<div class="code"><div class="code-bar"><span>${language}</span><button type="button" class="copy" data-copy>Copy</button></div><pre><code class="language-${language}">${html}</code></pre></div>`;

/** A sample's button label: its first words. */
const sampleLabel = (text) => (text.length > 36 ? `${text.slice(0, 34).replace(/\s+\S*$/, '')}…` : text);

/**
 * The Examples catalog: its index at /examples and one page per feature, from
 * content/examples (see lib/examples.mjs).
 */
export function renderExamples(config, views, attempt = (source, fn) => fn()) {
    const examples = attempt('content/examples', () => loadExamples(path.join(config.root, 'content/examples'), { links: config.links }));
    if (!examples.length) return [];
    const out = [];
    const nav = (current) => GROUPS.map((group) => {
        const items = examples.filter((example) => example.group === group);
        if (!items.length) return '';
        return `<div class="docs-nav-group"><h4>${escapeHtml(group)}</h4><ul>${items.map((example) =>
            `<li><a href="${example.href}"${example.slug === current ? ' aria-current="page"' : ''}>${escapeHtml(example.title)}</a></li>`).join('')}</ul></div>`;
    }).join('');
    const chat = examples.find((example) => example.mode === 'chat');
    const unsupported = { note: 'The chat widget examples work everywhere, with no license.', href: chat ? chat.href : '/examples', label: 'Chat widget' };

    out.push(attempt('views/pages/examples.html', () => {
        const page = { route: '/examples', view: 'examples', nav: 'examples', title: 'Examples', description: 'Live examples of each feature of the Form.io Universal Agent Gateway, each on a small form, with the settings that turn it on and every call it makes.' };
        const exampleGroups = GROUPS.map((group) => {
            const items = examples.filter((example) => example.group === group);
            if (!items.length) return '';
            return `<section class="example-group"><h2>${escapeHtml(group)}</h2><div class="grid grid-3">${items.map((example) =>
                `<a class="card card-link example-link" href="${example.href}"><span class="num">${String(examples.indexOf(example) + 1).padStart(2, '0')}</span><h3>${escapeHtml(example.title)}</h3><p>${escapeHtml(example.summary)}</p><span class="link-arrow">Try it</span></a>`).join('')}</div></section>`;
        }).join('');
        return { file: fileOf(page.route), html: views.page('examples', siteValues(config, page, { exampleGroups })) };
    }));

    examples.forEach((example, index) => {
        out.push(attempt(`content/examples/${example.folder}`, () => {
            const page = { route: example.href, view: 'example', nav: 'examples', title: example.title, description: example.summary };
            const tabs = [
                { id: 'form', label: 'Form JSON', html: codeBlock('json', formHtml(example)) },
                { id: 'page', label: 'Page code', html: codeBlock('html', escapeHtml(scriptFor(example, { uagUrl: config.uag.url, uagProjectUrl: config.uag.projectUrl, projectUrl: config.projectUrl, formioJsVersion: config.formioJsVersion }))) },
            ];
            if (example.action) tabs.push({ id: 'action', label: 'Action', html: codeBlock('json', escapeHtml(JSON.stringify(example.action, null, 2))) });
            const previous = examples[index - 1];
            const next = examples[index + 1];
            const values = siteValues(config, page, {
                example,
                examplesNav: nav(example.slug),
                codeTabs: tabs.map((tab, i) => `<button role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ''}>${tab.label}</button>`).join(''),
                codePanels: tabs.map((tab, i) => `<div class="tab-panel" role="tabpanel" id="panel-${tab.id}" aria-labelledby="tab-${tab.id}"${i ? ' hidden' : ''}>${tab.html}</div>`).join(''),
                samplesHidden: example.samples.length ? '' : ' hidden',
                sampleButtons: example.samples.map((sample) => (sample.file
                    ? `<a class="chip" href="${example.href}/${escapeHtml(sample.file)}" data-sample-file>${escapeHtml(sample.label)}</a>`
                    : `<button type="button" class="chip" data-sample="${escapeHtml(sample.text)}" title="${escapeHtml(sample.text)}">${escapeHtml(sampleLabel(sample.text))}</button>`)).join(''),
                frameSrc: `/apps/example/?form=${encodeURIComponent(example.form.path)}&mode=${example.mode}${example.page ? '&page=1' : ''}`,
                unsupported,
                pager: [
                    previous ? `<a class="pager-prev" href="${previous.href}"><small>Previous</small>${escapeHtml(previous.title)}</a>` : '<span></span>',
                    next ? `<a class="pager-next" href="${next.href}"><small>Next</small>${escapeHtml(next.title)}</a>` : '<span></span>',
                ].join(''),
            });
            values.demoUnsupported = render(views.read('partials/demo-unsupported'), values);
            return { file: fileOf(page.route), html: views.page('example', values) };
        }));
        // The example's PDFs and images, beside its page.
        for (const asset of example.assets) {
            out.push({ file: `examples/${example.slug}/${asset}`, copy: path.join(config.root, 'content/examples', example.folder, asset) });
        }
        // The example's page code, as the live example runs it.
        if (example.page) {
            out.push({ file: `apps/example/pages/${example.slug}.js`, text: `// ${example.title}: the page code shown on its example page.\nwindow.UAGExamplePage = function (form) {\n${pageCodeOf(example, config.uag.projectUrl).split('\n').map((line) => (line ? `  ${line}` : '')).join('\n')}\n};\n` });
        }
    });
    return out;
}

/**
 * The policy a page carries in a `<meta>` tag, for hosts that cannot send headers
 * (GitHub Pages): the site's Content-Security-Policy without `frame-ancestors`,
 * which browsers ignore there.
 */
export function metaPolicy(config) {
    return contentSecurityPolicy({ uagOrigin: new URL(config.uag.url).origin, projectOrigin: new URL(config.projectUrl).origin })
        .split('; ').filter((directive) => !directive.startsWith('frame-ancestors ')).join('; ');
}

/** What an unlisted page (the showcase and the demo apps) tells search engines. */
export const NOINDEX = '<meta name="robots" content="noindex, nofollow, noarchive">';

/**
 * Every HTML file the build writes, finished for where it is served: links and
 * sources from the root (`/developers`, `/js/site.js`) start with the base path,
 * the `<html>` element names it for scripts (`data-base-path`), and the head
 * carries the Content-Security-Policy and referrer policy as `<meta>` tags. An
 * `unlisted` page (a showcase page or a demo app) also asks not to be indexed.
 */
export function finishHtml(html, config, { unlisted = false } = {}) {
    const base = config.basePath || '';
    if (base) html = html.replace(/(\s(?:href|src|action|poster|xlink:href|data-src|data-watch)=)(["'])\/(?!\/)/g, `$1$2${base}/`);
    html = html.replace(/<html(?=[\s>])/, `<html data-base-path="${escapeHtml(base)}"`);
    const robots = unlisted ? `\n  ${NOINDEX}` : '';
    return html.replace(/(<head>\s*<meta charset="utf-8">)/i, `$1\n  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(metaPolicy(config))}">\n  <meta name="referrer" content="strict-origin-when-cross-origin">${robots}`);
}

/** The values a demo app's HTML is rendered with: where its UAG and project are. */
export function appValues(config) {
    return {
        uag: config.uag,
        projectUrl: config.projectUrl,
        formioBaseUrl: config.formioBaseUrl,
        production: config.production ? 'true' : 'false',
        formioJsVersion: config.formioJsVersion,
        assetVersion: config.assetVersion,
    };
}

function copyDir(from, to, transform) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) copyDir(source, target, transform);
        else if (transform && entry.name.endsWith('.html')) fs.writeFileSync(target, transform(fs.readFileSync(source, 'utf8'), source));
        else fs.copyFileSync(source, target);
    }
}

function* textFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* textFiles(file);
        else if (/\.(html|js|mjs|css|json|svg|txt|md|xml)$/.test(entry.name)) yield file;
    }
}

/** The site's own sources, whose text the build may publish as it is. */
const SOURCE_DIRS = ['content', 'views', 'public', 'lib', 'module'];

/**
 * Secrets from the environment that appear in the build, as `NAME in file`. A
 * value the site's sources under `root` already contain (a word in the docs, say)
 * is not one: it is not the environment that puts it there.
 */
export function leakedSecrets(dir, env = process.env, root = null) {
    let secrets = Object.entries(env).filter(([name, value]) => isSecretName(name) && typeof value === 'string' && value.length >= 8);
    if (root && secrets.length) {
        const sources = SOURCE_DIRS.map((name) => path.join(root, name)).filter((source) => fs.existsSync(source))
            .flatMap((source) => [...textFiles(source)].map((file) => fs.readFileSync(file, 'utf8')));
        secrets = secrets.filter(([, value]) => !sources.some((text) => text.includes(value)));
    }
    const found = [];
    for (const file of textFiles(dir)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [name, value] of secrets) {
            // From the site's root, with its leading slash: under the showcase path, the
            // file then contains that path whole, which CI logs mask as a secret.
            if (text.includes(value)) found.push(`${name} in /${path.relative(dir, file).split(path.sep).join('/')}`);
        }
    }
    return found;
}

/** Build the site into config.out. Returns the number of HTML pages written. */
export function build(config = readConfig(), env = process.env) {
    const pages = renderSite(config);
    const temp = `${config.out}.tmp-${process.pid}`;
    fs.rmSync(temp, { recursive: true, force: true });
    try {
        // The assets as they are, and the demo apps' pages with their UAG and project filled in.
        const values = appValues(config);
        copyDir(path.join(config.root, 'public'), temp, (html, source) => {
            const app = source.includes(`${path.sep}apps${path.sep}`);
            return finishHtml(app ? render(html, values) : html, config, { unlisted: app });
        });
        for (const { file, html, text, copy, unlisted } of pages) {
            fs.mkdirSync(path.join(temp, path.dirname(file)), { recursive: true });
            if (copy) fs.copyFileSync(copy, path.join(temp, file));
            else fs.writeFileSync(path.join(temp, file), text !== undefined ? text : finishHtml(html, config, { unlisted }));
        }
        // The workflow demo's sample applicants.
        fs.writeFileSync(path.join(temp, 'apps/workflow/applicants.json'), JSON.stringify(PROFILES, null, 2));

        const leaks = leakedSecrets(temp, env, config.root);
        if (leaks.length) {
            const shown = leaks.slice(0, 5).join(', ') + (leaks.length > 5 ? `, and ${leaks.length - 5} more` : '');
            throw new Error(`The build contains secrets from the environment: ${shown}.`);
        }

        fs.rmSync(config.out, { recursive: true, force: true });
        fs.renameSync(temp, config.out);
    }
    catch (error) {
        fs.rmSync(temp, { recursive: true, force: true });
        throw error;
    }
    return pages.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    // Run on its own, a local build reads demo/.env.local, if there is one.
    const local = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.env.local');
    if (process.env.NODE_ENV !== 'production' && fs.existsSync(local)) process.loadEnvFile(local);
    try {
        const config = readConfig();
        const count = build(config);
        console.log(`[demo:build] ${count} pages in ${path.relative(process.cwd(), config.out) || '.'}, for the UAG at ${config.uag.url}${config.production ? ' (production)' : ''}.`);
    }
    catch (error) {
        console.error(`[demo:build] ${error.message}`);
        process.exit(1);
    }
}
