/**
 * Agentic Formflow: the storyboard in ../README.md, as a script.
 */
import { enterpriseLogin, openSettings, showCustomProperties, closeSettings, openExample, appFrame } from './common.mjs';

const DESCRIPTION = 'Someone rear-ended me at the light on Main St and 4th Ave in Springfield yesterday around 5:30pm. My neck hurts.';

export default async function formflow(d, env) {
    const { site } = env;
    const page = d.page;

    // 1. The task, in the Enterprise form builder.
    // The portal stage connected to the UAG, so the UAG's own Run task action opens.
    await d.cut(async () => {
        await enterpriseLogin(d, env);
        await d.goto(`${env.portal}/#/project/${env.uagStage}/form/`);
        await page.getByText('First Notice of Loss', { exact: true }).click();
        await page.locator('.formio-component-lossDescription').first().waitFor();
    });
    await d.caption(1, 'The claim form defines a <code>triage</code> task. The description is the text it reads.');
    await d.hold(700);
    await openSettings(d, 'lossDescription');
    await showCustomProperties(d);
    await d.hold(2400);
    await closeSettings(d);

    // 2. A decision field, and what happens when the engine is unsure.
    await d.caption(2, 'Claim type is a decision field. When JEV is under 60% sure, this page asks the person to check it.');
    await d.click(page.getByText('Check our understanding', { exact: true }).first(), { after: 900 });
    await openSettings(d, 'claimType');
    await showCustomProperties(d);
    await d.hold(2800);
    await closeSettings(d);

    // 3. The server decides again before every save.
    await d.caption(3, 'An “Agent: Run task” action re-decides the <code>triage</code> task on the server, before every create and update.');
    await d.click(page.locator('a, button', { hasText: /^\s*Actions\s*$/ }).first(), { after: 700 });
    await d.click(page.getByText('Agent: Run task (triage)').first(), { after: 300 });
    const task = page.locator('.formio-component-task').first();
    await task.waitFor();
    await d.focus(['task', 'answer', 'when', 'method'].map((key) => page.locator(`.formio-component-${key}`).first()), { pad: 40 });
    await d.moveTo(task, { offset: { x: -200, y: 0 } });
    await d.hold(1800);
    await d.moveTo(page.locator('.formio-component-answer').first(), { offset: { x: -150, y: 0 } });
    await d.hold(1600);
    await d.moveTo(page.locator('.formio-component-when').first(), { offset: { x: -150, y: 0 } });
    await d.hold(1600);
    await d.moveTo(page.locator('.formio-component-method').first(), { offset: { x: -150, y: 0 } });
    await d.hold(2000);

    const app = await d.cut(() => openExample(d, site, 'formflow'));
    const steps = app.locator('.topbar-steps');
    const next = () => app.locator('button:visible', { hasText: /^Continue/ }).last();

    // 4. One description.
    await d.caption(4, 'The policyholder describes what happened, once.');
    await d.hold(1200);
    await d.type(app.locator('input[name="data[policyNumber]"]'), 'AUTO-2048-1173', { delay: 45 });
    await d.type(app.locator('textarea[name="data[lossDescription]"]'), DESCRIPTION, { delay: 18 });
    await d.hold(600);

    // 5. Decisions choose the steps.
    await d.caption(5, 'JEV classifies the claim in milliseconds, and the wizard adds only the steps that apply.');
    await d.click(next(), { after: 200 });
    await steps.filter({ hasText: /of [6-9]/ }).waitFor({ timeout: 60000 });
    await d.hold(1200);
    await d.click(steps, { after: 3600 });
    await d.click(app.locator('.rail-close'), { after: 500 });

    // 6. Suggestions, and the person's own input.
    await d.caption(6, 'Claude fills in dates, places and names as suggestions. Your own input always wins.');
    await d.fastForward(() => app.locator('text=Suggested from your description').first().waitFor({ timeout: 120000 }), { label: 'Claude at work · sped up' });
    await d.hold(2200);
    const place = app.locator('input[name="data[lossLocation]"]');
    await d.click(place, { after: 150 });
    await place.press('End');
    await place.pressSequentially(', IL', { delay: 90 });
    await d.hold(1800);

    // 7. The rest is already filled in.
    await d.caption(7, 'Every step the description answered is already filled in.');
    await d.fastForward(async () => {
        for (let i = 0; i < 8; i++) {
            const [, at, of] = (await steps.innerText()).match(/(\d+) of (\d+)/) || [];
            if (at && at === of) break;
            const report = app.locator('input[name="data[policeReportNumber]"]:visible');
            if (await report.count()) await report.fill('SPD-26-104233');
            const name = app.locator('input[name="data[contactName]"]:visible');
            if (await name.count()) {
                await name.fill('Jordan Ellis');
                await app.locator('input[name="data[contactPhone]"]').pressSequentially('5125550147');
            }
            await d.page.waitForTimeout(1600);
            await next().click();
            await d.page.waitForTimeout(700);
        }
    }, { factor: 3, max: 6, label: 'Stepping through · sped up' });

    // 8. Submitted, and re-decided on the server.
    await d.caption(8, 'Submitted. Its Run task action re-decided the claim on the server before it was saved.');
    await d.hold(1200);
    const attest = app.locator('input[name="data[attestation]"]');
    await attest.scrollIntoViewIfNeeded();
    await d.click(attest, { after: 600 });
    await d.click(app.locator('button:visible', { hasText: /^Submit claim/ }), { after: 300 });
    await app.locator('text=Your claim number').first().waitFor({ timeout: 120000 });
    await d.scrollFrame(appFrame(d, 'formflow'), 0, { duration: 400 });
    await d.hold(4500);
}
