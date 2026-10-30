/**
 * Agentic workflow: the storyboard in ../README.md, as a script.
 */
import { enterpriseLogin, openSettings, showCustomProperties, closeSettings, openExample, appFrame } from './common.mjs';

export default async function workflow(d, env) {
    const { site } = env;
    const page = d.page;

    // 1. The criteria live in the form, in the Enterprise form builder.
    // The portal stage connected to the UAG, so the UAG's own Run task action opens.
    await d.cut(async () => {
        await enterpriseLogin(d, env);
        await d.goto(`${env.portal}/#/project/${env.uagStage}/form/`);
        await page.getByText('College Application', { exact: true }).click();
        await page.getByText('Admissions Review (Agent)', { exact: true }).first().waitFor();
    });
    await d.caption(1, 'The admissions criteria are a content component in the form.');
    await d.hold(700);
    await d.click(page.getByText('Admissions Review (Agent)', { exact: true }).first(), { after: 1000 });
    const criteria = page.locator('text=Admissions Assessment Criteria').first();
    await d.focus([page.getByText('Admissions Review (Agent)', { exact: true }).first(), criteria]);
    await d.moveTo(criteria);
    await d.hold(1600);
    await d.focus(null);

    // 2. Custom properties make it the task's criteria.
    await d.caption(2, 'Its custom properties make it the criteria of the <code>admissions</code> task.');
    await openSettings(d, 'admissionsCriteria');
    await showCustomProperties(d);
    await d.hold(2400);
    await closeSettings(d);

    // 3. A Run task action runs the agent after the save.
    await d.caption(3, 'An “Agent: Run task” action runs the <code>admissions</code> task after each application is saved.');
    await d.click(page.locator('a, button', { hasText: /^\s*Actions\s*$/ }).first(), { after: 900 });
    await d.click(page.getByText('Agent: Run task (admissions)').first(), { after: 300 });
    const task = page.locator('.formio-component-task').first();
    await task.waitFor();
    await d.focus([task, page.locator('.formio-component-when').first()], { pad: 60 });
    await d.moveTo(task, { offset: { x: -200, y: 0 } });
    await d.hold(1800);
    await d.moveTo(page.locator('.formio-component-when').first(), { offset: { x: -150, y: 0 } });
    await d.hold(2400);

    // 4. An applicant submits.
    const app = await d.cut(() => openExample(d, site, 'workflow'));
    await d.caption(4, 'An applicant submits. Nobody reviews it by hand.');
    await d.hold(900);
    await d.click(app.locator('text=Amara Okonkwo'), { after: 1100 });
    await d.click(app.locator('button:visible', { hasText: /^Next/ }).first(), { after: 900 });
    await d.click(app.locator('button:visible', { hasText: /^Next/ }).first(), { after: 1400 });
    await d.click(app.locator('button:visible', { hasText: /^Submit/ }).first(), { after: 600 });

    // 5. The admissions agent.
    await d.caption(5, 'The admissions agent scores the application. The UAG saves its results as an update.');
    await d.hold(1500);
    await d.fastForward(() => app.locator('[data-stage="decision"].done').waitFor({ timeout: 240000 }), { label: 'Admissions agent at work · sped up' });
    await d.hold(2500);
    const frame = appFrame(d, 'workflow');

    // 6. The finance agent.
    await d.caption(6, 'That update runs the finance task’s action, and the finance agent picks the award.');
    await d.fastForward(() => app.locator('[data-finance]:not([hidden])').waitFor({ timeout: 240000 }), { label: 'Finance agent at work · sped up' });
    await d.hold(1500);
    // The award a little below the top of the app, with its rationale under it.
    const award = await frame.locator('[data-finance]').evaluate((el) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.15);
    await d.scrollFrame(frame, award, { duration: 1300 });
    await d.hold(4000);
}
