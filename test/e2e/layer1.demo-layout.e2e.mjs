/**
 * Layer 1: the demo site's header stays put. Every header link must sit at the
 * same place on a short page and a long one, with classic (space-taking)
 * scrollbars as on Windows, and must not move when the web font arrives on a
 * visitor's first page.
 *
 * Needs only the built site: no UAG, no Form.io.
 */
import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Short and long pages: the 404 page fits the window, the others scroll. */
const PAGES = ['/', '/getting-started', '/faq', '/developers', '/developers/agent-api', '/no-such-page'];

const CLASSIC_SCROLLBARS = '::-webkit-scrollbar { width: 15px; background: #eee; } ::-webkit-scrollbar-thumb { background: #aaa; }';

describe('Layer 1: the demo site header', function () {
    this.timeout(120000);
    let browser;
    let server;
    let base;
    let out;

    before(async function () {
        const { chromium } = await import('playwright');
        if (!fs.existsSync(chromium.executablePath())) {
            console.log('    Skipping: Chromium is not installed. Run `npx playwright install chromium`.');
            this.skip();
        }
        const { readConfig } = await import('../../demo/lib/config.mjs');
        const { build } = await import('../../demo/scripts/build.mjs');
        const { createServer } = await import('../../demo/scripts/serve.mjs');
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-layout-'));
        const env = { DEMO_UAG_URL: 'http://127.0.0.1:3200', DEMO_OUT: path.join(out, 'dist'), DEMO_BASE_PATH: '/uag' };
        const config = readConfig(env);
        build(config, env);
        server = createServer(config.out, {}, '/uag');
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
        base = `http://127.0.0.1:${server.address().port}/uag`;
        // Playwright hides scrollbars in headless Chromium; keep them.
        browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
    });

    after(async function () {
        if (browser) await browser.close();
        if (server) server.close();
        if (out) fs.rmSync(out, { recursive: true, force: true });
    });

    /** A page in a fresh context (nothing cached), with classic scrollbars, as on Windows. */
    async function open(pathname) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        // Styling the scrollbar turns Chromium's overlay scrollbars into classic ones.
        await context.route('**/*', async (route) => {
            if (route.request().resourceType() !== 'document') return route.continue();
            const response = await route.fetch();
            const body = (await response.text()).replace('<head>', `<head><style>${CLASSIC_SCROLLBARS}</style>`);
            return route.fulfill({ response, body });
        });
        const page = await context.newPage();
        await page.goto(`${base}${pathname}`, { waitUntil: 'commit' });
        await page.waitForSelector('.site-header .nav a');
        return page;
    }

    /** Each visible header link's text, left edge and width. */
    const header = (page) => page.evaluate(() => [...document.querySelectorAll('.site-header .nav a, .site-header .header-actions a')]
        .filter((link) => link.offsetParent)
        .map((link) => {
            const box = link.getBoundingClientRect();
            return `${link.textContent.trim()} @${Math.round(box.x)} w${Math.round(box.width)}`;
        }));

    it('places every header link alike on short and long pages, and while the font loads', async function () {
        const seen = {};
        for (const pathname of PAGES) {
            const page = await open(pathname);
            const first = await header(page);
            await page.evaluate(() => document.fonts.ready);
            await page.waitForLoadState('load');
            const settled = await header(page);
            expect(first, `${pathname} before and after its font loaded`).to.deep.equal(settled);
            seen[pathname] = settled;
            await page.context().close();
        }
        for (const pathname of PAGES) expect(seen[pathname], pathname).to.deep.equal(seen['/']);
        expect(seen['/']).to.have.length.greaterThan(4);
    });
});
