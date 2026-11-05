/**
 * Pinning tests: the research tools agent engines receive.
 *
 * A task whose criteria list tools in `uagTools` hands an agent engine the JSON
 * definitions of those tools for research. These tests record the definitions
 * the engine receives (names, descriptions, JSON schemas, order), with the
 * built-in tools and with a 1.x-style module's tool. Fixtures change only on
 * purpose (UPDATE_FIXTURES=1).
 */
import { expect } from 'chai';
import { defineEngine } from '@formio/uag-sdk';
import { requireTestLicense } from '../agent/fixtures';
import { matchesFixture } from './fixture';
import { ADMIN_KEY, contactFormWith, oneXModule, start, Started } from './harness';

describe('Pinning: research tools', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    const received: any[] = [];
    /** An agent engine that records what it is sent. */
    const recorder = defineEngine({
        type: 'engine',
        name: 'recorder',
        kinds: ['agent'],
        apiVersion: 1,
        settings: {},
        create: ({ name }) => ({
            name, kind: 'agent', model: 'recorder-1', toolUse: true,
            async extract(request: any) {
                received.push(request);
                return { model: 'recorder-1', values: { summary: 'Summarized.', name: 'Ada' } };
            }
        })
    });

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; received.length = 0; });

    async function generate(modules: any[], uagTools: string) {
        started = await start({ modules, forms: { contact: contactFormWith(uagTools) }, config: { engines: ['recorder'], engineTypes: { recorder } } });
        return started.request().post('/contact/agent/generate').set('x-admin-key', ADMIN_KEY)
            .send({ task: 'triage', data: { notes: 'Ada called about her order.' } });
    }

    async function research(modules: any[], uagTools: string) {
        const res = await generate(modules, uagTools);
        expect(res.status, res.text).to.equal(200);
        expect(received.length).to.be.greaterThan(0);
        return received.map((request) => request.tools ?? null);
    }

    it('built-in tools', async () => {
        matchesFixture('research-tools-default', await research([], 'get_forms,find_submissions'));
    });

    it('with a 1.x-style module\'s tool', async () => {
        matchesFixture('research-tools-1x-module', await research([oneXModule()], 'get_forms,find_submissions,module_lookup'));
    });

    it('a task naming a tool that does not exist, or one that may write', async () => {
        const missing = await generate([], 'get_forms,module_lookup');
        await started!.stop();
        started = undefined;
        const writes = await generate([], 'get_forms,submit_completed_form');
        matchesFixture('research-tools-refused', {
            missing: { status: missing.status, error: missing.body.error, code: missing.body.code },
            writes: { status: writes.status, error: writes.body.error, code: writes.body.code }
        });
    });
});
