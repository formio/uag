/**
 * The Developers section: Markdown pages in content/developers, rendered with
 * marked into the site layout, with a sidebar built from their front matter
 * and an "On this page" list built from their headings.
 *
 * Pages are written to read on GitHub as well as on the site, so every link is a
 * relative path that GitHub resolves on any branch. The site turns a link to
 * another page (`./chat.md#anchor`) into its route (`/developers/chat#anchor`),
 * a link to a demo's source folder (`../../public/apps/workflow`) into the demo
 * page (`/examples/workflow`), and a link or image under `demo/public`
 * (`../../public/images/login.png`) into its site path (`/images/login.png`).
 * A link to any other file of the repository (`../../samples/custom-module`)
 * points to that path at the release the site is built for (`source` for a
 * folder, `sourceFile` for a file). Heading ids follow GitHub's, so an anchor
 * works in both places. `{{releaseTag}}` in a code block becomes that release's
 * tag (`git clone -b {{releaseTag}} ...`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Marked, Renderer } from 'marked';
import { pipeline, sequence } from './diagrams.mjs';

export const SECTIONS = ['Start here', 'Concepts', 'Build', 'Extend', 'Operate'];

/** A heading's id, as GitHub makes it from the heading's rendered text. */
export function slugify(text) {
    return String(text)
        .replace(/<[^>]+>/g, '')
        // Entities, named or numeric (an apostrophe renders as &#39;), are punctuation, which an id leaves out.
        .replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
        .replace(/ /g, '-');
}

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/**
 * A front matter value: a YAML scalar on one line. A value with `: ` or ` #` in it
 * must be quoted for GitHub, which reads front matter as YAML: `"..."` (with `\"`
 * for a double quote) or `'...'` (with `''` for an apostrophe).
 */
function scalar(value) {
    if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
        try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    }
    if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
    return value;
}

/** `---` front matter of `key: value` lines, and the body after it. */
export function parseFrontMatter(source) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
    if (!match) return { meta: {}, body: source };
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index > 0) meta[line.slice(0, index).trim()] = scalar(line.slice(index + 1).trim());
    }
    return { meta, body: source.slice(match[0].length) };
}

const CALLOUT = /^<p><strong>(Note|Warning|Tip|Important):?<\/strong>:?\s*/i;

const DEFAULT_SOURCE = {
    source: 'https://github.com/formio/uag/tree/main',
    sourceFile: 'https://github.com/formio/uag/blob/main',
    releaseTag: 'main',
};

/**
 * The site path of a page's relative link to another page, a demo's source
 * folder, or a file under `demo/public` (`null` for any other link).
 */
export function siteLink(href, { dir }) {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return null;
    const [, pathname, rest] = /^([^?#]*)(.*)$/.exec(href);
    const target = path.resolve(dir, pathname);
    const page = path.relative(dir, target).split(path.sep).join('/');
    if (/^[a-z0-9-]+\.md$/.test(page) && page !== 'README.md') {
        const slug = page.replace(/\.md$/, '');
        return `${slug === 'index' ? '/developers' : `/developers/${slug}`}${rest}`;
    }
    const pub = path.relative(path.resolve(dir, '..', '..', 'public'), target).split(path.sep).join('/');
    if (!pub || pub.startsWith('..') || path.isAbsolute(pub)) return null;
    const demo = /^apps\/([a-z0-9-]+)\/?$/.exec(pub);
    return demo ? `/examples/${demo[1]}${rest}` : `/${pub}${rest}`;
}

/**
 * Where a page's relative link to a repository file points on the site, and the
 * repository path it names (`null` for a link that is not to a repository file).
 */
export function sourceLink(href, { dir, repoRoot, source, sourceFile }) {
    if (siteLink(href, { dir })) return null;
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return null;
    const [, pathname, rest] = /^([^?#]*)(.*)$/.exec(href);
    const repoPath = path.relative(repoRoot, path.resolve(dir, pathname)).split(path.sep).join('/');
    if (!repoPath || repoPath.startsWith('..')) return null;
    const full = path.join(repoRoot, repoPath);
    const folder = fs.existsSync(full) && fs.statSync(full).isDirectory();
    return { href: `${folder ? source : sourceFile}/${repoPath}${rest}`, repoPath };
}

function renderPage(body, context) {
    const sources = [];
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
                token = { ...token, href: siteLink(token.href, context) || token.href };
                return `<a class="image-link" href="${escapeHtml(token.href)}" target="_blank" rel="noopener">${Renderer.prototype.image.call(this, token)}</a>`;
            },
            link(token) {
                const site = siteLink(token.href, context);
                if (site) return Renderer.prototype.link.call(this, { ...token, href: site });
                const linked = sourceLink(token.href, context);
                if (!linked) return Renderer.prototype.link.call(this, token);
                sources.push(linked.repoPath);
                return Renderer.prototype.link.call(this, { ...token, href: linked.href });
            },
            table(token) {
                return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>`;
            },
            code({ text: raw, lang }) {
                const text = raw.replaceAll('{{releaseTag}}', context.releaseTag);
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
    return { html, headings, sources };
}

export class Docs {
    /**
     * `source`, `sourceFile` and `releaseTag` (the site's `links`) say where links
     * to repository files point; `repoRoot` is the repository (three folders up
     * from content/developers).
     */
    constructor(dir, { source, sourceFile, releaseTag, repoRoot } = {}) {
        this.dir = dir;
        this.context = {
            dir,
            repoRoot: repoRoot || path.resolve(dir, '..', '..', '..'),
            source: source || DEFAULT_SOURCE.source,
            sourceFile: sourceFile || DEFAULT_SOURCE.sourceFile,
            releaseTag: releaseTag || DEFAULT_SOURCE.releaseTag,
        };
        this.load();
    }

    load() {
        const pages = new Map();
        if (fs.existsSync(this.dir)) {
            for (const file of fs.readdirSync(this.dir)) {
                if (!file.endsWith('.md') || file === 'README.md') continue;
                const slug = file.replace(/\.md$/, '');
                const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(this.dir, file), 'utf8'));
                const { html, headings, sources } = renderPage(body, this.context);
                pages.set(slug, {
                    slug,
                    href: slug === 'index' ? '/developers' : `/developers/${slug}`,
                    title: meta.title || slug,
                    description: meta.description || '',
                    section: SECTIONS.includes(meta.section) ? meta.section : 'Build',
                    order: Number(meta.order) || 100,
                    html,
                    headings,
                    sources,
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
