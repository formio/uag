/**
 * Layer 1: the demo site's Examples catalog, in a browser, on a fresh build.
 * Needs only the built site: no UAG, no Form.io. A visitor who has not started
 * the live examples sees the gate and the page makes no call to the UAG; once
 * they have a guest (stubbed here, as js/guest.js keeps it), every example page
 * loads its live form straight away. The side list, previous and next, and the
 * Copy buttons work.
 */
import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UAG = 'http://127.0.0.1:3299';

describe('Layer 1: the demo site\'s Examples catalog', function () {
    this.timeout(120000);
    let browser;
    let server;
    let base;
    let out;
    let examples;

    before(async function () {
        const { chromium } = await import('playwright');
        if (!fs.existsSync(chromium.executablePath())) {
            console.log('    Skipping: Chromium is not installed. Run `npx playwright install chromium`.');
            this.skip();
        }
        const { readConfig } = await import('../../demo/lib/config.mjs');
        const { build } = await import('../../demo/scripts/build.mjs');
        const { createServer } = await import('../../demo/scripts/serve.mjs');
        const { loadExamples } = await import('../../demo/lib/examples.mjs');
        examples = loadExamples(path.resolve('demo/content/examples'));
        out = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-demo-examples-'));
        const env = { DEMO_UAG_URL: UAG, DEMO_OUT: path.join(out, 'dist'), DEMO_BASE_PATH: '/uag' };
        const config = readConfig(env);
        build(config, env);
        server = createServer(config.out, {}, '/uag');
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
        base = `http://127.0.0.1:${server.address().port}/uag`;
        browser = await chromium.launch({ headless: true });
    });

    after(async function () {
        if (browser) await browser.close();
        if (server) server.close();
        if (out) fs.rmSync(out, { recursive: true, force: true });
    });

    /** A fresh visitor; with `guest`, one who has started the live examples. */
    async function visitor({ guest = false } = {}) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
        if (guest) {
            await context.addInitScript(() => {
                localStorage.setItem('uag-demo-guest', JSON.stringify({ token: 'h.e30.s', expires: Date.now() + 60 * 60 * 1000 }));
            });
        }
        // Nothing answers at the UAG: the calls are only counted.
        const calls = [];
        await context.route(`${UAG}/**`, (route) => {
            calls.push(route.request().url());
            return route.fulfill({ status: 503, body: 'offline' });
        });
        return { context, calls };
    }

    it('shows the gate, and calls nothing, until the visitor starts the live examples', async function () {
        const { context, calls } = await visitor();
        const page = await context.newPage();
        await page.goto(`${base}${examples[0].href}`);
        await expect(await page.locator('[data-demo-gate]').isVisible()).to.equal(true);
        expect(await page.locator('[data-demo-start]').textContent()).to.equal('Start the live examples');
        expect(await page.locator('[data-demo-frame]').getAttribute('src')).to.equal(null);
        await page.waitForTimeout(500);
        expect(calls).to.deep.equal([]);
        await context.close();
    });

    it('loads every example\'s live form straight away once the visitor has a guest', async function () {
        const { context } = await visitor({ guest: true });
        const page = await context.newPage();
        for (const example of examples) {
            await page.goto(`${base}${example.href}`);
            const frame = page.locator('[data-demo-frame]');
            await frame.waitFor({ state: 'visible' });
            expect(await page.locator('[data-demo-gate]').isVisible(), example.slug).to.equal(false);
            expect(await frame.getAttribute('src'), example.slug).to.equal(`/uag/apps/example/?form=${example.form.path}&mode=${example.mode}${example.page ? '&page=1' : ''}`);
        }
        await context.close();
    });

    it('marks the current example in the side list, and walks the catalog with previous and next', async function () {
        const { context } = await visitor();
        const page = await context.newPage();
        await page.goto(`${base}${examples[0].href}`);
        for (let i = 0; i < examples.length; i++) {
            expect(await page.locator('.docs-nav [aria-current="page"]').textContent()).to.equal(examples[i].title);
            expect(await page.locator('h1').textContent()).to.equal(examples[i].title);
            if (i < examples.length - 1) await Promise.all([page.waitForURL(`${base}${examples[i + 1].href}`), page.locator('.pager-next').click()]);
        }
        expect(await page.locator('.pager-next').count()).to.equal(0);
        await Promise.all([page.waitForURL(`${base}${examples.at(-2).href}`), page.locator('.pager-prev').click()]);
        await context.close();
    });

    it('copies the form JSON as its form.json, and the page code', async function () {
        const { context } = await visitor();
        const page = await context.newPage();
        const example = examples.find((item) => item.slug === 'generate-text');
        await page.goto(`${base}${example.href}`);
        await page.locator('#panel-form [data-copy]').click();
        expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).to.deep.equal(example.form);
        await page.locator('#tab-page').click();
        await page.locator('#panel-page [data-copy]').click();
        const code = await page.evaluate(() => navigator.clipboard.readText());
        expect(code).to.include(`${UAG}/uag-js/uag.use.js`).and.include(`/${example.form.path}').then((form) => {`).and.include("form.on('draftReply'");
        await context.close();
    });
});
