import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Docs, SECTIONS, parseFrontMatter, slugify } from '../server/docs.mjs';
import { PAGES } from '../server/pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = new Docs(path.join(root, 'content/developers'));
const views = fs.readdirSync(path.join(root, 'views/pages')).map((file) => [file, fs.readFileSync(path.join(root, 'views/pages', file), 'utf8')]);

/** Every route the site serves a page at. */
const routes = new Set([...PAGES.map((page) => page.route), ...docs.ordered.map((page) => page.href)]);

function links(html) {
    return [...html.matchAll(/(?:href|src)="(\/[^"#?]*)(#[^"]*)?"/g)].map((match) => ({ path: match[1], hash: match[2] || '' }));
}

/** Whether a site path is a page, or a file in public/. */
function exists(pathname) {
    if (routes.has(pathname.replace(/\/$/, '') || '/')) return true;
    if (pathname.startsWith('/renderer/')) return fs.existsSync(path.join(root, '..', 'packages', 'uag-js', pathname.slice('/renderer/'.length)));
    const file = path.join(root, 'public', pathname);
    return fs.existsSync(file) && (fs.statSync(file).isFile() || fs.existsSync(path.join(file, 'index.html')));
}

describe('Demo site content', function () {
    it('makes heading ids without the entities a heading renders with', function () {
        expect(slugify('The UAG&#39;s database')).to.equal('the-uags-database');
        expect(slugify('Fish &amp; chips &#x27;here&#x27;')).to.equal('fish-chips-here');
    });

    it('gives every developer page a title, a description and a known section', function () {
        expect(docs.ordered.length).to.be.greaterThan(10);
        for (const file of fs.readdirSync(path.join(root, 'content/developers')).filter((name) => name.endsWith('.md') && name !== 'README.md')) {
            const { meta } = parseFrontMatter(fs.readFileSync(path.join(root, 'content/developers', file), 'utf8'));
            expect(meta.title, file).to.be.a('string').and.not.equal('');
            expect(meta.description, file).to.be.a('string').and.not.equal('');
            expect(SECTIONS, file).to.include(meta.section);
        }
        expect(docs.get('index')).to.exist;
    });

    it('links only to pages, anchors and files that exist', function () {
        const broken = [];
        const sources = [
            ...docs.ordered.map((page) => [page.href, page.html]),
            ...views,
            ['layout', fs.readFileSync(path.join(root, 'views/layout.html'), 'utf8')],
        ];
        for (const [source, html] of sources) {
            for (const link of links(html)) {
                if (/\{\{/.test(link.path)) continue;
                if (!exists(link.path)) broken.push(`${source}: ${link.path}`);
                const target = docs.ordered.find((page) => page.href === link.path.replace(/\/$/, ''));
                const id = link.hash.slice(1);
                if (target && id && !new RegExp(`id="${id}"`).test(target.html)) broken.push(`${source}: ${link.path}${link.hash}`);
            }
        }
        expect(broken).to.deep.equal([]);
    });

    it('serves a view for every page', function () {
        for (const page of PAGES) expect(fs.existsSync(path.join(root, 'views/pages', `${page.view}.html`)), page.view).to.equal(true);
    });
});
