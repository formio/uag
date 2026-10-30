import fs from 'fs';

/**
 * Launches headless Chromium for the browser suites. Call from a `before` hook:
 * when Playwright's browser is not installed, the suite is skipped with the
 * command that installs it, rather than failing.
 *
 * The example pages load formio.js, Bootstrap and fonts from CDNs, so these
 * suites need internet access.
 */
export async function launchBrowser(context) {
    const { chromium } = await import('playwright');
    if (!fs.existsSync(chromium.executablePath())) {
        console.log('    Skipping: Chromium is not installed. Run `npx playwright install chromium`.');
        context.skip();
    }
    const browser = await chromium.launch({ headless: true });
    return {
        browser,
        /** A fresh page, recording its uncaught errors in `page.errors`. */
        async page() {
            const page = await (await browser.newContext()).newPage();
            page.errors = [];
            page.on('pageerror', (error) => page.errors.push(error.message));
            return page;
        },
        close: () => browser.close(),
    };
}
