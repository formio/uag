/**
 * The site's pages: HTML fragments in views/pages, wrapped in views/layout.html.
 *
 * Templates use `{{name}}` (escaped) and `{{{name}}}` (raw), with dotted paths
 * into the values passed in (`{{links.portal}}`). Templates are read once at
 * startup, or on every request when DEMO_RELOAD is set, for editing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml } from './docs.mjs';

/** Every marketing page: its route, its view, and what the layout needs. */
export const PAGES = [
    { route: '/', view: 'home', nav: 'product', title: 'Agentic Forms', description: 'Give AI agents governed, deterministic access to your forms, data and workflows with the Universal Agent Gateway, and build it all with the Form.io Agentic Coding Plugin.' },
    { route: '/getting-started', view: 'getting-started', nav: 'start', title: 'Getting Started', description: 'Run the Form.io Universal Agent Gateway in your own environment, against a free hosted project or your own server, or have your coding agent set it up with the Agentic Coding Plugin.' },
    { route: '/examples', view: 'examples', nav: 'examples', title: 'Examples', description: 'Three live demos of Form.io Agentic Forms on the Universal Agent Gateway, each with the prompt that builds it in your own project.' },
    { route: '/examples/conversation', view: 'example-conversation', nav: 'examples', title: 'Conversation Forms', description: 'A chat whose questions come entirely from a Form.io form. Live demo.', app: true },
    { route: '/examples/workflow', view: 'example-workflow', nav: 'examples', title: 'Agentic Workflow', description: 'A college application reviewed by two chained AI agents, with no human in the loop. Live demo.', app: true },
    { route: '/examples/formflow', view: 'example-formflow', nav: 'examples', title: 'Agentic Formflow', description: 'A claims wizard that chooses its own pages and fills itself in from a description. Live demo.', app: true },
    { route: '/faq', view: 'faq', title: 'FAQ', description: 'Common questions about Form.io Agentic Forms: the Universal Agent Gateway, the Agentic Coding Plugin, licensing, and what you can build on Form.io Open Source.' },
    { route: '/contact', view: 'contact', nav: 'contact', title: 'Contact Us', description: 'Talk to the Form.io team about Agentic Forms, self-hosted UAG deployments and enterprise licensing.' },
];

export function lookup(values, key) {
    return key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), values);
}

/** One pass, so a value is never read as a template: a doc may show `{{ data.country }}`. */
export function render(template, values) {
    return template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g, (match, raw, escaped) =>
        (raw ? String(lookup(values, raw) ?? '') : escapeHtml(lookup(values, escaped) ?? '')));
}

export class Views {
    constructor(dir, { reload = false } = {}) {
        this.dir = dir;
        this.reload = reload;
        this.cache = new Map();
    }

    read(name) {
        if (!this.reload && this.cache.has(name)) return this.cache.get(name);
        const template = fs.readFileSync(path.join(this.dir, `${name}.html`), 'utf8');
        this.cache.set(name, template);
        return template;
    }

    /** A view inside the layout. `values.page` describes the page. */
    page(view, values) {
        const content = render(this.read(`pages/${view}`), values);
        return render(this.read('layout'), { ...values, content });
    }
}

/** The values every page sees. */
export function siteValues(config, page, extra = {}) {
    const fullTitle = page.route === '/' ? 'Form.io Agentic Forms: the Universal Agent Gateway and Agentic Coding Plugin' : `${page.title} | Form.io Agentic Forms`;
    const nav = Object.fromEntries(['product', 'start', 'examples', 'developers', 'contact'].map((key) => [key, page.nav === key ? 'aria-current="page"' : '']));
    return {
        site: { url: config.publicUrl, year: new Date().getFullYear() },
        links: config.links,
        formioJsVersion: config.formioJsVersion,
        page: { ...page, fullTitle, canonical: `${config.publicUrl}${page.route}`, bodyClass: `page-${page.view}` },
        nav,
        ...extra,
    };
}
