/** Steps the scenes share. */

export const PORTAL_EMAIL = process.env.RECORD_PORTAL_EMAIL || 'admin@example.com';
export const PORTAL_PASSWORD = process.env.RECORD_PORTAL_PASSWORD || 'uag-e2e-password';

/** Sign in to the Form.io Open Source portal and wait for its forms list. */
export async function portalLogin(d, portal) {
    await d.goto(portal);
    const page = d.page;
    if (await page.locator('input[type=password]').count()) {
        await page.fill('input[type=email]', PORTAL_EMAIL);
        await page.fill('input[type=password]', PORTAL_PASSWORD);
        await page.click('button:has-text("Submit")');
    }
    await page.locator('.item-wrap.form').first().waitFor();
    await d.restore();
}

/**
 * The Open Source portal shows a form in a fixed-height panel that scrolls on
 * its own; scrolling the window instead moves the panel and leaves the bottom
 * of the form cut off. Scroll the panel.
 */
export const portalPanel = (d) => d.page.locator('.panel.active').first();

/** A form's row in the portal's forms list. */
export const portalForm = (d, title) => d.page.locator('.item-wrap.form', { hasText: title });

/**
 * What a recording shows of an example page: only its demo, the app and the
 * flow viewer ("Behind the scenes"), filling a screen narrowed to STAGE_WIDTH so
 * they read larger in the GIF. The site's navigation and the page around the
 * demo are covered.
 */
const STAGE_WIDTH = 1024;
const STAGE = `
    html.rec-stage, html.rec-stage body { overflow: hidden !important; }
    html.rec-stage .demo-layout { position: fixed; inset: 0; z-index: 2147483000; margin: 0; padding: 12px;
        background: #eef1f5; grid-template-columns: minmax(0, 1fr) 372px; gap: 12px; align-items: stretch; }
    html.rec-stage .demo-layout > .browser { display: flex; flex-direction: column; min-height: 0; }
    html.rec-stage .demo-layout > .browser > iframe { flex: 1; height: auto; min-height: 0; }
    html.rec-stage .demo-layout .flow { position: relative; top: 0; height: auto; min-height: 0; }
`;

/** Open an example page on its demo alone (see STAGE). */
export async function openExample(d, site, name) {
    await d.goto(`${site}/examples/${name}`);
    const page = d.page;
    const app = page.locator(`iframe[src="/apps/${name}/"]`);
    await app.waitFor();
    await page.addStyleTag({ content: STAGE });
    await page.evaluate(() => document.documentElement.classList.add('rec-stage'));
    await d.resize(STAGE_WIDTH);
    await page.waitForTimeout(800);
    return page.frameLocator(`iframe[src="/apps/${name}/"]`);
}

/** The frame object (for scrolling) of an example's app. */
export const appFrame = (d, name) => d.page.frames().find((f) => f.url().includes(`/apps/${name}/`));

/** Sign in to the Form.io Enterprise portal and open the demo's project. */
export async function enterpriseLogin(d, env, project = 'UAG Demo') {
    await d.goto(env.portal);
    const page = d.page;
    await page.fill('input[name="data[email]"]', env.email);
    await page.fill('input[name="data[password]"]', env.password);
    await page.click('button:has-text("LOG IN")');
    await page.getByText(project, { exact: true }).first().click();
    await page.getByText('New Form').first().waitFor();
    await d.restore();
}

/** A component in the form builder, by its key. */
export const builderComponent = (d, key) => d.page.locator(`.builder-component:has(> .formio-component-${key})`).first();

/** Open a builder component's settings at a tab (`API` shows its custom properties). */
export async function openSettings(d, key, tab = 'API') {
    const component = builderComponent(d, key);
    await d.moveTo(component, { offset: { x: 0, y: -10 } });
    await d.click(component.locator('[ref="editComponent"]').first(), { after: 900 });
    await d.click(d.page.locator('.formio-dialog').getByText(tab, { exact: true }).first(), { after: 600 });
}

/** Close up on the open settings' custom properties, and point at them. */
export async function showCustomProperties(d) {
    const label = d.page.locator('.formio-dialog').getByText('Custom Properties').first();
    await d.focus(label, { pad: 120 });
    await d.moveTo(label, { offset: { x: 120, y: 80 } });
}

export async function closeSettings(d) {
    await d.focus(null);
    await d.click(d.page.locator('.formio-dialog [ref="cancelButton"]').first(), { after: 500 });
}

/** Show key-like values (API keys in a webhook's headers) as dots before they are recorded. */
export async function maskKeys(d) {
    await d.page.evaluate(() => {
        for (const input of document.querySelectorAll('input')) {
            if (/^[0-9a-f]{24,}$/i.test(input.value)) input.type = 'password';
        }
    });
}
