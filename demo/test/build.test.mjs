import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy, formioBaseOf, projectNameOf, readConfig } from '../lib/config.mjs';
import { render } from '../lib/pages.mjs';
import { build, fileOf } from '../scripts/build.mjs';
import { createServer, resolve } from '../scripts/serve.mjs';
import { purge, templatePaths } from '../scripts/retention.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteTemplate = fs.readFileSync(path.join(root, 'deploy/site.yml'), 'utf8');

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

        it('derives the public URL from DEMO_DOMAIN, unless DEMO_PUBLIC_URL names it', function () {
            expect(readConfig({}).publicUrl).to.equal('https://ai.form.io');
            expect(readConfig({ DEMO_DOMAIN: 'agents.example.com' }).publicUrl).to.equal('https://agents.example.com');
            expect(readConfig({ DEMO_PUBLIC_URL: 'http://localhost:8080/' }).publicUrl).to.equal('http://localhost:8080');
        });

        it('refuses a production build that does not name its UAG', function () {
            expect(() => readConfig({ NODE_ENV: 'production' })).to.throw(/DEMO_UAG_URL/);
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
            for (const route of ['/', '/examples', '/examples/conversation', '/examples/workflow', '/examples/formflow', '/examples/documents', '/developers', '/developers/agent-api', '/getting-started']) {
                expect(fs.existsSync(path.join(config.out, fileOf(route))), route).to.equal(true);
            }
            expect(read('404.html')).to.include('</html>');
        });

        it('gives every page and demo app the UAG and the project, and leaves no template unfilled', function () {
            expect(read('examples/conversation/index.html')).to.include('data-uag-url="https://uag.build-test.example"').and.include('data-project-url="https://uag.form.io"');
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

    describe('hosting', function () {
        it('sends the same Content-Security-Policy from CloudFront as lib/config.mjs makes', function () {
            const line = siteTemplate.split('\n').find((text) => text.includes('ContentSecurityPolicy: !Sub'));
            const policy = JSON.parse(line.slice(line.indexOf('!Sub') + 5)).replaceAll('${UagOrigin}', 'https://uag.example.com');
            expect(policy).to.equal(contentSecurityPolicy({ uagOrigin: 'https://uag.example.com', projectOrigin: 'https://uag.form.io' }));
        });

        it('maps clean URLs in CloudFront as the local server does', function () {
            const code = siteTemplate.slice(siteTemplate.indexOf('function handler'), siteTemplate.indexOf('\n\n', siteTemplate.indexOf('function handler')));
            const context = vm.createContext({});
            vm.runInContext(code, context);
            const site = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-urls-'));
            try {
                for (const file of ['index.html', 'examples/index.html', 'css/site.css']) {
                    fs.mkdirSync(path.join(site, path.dirname(file)), { recursive: true });
                    fs.writeFileSync(path.join(site, file), file);
                }
                for (const uri of ['/', '/examples', '/examples/', '/css/site.css']) {
                    const mapped = context.handler({ request: { uri } }).uri;
                    expect(resolve(site, uri), uri).to.equal(path.join(site, mapped));
                }
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

    describe('retention', function () {
        it('purges the demo forms and the guests', function () {
            expect(templatePaths()).to.include.members(['service-request', 'application', 'claim', 'lease-review', 'guest']);
        });

        it('deletes what is older than the cut-off in batches, with the project key, and reports counts', async function () {
            const calls = [];
            const old = Array.from({ length: 100 }, (_, i) => ({ _id: `a${i}` }));
            const fetch = async (url, init = {}) => {
                calls.push({ url, method: init.method || 'GET', key: init.headers['x-token'] });
                if (init.method === 'DELETE') return new Response(null, { status: 200 });
                const listings = calls.filter((call) => call.method === 'GET').length;
                return Response.json(listings === 1 ? old : listings === 2 ? [{ _id: 'b' }] : []);
            };
            const now = Date.parse('2026-11-06T12:00:00Z');
            const { deleted, failed } = await purge({ projectUrl: 'https://uag.form.io/', key: 'k', hours: 24, paths: ['application', 'guest'], fetch, now });
            expect(deleted).to.deep.equal({ application: 101, guest: 0 });
            expect(failed).to.deep.equal([]);
            expect(calls[0].url).to.equal('https://uag.form.io/application/submission?created__lt=2026-11-05T12%3A00%3A00.000Z&limit=100&select=_id');
            expect(calls.every((call) => call.key === 'k')).to.equal(true);
        });

        it('reports a form it could not purge, and goes on to the next', async function () {
            const fetch = async (url) => (url.includes('/claim/') ? new Response('no', { status: 401 }) : Response.json([]));
            const { failed } = await purge({ projectUrl: 'https://uag.form.io', key: 'k', paths: ['claim', 'guest'], fetch });
            expect(failed).to.deep.equal(['claim']);
        });
    });
});
