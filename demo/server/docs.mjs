/**
 * The Developers section: Markdown pages in content/developers, rendered with
 * marked into the site layout, with a sidebar built from their front matter
 * and an "On this page" list built from their headings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Marked, Renderer } from 'marked';
import { pipeline, sequence } from './diagrams.mjs';

export const SECTIONS = ['Start here', 'Concepts', 'Build', 'Extend', 'Operate'];

export function slugify(text) {
    return String(text).toLowerCase()
        .replace(/<[^>]+>/g, '')
        // Entities, named or numeric (an apostrophe renders as &#39;), are not part of an id.
        .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/g, '')
        .replace(/[`*_~]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** `---` front matter of `key: value` lines, and the body after it. */
export function parseFrontMatter(source) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
    if (!match) return { meta: {}, body: source };
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index > 0) meta[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    }
    return { meta, body: source.slice(match[0].length) };
}

const CALLOUT = /^<p><strong>(Note|Warning|Tip|Important):?<\/strong>:?\s*/i;

function renderPage(body) {
    const headings = [];
    const used = new Map();
    const marked = new Marked({ gfm: true });
    marked.use({
        renderer: {
            heading({ tokens, depth }) {
                const html = this.parser.parseInline(tokens);
                let id = slugify(html) || `section-${headings.length + 1}`;
                const seen = used.get(id) || 0;
                used.set(id, seen + 1);
                if (seen) id = `${id}-${seen}`;
                if (depth === 2 || depth === 3) headings.push({ depth, id, text: html.replace(/<[^>]+>/g, '') });
                return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
            },
            blockquote({ tokens }) {
                const inner = this.parser.parse(tokens);
                const kind = CALLOUT.exec(inner)?.[1]?.toLowerCase();
                if (!kind) return `<blockquote>${inner}</blockquote>\n`;
                return `<div class="callout callout-${kind}"><span class="callout-label">${kind}</span>${inner.replace(CALLOUT, '<p>')}</div>\n`;
            },
            // A diagram or screenshot opens full size, for reading its labels on a phone.
            image(token) {
                return `<a class="image-link" href="${escapeHtml(token.href)}" target="_blank" rel="noopener">${Renderer.prototype.image.call(this, token)}</a>`;
            },
            table(token) {
                return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>`;
            },
            code({ text, lang }) {
                const language = (lang || '').split(/\s/)[0];
                if (language === 'sequence' || language === 'pipeline') {
                    const svg = (language === 'sequence' ? sequence : pipeline)(text);
                    if (svg) return svg;
                }
                return `<div class="code"><div class="code-bar"><span>${escapeHtml(language || 'text')}</span><button type="button" class="copy" data-copy>Copy</button></div><pre><code class="language-${escapeHtml(language)}">${escapeHtml(text)}</code></pre></div>\n`;
            },
            html({ text }) {
                // Diagram markers become a placeholder the site's diagrams replace, and vanish otherwise.
                return text.replace(/<!--\s*diagram:[\s\S]*?-->/g, '').replace(/<!--\s*TODO:[\s\S]*?-->/g, '');
            },
        },
    });
    const html = marked.parse(body);
    return { html, headings };
}

export class Docs {
    constructor(dir) {
        this.dir = dir;
        this.load();
    }

    load() {
        const pages = new Map();
        if (fs.existsSync(this.dir)) {
            for (const file of fs.readdirSync(this.dir)) {
                if (!file.endsWith('.md') || file === 'README.md') continue;
                const slug = file.replace(/\.md$/, '');
                const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(this.dir, file), 'utf8'));
                const { html, headings } = renderPage(body);
                pages.set(slug, {
                    slug,
                    href: slug === 'index' ? '/developers' : `/developers/${slug}`,
                    title: meta.title || slug,
                    description: meta.description || '',
                    section: SECTIONS.includes(meta.section) ? meta.section : 'Build',
                    order: Number(meta.order) || 100,
                    html,
                    headings,
                });
            }
        }
        this.pages = pages;
        this.ordered = [...pages.values()].sort((a, b) =>
            SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.order - b.order || a.title.localeCompare(b.title));
    }

    get(slug) {
        return this.pages.get(slug || 'index') || null;
    }

    /** The sidebar, with `current` marked. */
    nav(current) {
        return SECTIONS.map((section) => {
            const items = this.ordered.filter((page) => page.section === section);
            if (!items.length) return '';
            return `<div class="docs-nav-group"><h4>${escapeHtml(section)}</h4><ul>${items.map((page) =>
                `<li><a href="${page.href}"${page.slug === current ? ' aria-current="page"' : ''} title="${escapeHtml(page.description)}">${escapeHtml(page.title)}</a></li>`).join('')}</ul></div>`;
        }).join('');
    }

    /** The pages before and after `slug`, in reading order. */
    neighbors(slug) {
        const index = this.ordered.findIndex((page) => page.slug === slug);
        return { previous: this.ordered[index - 1] || null, next: this.ordered[index + 1] || null };
    }
}
