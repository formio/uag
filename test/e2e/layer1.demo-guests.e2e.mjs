import { expect } from 'chai';
import { ADMIN_KEY, FORMIO_URL, UAG_URL } from './helpers/stack.mjs';
import { startDemoStack, guest } from './helpers/demoStack.mjs';
import { PROFILES } from '../../demo/module/applicants.mjs';

/**
 * Layer 1: the demo's guests, the only users of its project. The site signs
 * each visitor in as a guest when they start a demo, with a plain Form.io
 * register form (guest/register: Save to the guest resource, Role Assignment,
 * Login), then calls the UAG with the guest's token. Nothing about guests is in
 * the UAG: this checks the project template does what the site relies on, on
 * Form.io Open Source with the demo's template installed by the UAG.
 */
describe('Layer 1: the demo site\'s guests', function () {
    this.timeout(300000);

    let stack;
    const admin = { 'x-admin-key': ADMIN_KEY };

    before(async function () {
        stack = await startDemoStack();
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    async function formioJson(pathname, { method = 'GET', headers = {}, body } = {}) {
        const response = await fetch(`${FORMIO_URL}${pathname}`, {
            method,
            headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await response.text();
        let json = text;
        try { json = JSON.parse(text); } catch { /* text */ }
        return { status: response.status, body: json };
    }

    it('registers a guest with the guest role, and answers with its token', async function () {
        const visitor = await guest();
        const roles = (await formioJson('/role', { headers: admin })).body;
        const guestRole = roles.find((role) => role.machineName === 'guest' || role.title?.toLowerCase() === 'guest');
        expect(guestRole, JSON.stringify(roles.map((role) => role.title))).to.exist;
        const current = await formioJson('/current', { headers: { 'x-jwt-token': visitor.token } });
        expect(current.status, JSON.stringify(current.body)).to.equal(200);
        expect(current.body._id).to.equal(visitor.user._id);
        expect(current.body.roles).to.include(guestRole._id);
        // The password is stored hashed, and never answered.
        expect(JSON.stringify(visitor.user)).to.not.include('password');
    });

    it('refuses a guest made without the register form', async function () {
        const created = await formioJson('/guest/submission', { method: 'POST', body: { data: { email: 'direct@guest.invalid', password: 'Passw0rd!x' } } });
        expect(created.status).to.be.oneOf([401, 403]);
    });

    it('keeps the guests themselves from guests', async function () {
        const visitor = await guest();
        const listed = await formioJson('/guest/submission', { headers: { 'x-jwt-token': visitor.token } });
        expect(listed.status).to.be.oneOf([401, 403]);
    });

    it('refuses anonymous callers at the UAG: no demo form opens to visitors who are not signed in', async function () {
        const forms = (await formioJson('/form?limit=100&select=name,_id', { headers: admin })).body;
        for (const name of ['serviceRequest', 'claim', 'leaseReview']) {
            const form = forms.find((candidate) => candidate.name === name);
            const operation = name === 'serviceRequest' ? 'chat' : 'extract';
            const response = await fetch(`${UAG_URL}/form/${form._id}/agent/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(operation === 'chat' ? { messages: [{ role: 'user', content: 'hello' }] } : { data: {} }),
            });
            expect(response.status, name).to.equal(401);
        }
    });

    it('lets a guest read back its own submissions only', async function () {
        const owner = await guest();
        const stranger = await guest();
        const saved = await owner.json('/application/submission', { method: 'POST', body: { data: PROFILES.average } });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(201);
        expect((await owner.json(`/application/submission/${saved.body._id}`)).status).to.equal(200);
        expect((await stranger.json(`/application/submission/${saved.body._id}`)).status).to.be.oneOf([401, 403, 404]);
        const listed = await stranger.json('/application/submission');
        expect(listed.status).to.be.oneOf([200, 206]);
        expect(listed.body.map((submission) => submission._id)).to.not.include(saved.body._id);
    });

    it('lets a guest save the chat\'s form, and read none of them back', async function () {
        const visitor = await guest();
        const saved = await visitor.json('/service-request/submission', {
            method: 'POST',
            body: { data: { fullName: 'Ada Lovelace', email: 'ada@example.com', category: 'billing', urgency: 'low', serviceAddress: '1 Analytical Way', description: 'A question about my bill.' } },
        });
        expect(saved.status, JSON.stringify(saved.body)).to.equal(201);
        expect((await visitor.json(`/service-request/submission/${saved.body._id}`)).status).to.be.oneOf([401, 403, 404]);
    });
});
