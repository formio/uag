#!/usr/bin/env node
/**
 * Builds the demo site into static files (demo/dist by default): every page and
 * doc as HTML, the public assets, and the demo apps, with the build-time
 * settings of lib/config.mjs filled in. The output needs no server: put it on
 * S3 + CloudFront (deploy/site.yml), or any static host that serves
 * `<path>/index.html` for `<path>` and `404.html` for what it does not have.
 *
 *   yarn demo:build                       a local build, against http://localhost:3200
 *   NODE_ENV=production DEMO_UAG_URL=https://uag.ai.form.io yarn demo:build
 *
 * A build is written to a temporary folder and moved into place only when every
 * page rendered and no secret from the environment appears in it, so a failed
 * build never leaves a partial site.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSecretName, readConfig } from '../lib/config.mjs';
import { Docs } from '../lib/docs.mjs';
import { PAGES, Views, render, siteValues } from '../lib/pages.mjs';
import { PROFILES } from '../module/applicants.mjs';

/** Where a route's page is written: `/a/b` → `a/b/index.html`. */
export function fileOf(route) {
    const clean = route.replace(/^\/+|\/+$/g, '');
    return clean ? path.join(clean, 'index.html') : 'index.html';
}

/** The pages and docs of the site, as `{ file, html }`. Throws, naming the source, on any render error. */
export function renderSite(config) {
    const views = new Views(path.join(config.root, 'views'));
    const docs = new Docs(path.join(config.root, 'content/developers'));
    const out = [];
    const attempt = (source, fn) => {
        try {
            return fn();
        }
        catch (error) {
            throw new Error(`${source}: ${error.message}`);
        }
    };

    for (const page of PAGES) {
        out.push(attempt(`views/pages/${page.view}.html`, () => {
            const values = siteValues(config, page);
            // What a demo frame shows in place of a demo the UAG cannot run (see js/demo.js).
            if (page.app) values.demoUnsupported = views.read('partials/demo-unsupported');
            // Shown by js/demo.js when a local UAG cannot run Agentic Formflow.
            if (page.nav === 'examples') values.licenseNotice = render(views.read('partials/license-notice'), values);
            return { file: fileOf(page.route), html: views.page(page.view, values) };
        }));
    }

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
            if (text.includes(value)) found.push(`${name} in ${path.relative(dir, file)}`);
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
        copyDir(path.join(config.root, 'public'), temp, (html, source) =>
            (source.includes(`${path.sep}apps${path.sep}`) ? render(html, values) : html));
        for (const { file, html } of pages) {
            fs.mkdirSync(path.join(temp, path.dirname(file)), { recursive: true });
            fs.writeFileSync(path.join(temp, file), html);
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
