import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basePathOf, contentSecurityPolicy, showcasePathOf, formioBaseOf, projectNameOf, readConfig } from '../lib/config.mjs';
import { render } from '../lib/pages.mjs';
import { loadExamples } from '../lib/examples.mjs';
import { NOINDEX, build, fileOf, finishHtml, metaPolicy } from '../scripts/build.mjs';
import { createServer, resolve } from '../scripts/serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Demo site build', function () {
    describe('configuration', function () {
        it('points the pages at the UAG, the project and its Form.io server', function () {
            const config = readConfig({ DEMO_UAG_URL: 'https://uag.example.com/', FORMIO_PROJECT_URL: 'https://uag.form.io' });
            expect(config.uag).to.deep.equal({ url: 'https://uag.example.com', projectUrl: 'https://uag.example.com/uag' });
            expect(config.formioBaseUrl).to.equal('https://api.form.io');
            expect(readConfig({ DEMO_UAG_URL: 'http://localhost:3200', FORMIO_PROJECT_URL: 'http://localhost:3001', DEMO_UAG_PROJECT_PATH: '' }).uag.projectUrl).to.equal('http://localhost:3200');
            expect(projectNameOf('http://api-server:3000/demo')).to.equal('demo');
            expect(formioBaseOf('http://localhost:3001/demo')).to.equal('http://localhost:3001');
        });

        it('derives the public URL from DEMO_DOMAIN, unless DEMO_PUBLIC_URL names it, and defaults to GitHub Pages', function () {
            expect(readConfig({}).publicUrl).to.equal('https://formio.github.io/uag');
            expect(readConfig({ DEMO_DOMAIN: 'agents.example.com' }).publicUrl).to.equal('https://agents.example.com');
            expect(readConfig({ DEMO_PUBLIC_URL: 'http://localhost:8080/' }).publicUrl).to.equal('http://localhost:8080');
        });

        it('reads the path the site is served under, with no trailing slash, and refuses anything else', function () {
            expect(readConfig({}).basePath).to.equal('');
            expect(basePathOf({ DEMO_BASE_PATH: '/uag/' })).to.equal('/uag');
            expect(basePathOf({ DEMO_BASE_PATH: '/' })).to.equal('');
            for (const value of ['uag', '/uag"><script>', 'https://formio.github.io/uag']) {
                expect(() => basePathOf({ DEMO_BASE_PATH: value }), value).to.throw(/DEMO_BASE_PATH/);
            }
        });

        it('reads the path the showcase is served under, /showcase unless DEMO_SHOWCASE_PATH names another', function () {
            expect(readConfig({}).showcasePath).to.equal('/showcase');
            expect(showcasePathOf({ DEMO_SHOWCASE_PATH: '/x-7f3c9a/' })).to.equal('/x-7f3c9a');
            expect(showcasePathOf({ DEMO_SHOWCASE_PATH: '/demos/live' })).to.equal('/demos/live');
            for (const value of ['x y', '/x y', 'examples', 'https://example.com/x', '/', '/x"><script>', '/developers', '/apps/x', '/images', '/examples', '/Examples/x', '/x/..', '/..', '/.', '/./x', '/x/../developers', '/Developers', '/FAQ', ' ', '\n']) {
                expect(() => showcasePathOf({ DEMO_SHOWCASE_PATH: value }), value).to.throw(/DEMO_SHOWCASE_PATH/);
            }
        });

        it('never repeats the showcase path in its error, since the published one is a secret', function () {
            expect(() => showcasePathOf({ DEMO_SHOWCASE_PATH: '/x secret' })).to.throw().with.property('message').that.does.not.include('secret');
        });

        it('sends sales calls to action to Form.io\'s contact page and the trial to its sign-up, unless told otherwise', function () {
            expect(readConfig({}).links).to.include({ contact: 'https://form.io/contact-us', trial: 'https://portal.form.io' });
            expect(readConfig({ CONTACT_URL: 'https://form.io/uag-contact', TRIAL_URL: 'https://form.io/uag-trial' }).links).to.include({ contact: 'https://form.io/uag-contact', trial: 'https://form.io/uag-trial' });
        });

        it('refuses a production build that does not name its UAG', function () {
            expect(() => readConfig({ NODE_ENV: 'production' })).to.throw(/DEMO_UAG_URL/);
        });
    });

    describe('finishing the HTML', function () {
        const config = readConfig({ DEMO_UAG_URL: 'https://ai.example.com', FORMIO_PROJECT_URL: 'https://uag.form.io', DEMO_BASE_PATH: '/uag' });
        const page = '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <link rel="stylesheet" href="/css/site.css?v=1">\n</head>\n<body><a href="/developers/chat#x">a</a> <a href="https://form.io/">b</a> <a href="//cdn.example.com/x.js">c</a> <img src="/images/a.png"> <a href="#top">d</a> <a href="chat.js">e</a> <svg><use href="/images/icons.svg#lock"/></svg> <form action="/search"></form> <iframe data-src="/apps/chat/"></iframe> <button data-watch="/images/a.gif"></button></body></html>';

        it('starts every link and source from the root with the base path, and leaves the others alone', function () {
            const html = finishHtml(page, config);
            for (const prefixed of ['href="/uag/css/site.css?v=1"', 'href="/uag/developers/chat#x"', 'src="/uag/images/a.png"', 'href="/uag/images/icons.svg#lock"', 'action="/uag/search"', 'data-src="/uag/apps/chat/"', 'data-watch="/uag/images/a.gif"']) expect(html).to.include(prefixed);
            for (const kept of ['href="https://form.io/"', 'href="//cdn.example.com/x.js"', 'href="#top"', 'href="chat.js"']) expect(html).to.include(kept);
            expect(html).to.include('<html data-base-path="/uag" lang="en">');
            expect(finishHtml(page, { ...config, basePath: '' })).to.include('href="/developers/chat#x"').and.include('data-base-path=""');
        });

        it('carries the Content-Security-Policy and the referrer policy as meta tags, without frame-ancestors', function () {
            const html = finishHtml(page, config);
            expect(metaPolicy(config)).to.equal(contentSecurityPolicy({ uagOrigin: 'https://ai.example.com', projectOrigin: 'https://uag.form.io' }).replace("; frame-ancestors 'self'", ''));
            expect(html).to.include(`<meta http-equiv="Content-Security-Policy" content="${metaPolicy(config).replaceAll("'", '&#39;')}">`);
            expect(html).to.include('<meta name="referrer" content="strict-origin-when-cross-origin">');
            expect(html.indexOf('http-equiv')).to.be.lessThan(html.indexOf('/uag/css/site.css'));
        });
    });

    describe('templates', function () {
        it('escapes {{values}} and leaves {{{values}}} raw', function () {
            expect(render('<p>{{a}}</p>{{{b}}}', { a: '<script>"x"</script>', b: '<i>ok</i>' }))
                .to.equal('<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p><i>ok</i>');
            expect(render('{{links.portal}}', { links: { portal: 'https://portal.form.io' } })).to.equal('https://portal.form.io');
        });

        it('never reads a value as a template, so a doc can show {{placeholders}}', function () {
            const values = { doc: '<code>{{ data.country }}</code> {{{ data.country }}}', data: { country: 'NZ' } };
            expect(render('{{{doc}}}', values)).to.equal(values.doc);
            expect(render('{{doc}}', values)).to.equal('&lt;code&gt;{{ data.country }}&lt;/code&gt; {{{ data.country }}}');
        });
    });

    describe('the build', function () {
        let out;
        let config;
        const env = { DEMO_UAG_URL: 'https://uag.build-test.example', FORMIO_PROJECT_URL: 'https://uag.form.io', NODE_ENV: 'production' };

        before(function () {
            this.timeout(60000);
            out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-build-'));
            config = readConfig({ ...env, DEMO_OUT: path.join(out, 'dist') });
            build(config, env);
        });

        after(function () {
            fs.rmSync(out, { recursive: true, force: true });
        });

        const read = (file) => fs.readFileSync(path.join(config.out, file), 'utf8');

        it('writes every page and doc as <route>/index.html, and a 404 page', function () {
            for (const route of ['/', '/showcase', '/showcase/conversation', '/showcase/workflow', '/showcase/formflow', '/showcase/documents', '/developers', '/developers/agent-api', '/getting-started']) {
                expect(fs.existsSync(path.join(config.out, fileOf(route))), route).to.equal(true);
            }
            expect(read('404.html')).to.include('</html>');
        });

        it('gives every page and demo app the UAG and the project, and leaves no template unfilled', function () {
            expect(read('showcase/conversation/index.html')).to.include('data-uag-url="https://uag.build-test.example"').and.include('data-project-url="https://uag.form.io"');
            for (const app of ['conversation', 'formflow', 'documents', 'workflow']) {
                const html = read(`apps/${app}/index.html`);
                expect(html, app).to.include('<script src="https://uag.build-test.example/uag-js/uag.use.js"');
                expect(html, app).to.include('data-production="true"');
                expect(html, app).to.not.match(/\{\{/);
            }
        });

        it('calls nothing on a server of its own: no /api route in the site\'s pages, apps or scripts', function () {
            const offenders = [];
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const file = path.join(dir, entry.name);
                    // The developer docs may show a server of the reader's own.
                    if (entry.isDirectory()) {
                        if (path.relative(config.out, file) !== 'developers') walk(file);
                    }
                    else if (/\.(html|js)$/.test(entry.name) && /["'`]\/api\//.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(config.out, file));
                }
            };
            walk(config.out);
            expect(offenders).to.deep.equal([]);
        });

        it('writes the workflow\'s sample applicants', function () {
            expect(Object.keys(JSON.parse(read('apps/workflow/applicants.json')))).to.have.members(['weak', 'average', 'strong']);
        });

        it('fails, and leaves the last build in place, when a secret from the environment would be published', function () {
            const before = read('index.html');
            // A "secret" whose value appears in every page, from the environment: the UAG's host name.
            expect(() => build(config, { ...env, SOME_API_KEY: 'uag.build-test.example' })).to.throw(/SOME_API_KEY/);
            expect(read('index.html')).to.equal(before);
            expect(fs.readdirSync(out).filter((name) => name.includes('.tmp-'))).to.deep.equal([]);
        });

        it('does not take text the site\'s own sources contain for a secret', function () {
            // The name the docs give the UAG, as a password might also be.
            expect(() => build(config, { ...env, SOME_PASSWORD: 'Universal Agent Gateway' })).to.not.throw();
        });
    });

    describe('a build for GitHub Pages', function () {
        let out;
        let config;
        const env = { DEMO_UAG_URL: 'https://ai.example.com', FORMIO_PROJECT_URL: 'https://uag.form.io', NODE_ENV: 'production', DEMO_BASE_PATH: '/uag', DEMO_PUBLIC_URL: 'https://formio.github.io/uag' };

        before(function () {
            this.timeout(60000);
            out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-pages-'));
            config = readConfig({ ...env, DEMO_OUT: path.join(out, 'dist') });
            build(config, env);
        });

        after(function () {
            fs.rmSync(out, { recursive: true, force: true });
        });

        it('starts every link and source from the root with /uag, in every page, doc and demo app', function () {
            const offenders = [];
            let pages = 0;
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const file = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(file);
                    else if (entry.name.endsWith('.html')) {
                        pages++;
                        const html = fs.readFileSync(file, 'utf8');
                        // Any data-* attribute too: a script may use its value as a URL.
                        for (const match of html.matchAll(/\s(href|src|action|poster|xlink:href|data-[a-z-]+)=["'](\/(?!\/)[^"']*)/g)) {
                            if (match[1] !== 'data-base-path' && !match[2].startsWith('/uag/')) offenders.push(`${path.relative(config.out, file)}: ${match[1]}=${match[2]}`);
                        }
                        if (!html.includes('data-base-path="/uag"')) offenders.push(`${path.relative(config.out, file)}: no data-base-path`);
                        if (!html.includes('http-equiv="Content-Security-Policy"')) offenders.push(`${path.relative(config.out, file)}: no policy`);
                    }
                }
            };
            walk(config.out);
            expect(pages).to.be.greaterThan(30);
            expect(offenders).to.deep.equal([]);
        });

        it('names the canonical URL on GitHub Pages', function () {
            expect(fs.readFileSync(path.join(config.out, 'developers/chat/index.html'), 'utf8')).to.include('https://formio.github.io/uag/developers/chat');
        });

        it('is served under /uag, as GitHub Pages serves a project site', async function () {
            const server = createServer(config.out, {}, '/uag');
            await new Promise((done) => server.listen(0, '127.0.0.1', done));
            try {
                const base = `http://127.0.0.1:${server.address().port}`;
                const bare = await fetch(`${base}/uag`, { redirect: 'manual' });
                expect(bare.status).to.equal(301);
                expect(bare.headers.get('location')).to.equal('/uag/');
                expect((await fetch(`${base}/uag/`)).status).to.equal(200);
                expect((await fetch(`${base}/uag/developers/chat`)).status).to.equal(200);
                expect((await fetch(`${base}/uag/css/site.css?v=1`)).status).to.equal(200);
                expect((await fetch(`${base}/developers/chat`)).status).to.equal(404);
                expect((await fetch(`${base}/uag/nope`)).status).to.equal(404);
            }
            finally {
                server.close();
            }
        });
    });

    describe('a build with a showcase path', function () {
        let out;
        let config;
        const SHOWCASE = '/x-test-showcase';
        const env = { DEMO_UAG_URL: 'https://ai.example.com', FORMIO_PROJECT_URL: 'https://uag.form.io', NODE_ENV: 'production', DEMO_BASE_PATH: '/uag', DEMO_SHOWCASE_PATH: SHOWCASE };
        const htmlFiles = () => {
            const files = [];
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const file = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(file);
                    else if (entry.name.endsWith('.html')) files.push(path.relative(config.out, file).split(path.sep).join('/'));
                }
            };
            walk(config.out);
            return files;
        };
        const read = (file) => fs.readFileSync(path.join(config.out, file), 'utf8');
        const isShowcase = (file) => file.startsWith(`${SHOWCASE.slice(1)}/`);
        const isApp = (file) => file.startsWith('apps/');

        before(function () {
            this.timeout(60000);
            out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-unlisted-'));
            config = readConfig({ ...env, DEMO_OUT: path.join(out, 'dist') });
            build(config, env);
        });

        after(function () {
            fs.rmSync(out, { recursive: true, force: true });
        });

        it('serves the showcase under its path, and nothing under /showcase', function () {
            for (const route of [SHOWCASE, `${SHOWCASE}/conversation`, `${SHOWCASE}/workflow`, `${SHOWCASE}/formflow`, `${SHOWCASE}/documents`]) {
                expect(fs.existsSync(path.join(config.out, fileOf(route))), route).to.equal(true);
            }
            expect(fs.existsSync(path.join(config.out, 'showcase'))).to.equal(false);
            expect(read(fileOf(`${SHOWCASE}/conversation`))).to.include(`href="/uag${SHOWCASE}/workflow"`).and.include(`href="/uag${SHOWCASE}"`);
            expect(htmlFiles().filter((file) => /["']\/(uag\/)?showcase\b/.test(read(file)))).to.deep.equal([]);
        });

        it('names no showcase page anywhere outside the showcase: not in a page, image, script or stylesheet', function () {
            // A path on the site (after a quote, bracket, space or tag).
            const sitePath = new RegExp(`(^|[\\s>"'(=])(/uag)?(/showcase|${SHOWCASE})\\b`);
            const offenders = [];
            for (const file of fs.readdirSync(config.out, { recursive: true })) {
                const name = String(file).split(path.sep).join('/');
                if (isShowcase(name) || !/\.(html|svg|js|css|json|txt|xml)$/.test(name)) continue;
                if (sitePath.test(read(name))) offenders.push(name);
            }
            expect(offenders).to.deep.equal([]);
        });

        it('asks search engines not to index the showcase and the demo apps, and only those', function () {
            const files = htmlFiles();
            expect(files.filter(isShowcase)).to.have.lengthOf(5);
            expect(files.filter(isApp)).to.have.lengthOf(5);
            for (const file of files) {
                expect(read(file).includes(NOINDEX), file).to.equal(isShowcase(file) || isApp(file));
            }
        });

        it('links to the showcase only from the showcase, and never names its path in an app', function () {
            const linking = htmlFiles().filter((file) => read(file).includes(SHOWCASE));
            expect(linking.filter((file) => !isShowcase(file))).to.deep.equal([]);
            for (const file of fs.readdirSync(path.join(config.out, 'apps'), { recursive: true })) {
                const full = path.join(config.out, 'apps', file);
                if (fs.statSync(full).isFile()) expect(fs.readFileSync(full, 'utf8').includes(SHOWCASE), file).to.equal(false);
            }
        });

        it('names a leaking showcase page by a path that holds the showcase path whole, so CI logs mask it', function () {
            // A "secret" only the built showcase pages contain: the showcase path itself.
            expect(() => build(config, { ...env, SOME_API_KEY: SHOWCASE })).to.throw().with.property('message').that.matches(new RegExp(`SOME_API_KEY in ${SHOWCASE}/`));
        });

        describe('the Examples catalog', function () {
            const examples = loadExamples(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content/examples'));
            const decode = (html) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            const panel = (html, id) => {
                const start = html.indexOf(`id="panel-${id}"`);
                const code = html.indexOf('<code', start);
                return decode(html.slice(html.indexOf('>', code) + 1, html.indexOf('</code>', code)));
            };

            it('lists every example on /examples, in the catalog\'s order and grouped', function () {
                const html = read('examples/index.html');
                const hrefs = [...html.matchAll(/class="card card-link example-link" href="([^"]+)"/g)].map((match) => match[1]);
                expect(hrefs).to.deep.equal(examples.map((example) => `/uag${example.href}`));
                expect([...html.matchAll(/<section class="example-group"><h2>([^<]+)<\/h2>/g)].map((match) => match[1])).to.deep.equal(['Fill in forms', 'Workflows', 'Chat widget']);
            });

            it('gives every feature page its four parts, the side list and the docs link', function () {
                for (const example of examples) {
                    const html = read(fileOf(example.href));
                    expect(html, example.slug).to.include(`<h1>${example.title.replace(/'/g, '&#39;')}</h1>`);
                    expect(html, example.slug).to.include('id="turn-it-on"').and.include('id="panel-form"').and.include('id="panel-page"');
                    expect(html, example.slug).to.include(`data-src="/uag/apps/example/?form=${example.form.path}&amp;mode=${example.mode}`);
                    expect(html, example.slug).to.include('data-flow').and.include('data-demo-gate');
                    expect(html, example.slug).to.include(`href="/uag${example.docs}"`);
                    expect(html, example.slug).to.include(`href="/uag${example.href}" aria-current="page"`);
                    expect(html.includes(NOINDEX), example.slug).to.equal(false);
                }
            });

            it('shows each example\'s form exactly as its form.json, and the page code that renders it', function () {
                for (const example of examples) {
                    const html = read(fileOf(example.href));
                    expect(JSON.parse(panel(html, 'form')), example.slug).to.deep.equal(example.form);
                    const code = panel(html, 'page');
                    expect(code, example.slug).to.include(`${example.mode === 'chat' ? 'Formio.createChat' : 'Formio.createForm'}(`).and.include(`'https://uag.form.io/${example.form.path}'`);
                    if (example.action) expect(JSON.parse(panel(html, 'action')), example.slug).to.deep.equal(example.action);
                }
            });

            it('publishes each example\'s PDFs and images beside its page, and links its sample files there', function () {
                const withAssets = examples.filter((example) => example.assets.length);
                expect(withAssets).to.not.have.lengthOf(0);
                for (const example of withAssets) {
                    const html = read(fileOf(example.href));
                    for (const asset of example.assets) {
                        const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content/examples', example.folder, asset));
                        expect(fs.readFileSync(path.join(config.out, 'examples', example.slug, asset)).equals(source), asset).to.equal(true);
                    }
                    for (const sample of example.samples.filter((item) => item.file)) {
                        expect(html, sample.file).to.include(`href="/uag${example.href}/${sample.file}" data-sample-file>${sample.label}</a>`);
                    }
                }
            });

            it('runs the same page code it shows, for an example that has some', function () {
                const withPage = examples.filter((example) => example.page);
                expect(withPage).to.not.have.lengthOf(0);
                for (const example of withPage) {
                    const shown = panel(read(fileOf(example.href)), 'page');
                    const run = read(`apps/example/pages/${example.slug}.js`);
                    const body = run.slice(run.indexOf('{\n') + 2, run.lastIndexOf('\n};')).split('\n').map((line) => line.replace(/^ {2}/, '')).join('\n');
                    expect(shown, example.slug).to.include(body.split('\n').map((line) => (line ? `    ${line}` : '')).join('\n'));
                    expect(run, example.slug).to.not.include('UAG_PROJECT_URL');
                }
            });

            it('links Examples from every page\'s header, and names no conversation form on a catalog page', function () {
                for (const file of htmlFiles().filter((name) => !isApp(name) && !isShowcase(name))) {
                    const html = read(file);
                    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
                    expect(header, file).to.match(/<a href="\/uag\/examples"[^>]*>Examples<\/a>/);
                }
                for (const file of htmlFiles().filter((name) => name.startsWith('examples/'))) {
                    expect(read(file), file).to.not.match(/conversation(al)? form/i);
                }
            });
        });

        it('has no contact page of its own: every sales call to action leaves for Form.io\'s', function () {
            expect(fs.existsSync(path.join(config.out, 'contact'))).to.equal(false);
            const files = htmlFiles();
            expect(files.filter((file) => /(?:href|action)="(?:\/uag)?\/contact\b/.test(read(file)))).to.deep.equal([]);
            for (const file of files.filter((name) => !isApp(name))) {
                const html = read(file);
                const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
                expect(header, file).to.include(`href="${config.links.contact}">Talk to Sales</a>`);
                expect(header, file).to.include(`href="${config.links.trial}">Try free for 30 days</a>`);
            }
        });

        it('closes every page with a one-line footer: copyright and the open-source notice, and no links', function () {
            for (const file of htmlFiles().filter((name) => !isApp(name))) {
                const html = read(file);
                const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
                expect(footer, file).to.include('Form.io LLC. All rights reserved.').and.include('MIT license');
                expect(footer, file).to.not.include('<a ');
            }
        });

        it('uses light sections only outside the showcase, with sales as a green button and the trial as a text link', function () {
            for (const file of htmlFiles().filter((name) => !isApp(name) && !isShowcase(name))) {
                expect(read(file), file).to.not.match(/class="[^"]*\b(section-dark|section-ink|section-green|card-dark)\b/);
            }
            for (const file of ['index.html', 'getting-started/index.html']) {
                const html = read(file);
                expect(html, file).to.include(`<a class="btn btn-primary" href="${config.links.contact}">Talk to Sales`);
                expect(html, file).to.include(`<a class="link-arrow" href="${config.links.trial}">Try free for 30 days</a>`);
            }
        });

        it('opens Getting Started on Enterprise, self-hosted, with the trial last', function () {
            const html = read('getting-started/index.html');
            const tabs = [...html.matchAll(/<button role="tab" id="(tab-[a-z]+)" aria-controls="panel-[a-z]+" aria-selected="(true|false)"/g)].slice(0, 3);
            expect(tabs.map(([, id, selected]) => `${id}:${selected}`)).to.deep.equal(['tab-ent:true', 'tab-oss:false', 'tab-saas:false']);
            expect(html).to.include('id="panel-ent" aria-labelledby="tab-ent">').and.include('id="panel-saas" aria-labelledby="tab-saas" hidden>');
            const cards = [...html.matchAll(/<div class="card[^"]*">\s*<span class="num">[^<]*<\/span>\s*<h3>([^<]*)<\/h3>/g)].map((match) => match[1]);
            expect(cards).to.deep.equal(['Enterprise, self-hosted', 'Open Source stack', '30-day free trial']);
        });

        it('offers the showcase nowhere in the header, the menu or the footer', function () {
            const home = read('index.html');
            const header = home.slice(home.indexOf('<header'), home.indexOf('</header>'));
            const footer = home.slice(home.indexOf('<footer'), home.indexOf('</footer>'));
            expect(header).to.not.match(/Showcase|\/showcase/);
            expect(footer).to.not.match(/Showcase|\/showcase/);
        });
    });

    describe('local server', function () {
        it('allows the pages to load from and call the UAG and the project, and nothing else', function () {
            const policy = contentSecurityPolicy({ uagOrigin: 'https://uag.example.com', projectOrigin: 'https://forms.example.com' });
            const directive = (name) => policy.split('; ').find((part) => part.startsWith(`${name} `));
            expect(directive('connect-src')).to.equal("connect-src 'self' https://uag.example.com https://*.form.io https://forms.example.com");
            expect(directive('script-src')).to.include('https://uag.example.com');
            expect(directive('default-src')).to.equal("default-src 'self'");
            expect(contentSecurityPolicy({ uagOrigin: 'https://uag.example.com', projectOrigin: 'https://uag.form.io' })).not.to.include('https://uag.form.io');
        });

        it('maps clean URLs to index.html files, and refuses paths outside the site', function () {
            const site = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-urls-'));
            try {
                for (const file of ['index.html', 'examples/index.html', 'css/site.css']) {
                    fs.mkdirSync(path.join(site, path.dirname(file)), { recursive: true });
                    fs.writeFileSync(path.join(site, file), file);
                }
                const mapped = { '/': 'index.html', '/examples': 'examples/index.html', '/examples/': 'examples/index.html', '/css/site.css': 'css/site.css' };
                for (const [uri, file] of Object.entries(mapped)) expect(resolve(site, uri), uri).to.equal(path.join(site, file));
                expect(resolve(site, '/../../etc/passwd')).to.equal(null);
                expect(resolve(site, '/missing')).to.equal(null);
            }
            finally {
                fs.rmSync(site, { recursive: true, force: true });
            }
        });

        it('answers a path the site does not have with its 404 page', async function () {
            const site = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-404-'));
            fs.writeFileSync(path.join(site, 'index.html'), 'home');
            fs.writeFileSync(path.join(site, '404.html'), 'not here');
            const server = createServer(site, { 'Content-Security-Policy': "default-src 'self'" });
            await new Promise((done) => server.listen(0, '127.0.0.1', done));
            try {
                const base = `http://127.0.0.1:${server.address().port}`;
                const missing = await fetch(`${base}/nope`);
                expect(missing.status).to.equal(404);
                expect(await missing.text()).to.equal('not here');
                const home = await fetch(`${base}/`);
                expect(await home.text()).to.equal('home');
                expect(home.headers.get('content-security-policy')).to.equal("default-src 'self'");
            }
            finally {
                server.close();
                fs.rmSync(site, { recursive: true, force: true });
            }
        });
    });
});
