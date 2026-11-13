import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Docs, SECTIONS, parseFrontMatter, siteLink, slugify, sourceLink } from '../lib/docs.mjs';
import { PAGES } from '../lib/pages.mjs';

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
    const file = path.join(root, 'public', pathname);
    return fs.existsSync(file) && (fs.statSync(file).isFile() || fs.existsSync(path.join(file, 'index.html')));
}

describe('Demo site content', function () {
    it('makes heading ids as GitHub does, without the entities a heading renders with', function () {
        expect(slugify('The UAG&#39;s database')).to.equal('the-uags-database');
        expect(slugify('Fish &amp; chips &#x27;here&#x27;')).to.equal('fish--chips-here');
        expect(slugify('<code>read_document</code>')).to.equal('read_document');
        expect(slugify('Before the save (blocking) — 1.x')).to.equal('before-the-save-blocking--1x');
    });

    it('links pages, demos and public files by relative paths that read on GitHub too', function () {
        const context = { dir: path.join(root, 'content/developers') };
        expect(siteLink('./chat.md', context)).to.equal('/developers/chat');
        expect(siteLink('chat.md#the-widget', context)).to.equal('/developers/chat#the-widget');
        expect(siteLink('./index.md#three-ways-to-use-it', context)).to.equal('/developers#three-ways-to-use-it');
        expect(siteLink('../../public/apps/workflow', context)).to.equal('/examples/workflow');
        expect(siteLink('../../public/apps/workflow/workflow.js', context)).to.equal('/apps/workflow/workflow.js');
        expect(siteLink('../../public/images/login.png', context)).to.equal('/images/login.png');
        for (const href of ['./README.md', '../../samples/custom-module', '../../../MIGRATING-2.0.md', '/developers/chat', '#anchor', 'https://form.io']) {
            expect(siteLink(href, context), href).to.equal(null);
        }
        const page = docs.get('chat');
        expect(page.html).to.include('src="/images/uag-chat.svg"');
        for (const each of docs.ordered) expect(each.html, each.slug).not.to.match(/href="(?!https?:)[^"]*\.md[#"]/);
        expect(page.sources).not.to.satisfy((sources) => sources.some((source) => source.startsWith('demo/public/') || source.startsWith('demo/content/')));
    });

    it('writes no site paths in developer pages, which would not resolve on GitHub', function () {
        const absolute = [];
        for (const name of fs.readdirSync(path.join(root, 'content/developers')).filter((file) => file.endsWith('.md'))) {
            const body = fs.readFileSync(path.join(root, 'content/developers', name), 'utf8').replace(/^(```|~~~)[\s\S]*?^\1/gm, '');
            for (const match of body.matchAll(/\]\((\/[^)\s]*)\)|<(?:img|a)\s[^>]*(?:src|href)="(\/[^"]*)"/g)) absolute.push(`${name}: ${match[1] || match[2]}`);
        }
        expect(absolute).to.deep.equal([]);
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

    it('links a relative path to the repository file at the release the site is built for', function () {
        const context = { dir: path.join(root, 'content/developers'), repoRoot: path.resolve(root, '..'), source: 'https://example.test/tree/v9', sourceFile: 'https://example.test/blob/v9' };
        expect(sourceLink('../../samples/custom-module', context).href).to.equal('https://example.test/tree/v9/demo/samples/custom-module');
        expect(sourceLink('../../../engines/claude/README.md#upgrading-from-1x', context).href).to.equal('https://example.test/blob/v9/engines/claude/README.md#upgrading-from-1x');
        for (const href of ['/developers/chat', '#anchor', 'https://form.io', 'mailto:a@example.test', '../../../../outside']) {
            expect(sourceLink(href, context), href).to.equal(null);
        }
        const built = new Docs(path.join(root, 'content/developers'), { ...context, releaseTag: 'v9' });
        const page = built.get('connect-claude');
        expect(page.html).to.include('href="https://example.test/tree/v9/demo/samples/custom-module"');
        expect(page.html).to.include('git clone -b v9 ');
        expect(page.html).not.to.include('{{releaseTag}}');
    });

    it('links to repository files by relative paths that exist, never to a tag or a branch', function () {
        const repoRoot = path.resolve(root, '..');
        const missing = docs.ordered.flatMap((page) => page.sources.filter((repoPath) => !fs.existsSync(path.join(repoRoot, repoPath))).map((repoPath) => `${page.href}: ${repoPath}`));
        expect(missing).to.deep.equal([]);
        expect(docs.ordered.some((page) => page.sources.length)).to.equal(true);
        const pinned = fs.readdirSync(path.join(root, 'content/developers')).filter((name) => name.endsWith('.md') && name !== 'README.md')
            .filter((name) => /github\.com\/formio\/uag\/(?:tree|blob)\//.test(fs.readFileSync(path.join(root, 'content/developers', name), 'utf8')));
        expect(pinned).to.deep.equal([]);
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
