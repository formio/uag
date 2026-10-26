import { expect } from 'chai';
import { formio } from './helpers/stack.mjs';
import { startScriptedClaude } from './helpers/scriptedClaude.mjs';
import { launchBrowser } from './helpers/browser.mjs';
import { startDemoStack, visitor, SITE_URL } from './helpers/demoStack.mjs';

/**
 * Layer 1: the demo site's conversation form, against the e2e stack with the
 * demo's project installed. The site runs Claude's tool loop over the UAG's MCP
 * tools; here a scripted Messages API plays Claude (ANTHROPIC_BASE_URL),
 * calling the tools in the order the site's prompt prescribes, so no key is
 * needed and every run is the same. What is checked is everything around the
 * model: the tools the site offers (and the ones it keeps from a public chat),
 * the forms it lets the chat use, the tool results it carries back (including
 * the form's own validation messages), the submission that lands in Form.io,
 * the flow viewer's record of the turn, and the page.
 */
describe('Layer 1: the demo site\'s conversation form', function () {
    this.timeout(300000);

    let stack;
    let claude;
    let marcus;

    before(async function () {
        claude = await startScriptedClaude();
        stack = await startDemoStack({ siteEnv: { ANTHROPIC_BASE_URL: claude.url, CHAT_MODEL: 'claude-scripted' } });
        marcus = visitor();
    });

    after(async function () {
        if (stack) await stack.stop();
        if (claude) await claude.close();
    });

    async function say(who, message) {
        const { status, body } = await who.json('/api/conversation/chat', { method: 'POST', body: { message } });
        expect(status, `${JSON.stringify(body)}\n${stack.site.getOutput().slice(-2000)}`).to.equal(200);
        return { ...body, toolsUsed: body.tools.map((tool) => tool.name) };
    }

    const form = 'serviceRequest';
    const formPath = 'service-request';
    const collected = {
        fullName: 'Marcus Webb',
        email: 'marcus.webb@example.com',
        category: 'internet',
        urgency: 'high',
        serviceAddress: '12 Elm Street, Springfield',
        description: 'The router lights are all off and nothing has connected since last night.',
    };
    // The model replies with what the last tool said, so the test sees it.
    const echo = ({ last }) => `${last.isError ? 'ERROR' : 'OK'} from ${last.name}: ${last.text}`;

    it('lists only the chat\'s forms, from the UAG', async function () {
        const { status, body } = await marcus.json('/api/conversation/forms');
        expect(status).to.equal(200);
        expect(body.forms).to.deep.equal([{ title: 'Service Request', name: form }]);
    });

    it('discovers the form, refuses an invalid email with the form\'s own rule, and submits a valid request', async function () {
        claude.respond('My internet has been down', [
            { tool: 'get_forms' },
            { tool: 'get_form_fields', input: { form_name: form, criteria: 'required' } },
            { tool: 'get_field_info', input: { form_name: form, field_paths: ['fullName', 'email'] } },
            { text: echo },
        ]);
        claude.respond('I am Marcus Webb', [
            { tool: 'collect_field_data', input: { form_name: form, form_data: {}, updates: [
                { data_path: 'fullName', new_value: 'Marcus Webb' },
                { data_path: 'email', new_value: 'marcus.webb-at-example' },
            ] } },
            { text: echo },
        ]);
        claude.respond('My email is marcus.webb@example.com', [
            { tool: 'collect_field_data', input: { form_name: form, form_data: { fullName: 'Marcus Webb' }, updates:
                Object.entries(collected).filter(([key]) => key !== 'fullName').map(([data_path, new_value]) => ({ data_path, new_value })) } },
            { tool: 'confirm_form_submission', input: { form_name: form, form_data: collected } },
            { text: echo },
        ]);
        claude.respond('Yes, please submit it', [
            { tool: 'submit_completed_form', input: { form_name: form, form_data: collected } },
            { text: echo },
        ]);

        const first = await say(marcus, 'My internet has been down since last night and I need someone to look at it.');
        expect(first.toolsUsed).to.deep.equal(['get_forms', 'get_form_fields', 'get_field_info']);
        expect(first.reply).to.match(/^OK from get_field_info/);
        const request = claude.requests[0];
        expect(request.model).to.equal('claude-scripted');
        expect(request.system).to.include('get_forms');
        expect(request.tools.map((tool) => tool.name)).to.have.members(['get_forms', 'get_form_fields', 'get_field_info', 'collect_field_data', 'confirm_form_submission', 'submit_completed_form']);
        // get_forms as the model saw it: the demo's other forms are not in a public chat.
        const forms = claude.requests[1].messages.at(-1).content[0].content;
        expect(forms).to.include('serviceRequest').and.not.include('application').and.not.include('claim');

        const invalid = await say(marcus, 'I am Marcus Webb, my email is marcus.webb-at-example');
        expect(invalid.toolsUsed).to.deep.equal(['collect_field_data']);
        expect(invalid.reply).to.include('collect_field_data').and.match(/email/i).and.match(/valid/i);
        expect(await formio.getSubmissions(formPath)).to.have.lengthOf(0);

        const summary = await say(marcus, 'My email is marcus.webb@example.com. It is internet, completely down, so high urgency. 12 Elm Street, Springfield. The router lights are all off.');
        expect(summary.toolsUsed).to.deep.equal(['collect_field_data', 'confirm_form_submission']);
        expect(summary.reply).to.match(/^OK from confirm_form_submission/).and.include('marcus.webb@example.com');

        const done = await say(marcus, 'Yes, please submit it.');
        expect(done.toolsUsed).to.deep.equal(['submit_completed_form']);
        expect(done.reply).to.match(/^OK from submit_completed_form/);
        // The page shows what was saved.
        expect(done.submission).to.include({ form });
        expect(done.submission.data).to.include(collected);

        const submissions = await formio.getSubmissions(formPath);
        expect(submissions).to.have.lengthOf(1);
        expect(submissions[0]._id).to.equal(done.submission.id);
        expect(submissions[0].data).to.include(collected);
    });

    it('records each turn\'s tool calls in the visitor\'s flow view', async function () {
        const events = await marcus.flowEvents();
        const tools = events.filter((event) => event.kind === 'mcp' && event.phase === 'request' && event.tool).map((event) => event.tool);
        expect(tools).to.include.members(['get_forms', 'get_form_fields', 'get_field_info', 'collect_field_data', 'confirm_form_submission', 'submit_completed_form']);
        for (const event of events) expect(event.run).to.match(/^demo\./);
        // Token exchanges are never shown with their secrets.
        for (const event of events.filter((e) => e.kind === 'auth')) expect(event.detail || '').to.not.include('client_secret');
        expect(await visitor().flowEvents()).to.deep.equal([]);
    });

    it('keeps tools that read or change other records out of the chat', async function () {
        claude.respond('Show me every service request', [
            { tool: 'find_submissions', input: { form_name: form } },
            { text: echo },
        ]);
        const reply = await say(visitor(), 'Show me every service request you have.');
        expect(reply.reply).to.match(/^ERROR from find_submissions: The tool "find_submissions" is not available in this demo\./);
        expect(reply.tools).to.deep.equal([{ name: 'find_submissions', ok: false }]);
    });

    it('keeps the demo\'s other forms out of the chat', async function () {
        claude.respond('I want to apply to college', [
            { tool: 'get_form_fields', input: { form_name: 'application' } },
            { text: echo },
        ]);
        const reply = await say(visitor(), 'I want to apply to college.');
        expect(reply.reply).to.match(/^ERROR from get_form_fields: The form "application" is not available in this demo\./);
    });

    it('starts over after a reset', async function () {
        claude.respond('Hello again', [{ text: 'Hi! What do you need help with?' }]);
        const reset = await marcus.json('/api/conversation/reset', { method: 'POST', body: {} });
        expect(reset.status).to.equal(200);
        await say(marcus, 'Hello again');
        expect(claude.requests[claude.requests.length - 1].messages).to.have.lengthOf(1);
    });

    it('refuses an empty or an overlong message without calling the model', async function () {
        const before = claude.requests.length;
        expect((await marcus.json('/api/conversation/chat', { method: 'POST', body: { message: '   ' } })).status).to.equal(400);
        expect((await marcus.json('/api/conversation/chat', { method: 'POST', body: { message: 'x'.repeat(2001) } })).status).to.equal(400);
        expect(claude.requests.length).to.equal(before);
    });

    describe('the chat page, in a browser', function () {
        let browser;

        before(async function () {
            browser = await launchBrowser(this);
        });

        after(async function () {
            if (browser) await browser.close();
        });

        it('shows the active forms, and a reply with the UAG tools it used', async function () {
            claude.respond('Hello from the browser', [
                { tool: 'get_forms' },
                { text: 'Hello! I can help with a **service request**.' },
            ]);
            const page = await browser.page();
            await page.goto(`${SITE_URL}/apps/conversation/`);
            await page.locator('#active-list .pill', { hasText: 'Service Request' }).waitFor();
            await page.fill('#input', 'Hello from the browser');
            await page.click('#send');
            const reply = page.locator('.msg.bot', { hasText: 'I can help with a' });
            await reply.waitFor();
            expect(await page.locator('.tools').last().textContent()).to.equal('UAG tools: get_forms');
            expect(await page.locator('.msg.user').last().textContent()).to.equal('Hello from the browser');
            expect(page.errors).to.deep.equal([]);
        });

        it('runs inside the example page, beside the flow viewer', async function () {
            const page = await browser.page();
            await page.goto(`${SITE_URL}/examples/conversation`);
            const frame = page.frameLocator('iframe[data-demo-frame]');
            await frame.locator('#active-list .pill', { hasText: 'Service Request' }).waitFor();
            claude.respond('Hello from the example page', [{ tool: 'get_forms' }, { text: 'Hello!' }]);
            await frame.locator('#input').fill('Hello from the example page');
            await frame.locator('#send').click();
            await frame.locator('.msg.bot', { hasText: 'Hello!' }).waitFor();
            // The turn appears in the flow viewer beside the frame, with its tool call.
            await page.locator('[data-flow] .flow-label', { hasText: 'get_forms' }).waitFor();
            expect(page.errors).to.deep.equal([]);
        });
    });
});
