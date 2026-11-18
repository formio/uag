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
    const header = (page) => page.evaluate(() => [...document.querySelectorAll('.site-header .nav a')]
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
        expect(seen['/'].map((link) => link.split(' @')[0])).to.deep.equal(['Product', 'Getting Started', 'Examples', 'Developers']);
    });

    it('barely moves the header links when the font arrives late, on a slow first visit', async function () {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        // The font takes 800ms, so the page is laid out in its fallback first.
        await context.route('**/*.woff2', async (route) => {
            await new Promise((done) => setTimeout(done, 800));
            await route.continue();
        });
        const page = await context.newPage();
        const lefts = () => page.evaluate(() => [...document.querySelectorAll('.site-header .nav a')]
            .filter((link) => link.offsetParent)
            .map((link) => ({ text: link.textContent.trim(), left: link.getBoundingClientRect().left })));
        await page.goto(`${base}/`, { waitUntil: 'commit' });
        await page.waitForSelector('.site-header .nav a');
        const before = await lefts();
        expect(await page.evaluate(() => document.fonts.check('500 15px Inter')), 'Inter loaded before the first read').to.equal(false);
        await page.evaluate(() => document.fonts.ready);
        const after = await lefts();
        expect(after.map((link) => link.text)).to.deep.equal(before.map((link) => link.text));
        // No fallback has Inter's every width: within 2px is out of sight; without the matched fallback it is 9px.
        const moved = after.map((link, i) => `${link.text} ${Math.abs(link.left - before[i].left).toFixed(1)}px`)
            .filter((entry) => parseFloat(entry.split(' ').pop()) > 2);
        expect(moved).to.deep.equal([]);
        await context.close();
    });

    it('fits the header in one row without overlap at every desktop width', async function () {
        const context = await browser.newContext({ viewport: { width: 1400, height: 400 } });
        const page = await context.newPage();
        await page.goto(`${base}/`);
        await page.evaluate(() => document.fonts.ready);
        for (let width = 981; width <= 1400; width += 10) {
            await page.setViewportSize({ width, height: 400 });
            // The brand's parts, not the brand: its box shrinks while its text overflows.
            const crowded = await page.evaluate(() => {
                const items = [...document.querySelectorAll('.site-header .brand img, .site-header .brand-product, .site-header .nav a, .site-header .menu-toggle')]
                    .filter((item) => item.offsetParent)
                    .map((item) => ({ text: item.textContent.trim() || item.className, box: item.getBoundingClientRect() }));
                const row = document.querySelector('.site-header .container').getBoundingClientRect();
                const problems = [];
                for (let i = 1; i < items.length; i++) {
                    if (items[i].box.left < items[i - 1].box.right) problems.push(`"${items[i - 1].text}" overlaps "${items[i].text}"`);
                }
                if (items.at(-1).box.right > row.right + 1) problems.push(`"${items.at(-1).text}" runs past the header`);
                return problems;
            });
            expect(crowded, `${width}px`).to.deep.equal([]);
        }
        await context.close();
    });

    it('opens Getting Started on its 30-day free trial tab from a "Try free for 30 days" link', async function () {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        const shown = () => page.evaluate(() => [...document.querySelectorAll('.tab-panel')].filter((panel) => !panel.hidden).map((panel) => panel.id));
        // From another page: the home page's link.
        await page.goto(`${base}/`);
        await page.locator('a', { hasText: 'Try free for 30 days' }).first().click();
        await page.waitForURL(/\/getting-started#trial$/);
        expect(await shown()).to.include('panel-saas').and.not.include('panel-ent');
        expect(await page.locator('#tab-saas').getAttribute('aria-selected')).to.equal('true');
        expect(await page.locator('#panel-saas').isVisible()).to.equal(true);
        // From Getting Started itself, with another tab open.
        await page.goto(`${base}/getting-started`);
        expect(await shown()).to.include('panel-ent').and.not.include('panel-saas');
        await page.locator('a', { hasText: 'Try free for 30 days' }).last().click();
        await page.waitForFunction(() => !document.getElementById('panel-saas').hidden);
        expect(await shown()).to.include('panel-saas').and.not.include('panel-ent');
        await context.close();
    });
});
