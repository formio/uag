import { expect } from 'chai';
import { startStack, getUagToken, connectMcp, formio, requireLicense, UAG_URL } from './helpers/stack.mjs';
import { api, adminHeaders, engineCalls, clearEngineCalls, createCustomer, valuesOf } from './helpers/agent.mjs';

/**
 * Layer 1: every kind of field the Agent API fills, on a support-incident form,
 * with the scripted engines. A support agent pastes what a customer wrote; the
 * UAG matches the customer record, ticks contact channels and products, places
 * the severity on a described scale, and suggests open values.
 */
describe('Layer 1: Agent API — field types on a support incident', function () {
    this.timeout(300000);

    let stack;

    before(async function () {
        requireLicense(this);
        stack = await startStack({ uagEnv: { UAG_ENGINES: 'e2e-decision,e2e-agent', E2E_RUN_TASK: 'incident:support' } });
        await createCustomer('Jane', 'Doe', 'jane@example.com');
        await createCustomer('John', 'Smith', 'john@example.com');
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    beforeEach(clearEngineCalls);

    const extract = (report, extra = {}) => api('/incident/agent/extract', { body: { data: { report, ...extra } } });

    it('runs real engines against a local project under the license', async function () {
        const { body } = await api('/agent/capabilities', { method: 'GET' });
        expect(body.edition).to.equal('enterprise');
        expect(body.formflow).to.deep.equal({ licensed: true, allowed: true, reason: 'licensed' });
        expect(body.operations.extract.available).to.equal(true);
    });

    describe('a request from a customer on file', function () {
        let result;

        before(async function () {
            await clearEngineCalls();
            result = await extract(
                'Ms. Doe emailed us: she cannot log in since the password reset. Please get back to her at 512-555-0100.',
                { accountTier: 'gold', internalNotes: 'VIP, handle with care' }
            );
            expect(result.status).to.equal(200);
        });

        it('matches the customer record by name and stores its value', function () {
            expect(result.body.fields.customer).to.include({ status: 'confident', value: 'jane@example.com', calibrated: true });
        });

        it('ticks only the select boxes the request mentions', function () {
            expect(result.body.fields.channels).to.include({ status: 'confident' });
            expect(result.body.fields.channels.value).to.deep.equal({ email: true });
        });

        it('picks every product the request is about from a multi-select', function () {
            expect(result.body.fields.products.value).to.deep.equal(['login']);
        });

        it('places severity on the described scale', function () {
            expect(result.body.fields.severity).to.include({ status: 'confident', value: 'high' });
        });

        it('answers a yes/no field from what the request asks for', function () {
            expect(result.body.fields.followUp).to.include({ status: 'confident', value: true });
        });

        it('suggests a closed-set field routed to the agent engine, without a calibrated confidence', function () {
            expect(result.body.fields.queue).to.include({ status: 'suggested', value: 'identityTeam', engine: 'e2e-agent', calibrated: false });
            expect(result.body.fields.queue).to.not.have.property('confidence');
        });

        it('suggests open values', function () {
            expect(valuesOf(result.body.fields)).to.include({ callbackNumber: '512-555-0100' });
            expect(result.body.fields.summary.value).to.equal('Ms. Doe emailed us:');
        });

        it('leaves fields inside repeating rows alone', async function () {
            expect(result.body.excluded).to.deep.include({ path: 'affected[0].user', reason: 'inside repeating rows', task: 'support' });
            expect(result.body.fields).to.not.have.property('affected[0].user');
            expect(result.body.data).to.not.have.property('affected');
        });

        it('sends engines the request and the listed context, not the internal notes', async function () {
            await extract('Ms. Doe emailed us: she cannot log in.', { accountTier: 'gold', internalNotes: 'VIP, handle with care' });
            const calls = await engineCalls();
            expect(calls.length).to.be.at.least(2);
            for (const call of calls) {
                expect(call.state.input).to.deep.equal({ 'What happened?': 'Ms. Doe emailed us: she cannot log in.' });
                expect(call.state.context).to.deep.equal({ 'Account tier': 'gold' });
                expect(call.state.instructions).to.include('Triage the support request');
            }
        });
    });

    it('reports a customer who is not on file as no match, with the name to create', async function () {
        const { body } = await extract('A new customer named Priya Natarajan called about a wrong invoice.');
        expect(body.fields.customer).to.include({ status: 'missing', noMatch: true, newRecordName: 'Priya Natarajan' });
        expect(body.fields.customer).to.not.have.property('value');
        expect(body.data).to.not.have.property('customer');
        expect(body.fields.channels.value).to.deep.equal({ phone: true });
        expect(body.fields.products.value).to.deep.equal(['billing']);
        expect(body.fields.queue.value).to.equal('billingTeam');
    });

    it('leaves the customer empty, without a no-match flag, when the request names nobody', async function () {
        const { body } = await extract('The reports page shows a typo in the footer.');
        expect(body.fields.customer.status).to.equal('missing');
        expect(body.fields.customer).to.not.have.property('noMatch');
        expect(body.fields.channels.status).to.equal('missing');
        expect(body.fields.severity).to.include({ status: 'confident', value: 'low' });
        expect(body.fields.products.value).to.deep.equal(['reports']);
    });

    it('returns the compiled decision questions over MCP for any decision model to answer', async function () {
        const mcp = await connectMcp(await getUagToken());
        try {
            const result = await mcp.callTool({ name: 'agent_decide', arguments: { form_name: 'incident', form_data: { report: 'Ms. Doe cannot log in.' } } });
            const out = result.structuredContent;
            const shapes = Object.fromEntries(out.fields.map((f) => [f.path, f.shape]));
            expect(shapes).to.include({ customer: 'resource', channels: 'multi-noul', products: 'multi-noul', severity: 'score', followUp: 'noul', queue: 'choice' });
            // The scale's levels carry their descriptions; resource options are the records on file.
            const severity = out.questions['score:severity'];
            expect(severity.levels[3]).to.equal('Critical: An outage or data loss affecting many people.');
            expect(Object.keys(out.questions['choice:customer'].options)).to.have.members(['Jane Doe', 'John Smith']);
            expect(out.mappings['choice:customer'].values['Jane Doe']).to.equal('jane@example.com');
            expect(out.state).to.not.have.property('context');
            // No model is called to build them.
            expect(await engineCalls()).to.have.lengthOf(0);
        }
        finally {
            await mcp.close().catch(() => {});
        }
    });

    it('decides a saved incident after the save, with provenance', async function () {
        const response = await fetch(`${UAG_URL}/incident/submission`, {
            method: 'POST', headers: adminHeaders,
            body: JSON.stringify({ data: { report: 'Everyone is down: a full outage since 9am. Jane Doe phoned it in.' } }),
        });
        const created = await response.json();
        expect(response.status, JSON.stringify(created)).to.equal(201);
        let stored = created;
        for (const deadline = Date.now() + 30000; !stored.data.severity && Date.now() < deadline;) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            stored = await formio.getSubmission('incident', created._id);
        }
        expect(stored.data).to.include({ severity: 'critical', customer: 'jane@example.com' });
        expect(stored.data.report).to.equal(created.data.report);
        const provenance = stored.metadata.uag.decisions.severity;
        expect(provenance).to.include({ engine: 'e2e-decision', model: 'e2e-decision-1' });
        expect(provenance.probabilities['score:severity']).to.be.an('object');
        expect(provenance.at).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('decides in-flight data without saving or calling the agent for open values', async function () {
        const before = (await formio.getSubmissions('incident')).length;
        const { body } = await api('/incident/agent/decide', { body: { data: { report: 'Jane Doe says billing is slow.' } } });
        expect(body.fields).to.not.have.property('summary');
        expect(body.fields).to.not.have.property('callbackNumber');
        expect(body.fields.products.value).to.deep.equal(['billing']);
        expect((await formio.getSubmissions('incident')).length).to.equal(before);
        // The agent engine is used only for the closed-set field routed to it.
        expect((await engineCalls('e2e-agent')).map((c) => c.fields)).to.deep.equal([['queue']]);
    });
});
