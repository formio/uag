/**
 * Conversation forms: the storyboard in ../README.md, as a script.
 */
import { portalLogin, portalForm, portalPanel, openExample } from './common.mjs';

const DETAILS = "I'm Dana Whitfield, dana.whitfield@example.com, 1420 Maple Street, Dallas TX. It's completely down and afternoons are best for a call.";

export default async function conversation(d, { site, portal }) {
    const page = d.page;

    // 1-2. The form in the Open Source portal.
    await d.cut(() => portalLogin(d, portal));
    await d.caption(1, 'A Form.io form, tagged <code>uag</code>. Its fields are the whole script.');
    await d.focus([page.locator('.item-wrap.form').first(), page.locator('.item-wrap.form').last()], { pad: 60 });
    await d.hold(1200);
    await d.click(portalForm(d, 'Service Request').locator('a.edit'), { after: 300 });
    await d.focus(null);
    await d.hold(700);
    await d.moveTo(page.locator('text=Tags').first(), { offset: { x: 30, y: 38 } });
    await d.hold(1400);
    await d.scrollElement(portalPanel(d), { y: 330, duration: 1200 });
    await d.moveTo(page.locator('text=High — completely down').first());
    await d.hold(1000);
    await d.scrollElement(portalPanel(d), { by: 600, duration: 1400 });
    await d.hold(1400);

    // 3. A person describes the problem.
    const app = await d.cut(() => openExample(d, site, 'conversation'));
    const bot = app.locator('.uag-chat__message--assistant:not(.uag-chat__typing)');
    const reply = async (count) => {
        await d.fastForward(() => bot.nth(count).waitFor({ timeout: 180000 }), { label: 'The UAG\'s chat at work · sped up' });
        return bot.nth(count).innerText();
    };
    await d.caption(2, 'A person describes the problem. The UAG\'s chat reads the form: its fields, rules and options.');
    await d.hold(1200);
    let count = await bot.count();
    await d.click(app.locator('.uag-chat__suggestion', { hasText: 'internet' }));
    await reply(count);
    await d.hold(2200);

    // 4. One sentence, several fields.
    await d.caption(3, 'One sentence fills several fields, mapped onto the form’s own options.');
    count = await bot.count();
    await d.type(app.locator('[ref="uagChatInput"]'), DETAILS, { delay: 20 });
    await d.click(app.locator('[ref="uagChatSend"]'));
    await reply(count);
    // The model may ask one more question before the summary appears.
    const summary = app.locator('[ref="uagChatSubmit"]');
    for (let i = 0; i < 3 && !(await summary.count()); i++) {
        count = await bot.count();
        await d.type(app.locator('[ref="uagChatInput"]'), 'The router shows a red light. That is everything.', { delay: 20 });
        await d.click(app.locator('[ref="uagChatSend"]'));
        await reply(count);
    }
    await d.hold(3800);

    // 5. Submitted.
    await d.caption(4, 'The person checks the summary and submits. The form saves itself through the UAG.');
    await d.click(summary);
    await d.fastForward(() => app.locator('text=Saved in Form.io').waitFor({ timeout: 180000 }), { label: 'Submitting · sped up' });
    await d.hold(3500);

    // 6. The submission in Form.io.
    await d.cut(async () => {
        await portalLogin(d, portal);
        await portalForm(d, 'Service Request').locator('a.edit').click();
        await page.locator('text=View Data').first().click();
        await page.locator('text=Dana Whitfield').first().waitFor();
    });
    await d.caption(5, 'An ordinary Form.io submission, validated by the form, saved with the user’s permissions.');
    await d.moveTo(page.locator('text=Dana Whitfield').first());
    await d.hold(3500);
}
