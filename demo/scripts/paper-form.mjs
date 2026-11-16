/**
 * Renders the paper form of the "Fill an online form from a scanned paper form"
 * example (content/examples/01-fill-from-scanned-form/paper-form.html) into the
 * files its page offers:
 *
 * - paper-form.pdf: the blank form, on one Letter page.
 * - sample-scan.jpg: the form filled in by hand and scanned, at 150 dpi.
 *
 *   node demo/scripts/paper-form.mjs
 *
 * Needs Playwright's Chromium (npx playwright install chromium) and the network,
 * for the handwriting font. Run it after changing paper-form.html, and commit
 * both files.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../content/examples/01-fill-from-scanned-form');
const source = pathToFileURL(path.join(folder, 'paper-form.html')).href;

const browser = await chromium.launch();
try {
    const blank = await browser.newPage();
    await blank.goto(source, { waitUntil: 'networkidle' });
    await blank.pdf({ path: path.join(folder, 'paper-form.pdf'), format: 'Letter', printBackground: true });

    // 816 x 1056 CSS pixels is a Letter page at 96 dpi; 1.5625 times that is 150 dpi.
    const scan = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1.5625 });
    await scan.goto(`${source}#filled`, { waitUntil: 'networkidle' });
    await scan.evaluate(() => document.fonts.ready);
    await scan.screenshot({ path: path.join(folder, 'sample-scan.jpg'), type: 'jpeg', quality: 70 });
    console.log(`[paper-form] Wrote paper-form.pdf and sample-scan.jpg in ${path.relative(process.cwd(), folder)}.`);
}
finally {
    await browser.close();
}
