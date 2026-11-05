/**
 * Pinning tests: the UAG's form actions as a connected developer portal sees them.
 *
 * The portal (formio.js) reads a form's actions with two requests, which a
 * stage connected to the UAG sends to it:
 *
 *   GET {project}/form/{formId}/actions          Formio.availableActions(): the action list
 *   GET {project}/form/{formId}/actions/{name}   Formio.actionInfo(name):   one action's settings form
 *
 * The UAG is in proxy mode: Form.io describes its own actions, and the UAG
 * describes the ones it adds ("Agent: Run task"). These tests record both
 * answers for a portal team member and an administrator when the Form.io
 * server does not describe the form's actions. Fixtures change only on purpose
 * (UPDATE_FIXTURES=1).
 */
import { requireTestLicense } from '../agent/fixtures';
import { matchesFixture } from './fixture';
import { ADMIN_KEY, start, Started } from './harness';

describe('Pinning: UAG form actions', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; });

    const NAMES = ['agentRunTask', 'webhook', 'email', 'save', 'unknown'];

    async function describeActions(headers: Record<string, string>) {
        const formId = started!.formio.formIds.contact;
        const list = await started!.request().get(`/form/${formId}/actions`).set(headers);
        const forms: Record<string, any> = {};
        for (const name of NAMES) {
            const res = await started!.request().get(`/form/${formId}/actions/${name}`).set(headers);
            forms[name] = { status: res.status, body: res.status === 200 ? res.body : undefined };
        }
        return { list: { status: list.status, body: list.body }, forms };
    }

    it('as a portal team member and as an administrator', async () => {
        started = await start();
        matchesFixture('uag-actions', {
            portalTeamAdmin: await describeActions({ 'x-remote-token': started.member('team_admin') }),
            adminKey: await describeActions({ 'x-admin-key': ADMIN_KEY }),
            module: Object.keys((started.server as any).module.actions || {})
        });
    });
});
