import { expect } from 'chai';
import { startStack, formio, UAG_URL, requireLicense } from './helpers/stack.mjs';
import { api, stream, engineCalls, clearEngineCalls, valuesOf, adminHeaders } from './helpers/agent.mjs';

/**
 * Layer 1: the FNOL wizard, the way the example uses it, against the scripted
 * engines (no model credentials). A policyholder describes a loss; triage is
 * decided, open values are suggested, the wizard's pages follow from triage,
 * and the claim is re-decided on the server when it is saved. Each test is one
 * kind of description and checks what the UAG made of it.
 */
describe('Layer 1: Agent API — FNOL wizard journeys', function () {
    this.timeout(300000);

    let stack;

    before(async function () {
        requireLicense(this);
        stack = await startStack({ uagEnv: { UAG_ENGINES: 'e2e-decision,e2e-agent' } });
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    beforeEach(clearEngineCalls);

    const extract = (data, extra = {}) => api('/claim/agent/extract', { body: { data, ...extra } });

    describe('a collision with an injury and another driver', function () {
        const lossDescription = 'Yesterday my 2019 Honda Civic was rear-ended on I-35 by the other driver, Sam Carter. My passenger, Maria Lopez, hurt her neck.';
        let first;

        before(async function () {
            await clearEngineCalls();
            first = await stream('/claim/agent/extract', { data: { policyNumber: 'P-1001', lossDescription } });
        });

        it('streams the triage decisions before the merged result', function () {
            expect(first.status).to.equal(200);
            const kinds = first.events.map((e) => `${e.event}:${e.data.kind || ''}`);
            expect(kinds.at(-1)).to.equal('done:');
            expect(kinds.indexOf('result:decision')).to.be.within(0, kinds.length - 2);
        });

        it('decides the claim type, injury and third party with calibrated confidence', function () {
            const { fields, data } = first.events.at(-1).data;
            expect(fields['triage.claimType']).to.include({ status: 'confident', value: 'autoCollision', engine: 'e2e-decision', calibrated: true });
            expect(fields['triage.injuryInvolved']).to.include({ status: 'confident', value: true });
            expect(fields['triage.thirdPartyInvolved']).to.include({ status: 'confident', value: true });
            // The decision's confidence is written where the form's logic can read it.
            expect(data.triage.claimTypeConfidence).to.equal(fields['triage.claimType'].confidence).and.to.be.at.least(0.6);
        });

        it('leaves fraud signals empty when the description gives no evidence', function () {
            const { fields, data } = first.events.at(-1).data;
            expect(fields['triage.fraudSignals'].status).to.equal('missing');
            expect(data.triage).to.not.have.property('fraudSignals');
        });

        it('suggests the open values on the pages that are already showing', function () {
            const { fields } = first.events.at(-1).data;
            const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            expect(fields.lossDate).to.include({ status: 'suggested', engine: 'e2e-agent', calibrated: false });
            expect(fields.lossDate.value).to.equal(yesterday);
            expect(fields.lossLocation).to.include({ status: 'suggested', value: 'I-35' });
        });

        it('does not fill pages the form is hiding until triage shows them', function () {
            const { excluded } = first.events.at(-1).data;
            const hidden = excluded.filter((e) => e.reason.includes('hidden')).map((e) => e.path);
            expect(hidden).to.include.members(['vehicle', 'injuredName', 'otherPartyName']);
        });

        it('fills the newly shown pages on the next step, and keeps what the user changed', async function () {
            const previous = first.events.at(-1).data.data;
            await clearEngineCalls();
            // The user corrected the location before moving on.
            const second = await extract({ ...previous, lossLocation: 'Interstate 35 northbound' });
            expect(second.status).to.equal(200);
            expect(valuesOf(second.body.fields)).to.include({ vehicle: '2019 Honda Civic', injuredName: 'Maria Lopez', otherPartyName: 'Sam Carter' });
            expect(second.body.data.lossLocation).to.equal('Interstate 35 northbound');
            expect(second.body.excluded).to.deep.include({ path: 'lossLocation', reason: 'already has a value', task: 'triage' });
            // Confident triage hides the Confirm page that holds it, so triage is not decided
            // again; only the closed questions on the newly shown pages are.
            const asked = (await engineCalls('e2e-decision')).flatMap((call) => call.questions);
            expect(asked.filter((id) => id.includes('triage.'))).to.deep.equal([]);
            expect(asked).to.include.members(['affirm:damageAreas:rear', 'choice:drivable']);
            expect(second.body.excluded).to.deep.include({ path: 'triage.fraudSignals', reason: 'hidden by the form\'s conditionals', task: 'triage' });
        });

        it('sends the engines only the description and the listed context', async function () {
            await extract({ policyNumber: 'P-1001', lossDescription, lossLocation: 'typed by the user', vehicleDamage: 'private detail' });
            for (const call of [...await engineCalls('e2e-decision'), ...await engineCalls('e2e-agent')]) {
                expect(Object.keys(call.state.input)).to.deep.equal(['Tell us what happened']);
                expect(call.state.context).to.deep.equal({ 'Policy number': 'P-1001' });
                expect(JSON.stringify(call.state)).to.not.include('private detail');
                expect(call.state.today).to.match(/\(\d{4}-\d{2}-\d{2}\)$/);
            }
        });
    });

    it('records "nobody was hurt" as no injury, and an unmentioned third party as unknown', async function () {
        const { status, body } = await extract({ lossDescription: 'My car was stolen from my driveway overnight. Nobody was hurt.' });
        expect(status).to.equal(200);
        expect(body.fields['triage.claimType']).to.include({ status: 'confident', value: 'theft' });
        expect(body.fields['triage.injuryInvolved']).to.include({ status: 'confident', value: false });
        expect(body.data.triage.injuryInvolved).to.equal(false);
        expect(body.fields['triage.thirdPartyInvolved'].status).to.equal('missing');
        expect(body.fields['triage.thirdPartyInvolved'].reason).to.include('not mentioned');
        expect(body.data.triage).to.not.have.property('thirdPartyInvolved');
    });

    it('marks a hedged description uncertain, below the field\'s own threshold, so the Confirm page shows', async function () {
        const { body } = await extract({ lossDescription: 'I think someone hit my car while it was parked.' });
        const claimType = body.fields['triage.claimType'];
        expect(claimType).to.include({ status: 'uncertain', value: 'autoCollision' });
        // uagThreshold is 0.6 on this field; the Confirm page shows below it.
        expect(claimType.confidence).to.be.below(0.6);
        expect(body.data.triage.claimTypeConfidence).to.be.below(0.6);
        expect(claimType.alternatives).to.be.an('array').that.is.not.empty;
    });

    it('marks the claim type uncertain, with the other type as an alternative, when the description fits two', async function () {
        const { body } = await extract({ lossDescription: 'A rock left cracked glass across my windshield, and then my car was stolen.' });
        const claimType = body.fields['triage.claimType'];
        expect(claimType.status).to.equal('uncertain');
        expect(claimType.reason).to.include('reversed');
        expect(claimType.alternatives.map((a) => a.value)).to.include('theft');
    });

    it('accepts weak fraud evidence on the field with a wide uncertainty band', async function () {
        const { body } = await extract({ lossDescription: 'My car was stolen. I paid cash for it and there is no receipt.' });
        // uagUncertainBand 0.1-0.5 on fraudSignals: a 60% "yes" is enough to flag it.
        expect(body.fields['triage.fraudSignals']).to.include({ status: 'confident', value: true });
    });

    it('leaves a value the client already has unless asked to overwrite it', async function () {
        // On the Confirm page (low confidence), with a type the user picked.
        const data = { lossDescription: 'A rock cracked my windshield on the highway.', triage: { claimType: 'theft', claimTypeConfidence: 0.3 } };
        const kept = await extract(data);
        expect(kept.body.data.triage.claimType).to.equal('theft');
        expect(kept.body.excluded).to.deep.include({ path: 'triage.claimType', reason: 'already has a value', task: 'triage' });
        const replaced = await extract(data, { overwrite: true });
        expect(replaced.body.data.triage.claimType).to.equal('autoGlass');
    });

    it('refuses an extraction for a task the form does not have', async function () {
        const { status, body } = await api('/claim/agent/extract', { body: { task: 'nobody', data: {} } });
        expect(status).to.equal(400);
        expect(body.error).to.include('nobody');
    });

    describe('saving a claim through the UAG', function () {
        const base = {
            policyNumber: 'P-2002',
            lossDate: '2026-10-19',
            lossLocation: 'Main Street',
            policeReportNumber: 'APD-77',
            contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true,
        };

        async function save(data) {
            const resp = await fetch(`${UAG_URL}/claim/submission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
            });
            const body = await resp.json();
            expect(resp.status, JSON.stringify(body)).to.equal(201);
            return formio.getSubmission('claim', body._id);
        }

        it('re-decides triage on the server, so a tampered browser value is not stored', async function () {
            const stored = await save({
                ...base,
                lossDescription: 'My car was stolen. I paid cash for it and there is no receipt.',
                // What a tampered browser might send.
                triage: { claimType: 'theft', fraudSignals: false },
            });
            expect(stored.data.triage.claimType).to.equal('theft');
            expect(stored.data.triage.fraudSignals).to.equal(true);
            expect(stored.metadata.uag.decisions['triage.fraudSignals']).to.include({ source: 'server', engine: 'e2e-decision', status: 'confident' });
        });

        it('refuses the save when the server\'s decision makes a page apply that the browser skipped', async function () {
            const resp = await fetch(`${UAG_URL}/claim/submission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // A glass-only claim needs no police report, so the browser sends none.
                body: JSON.stringify({ data: { ...base, policeReportNumber: undefined, lossDescription: 'My car was stolen from the street.', triage: { claimType: 'autoGlass' } } }),
            });
            const body = await resp.json();
            expect(resp.status).to.equal(400);
            expect(body.details.map((d) => d.context?.key)).to.include('policeReportNumber');
        });

        it('clears an authoritative value the server cannot confirm, so a person decides it', async function () {
            const stored = await save({
                ...base,
                lossDescription: 'My car was stolen from the street.',
                triage: { claimType: 'theft', fraudSignals: true },
            });
            expect(stored.data.triage).to.not.have.property('fraudSignals');
            expect(stored.metadata.uag.decisions['triage.fraudSignals'].source).to.equal('cleared');
        });

        it('keeps a value the user confirmed when the server is unsure', async function () {
            const stored = await save({
                ...base,
                lossDescription: 'I think someone hit my car while it was parked.',
                triage: { claimType: 'autoCollision', claimTypeConfidence: 0.47 },
            });
            expect(stored.data.triage.claimType).to.equal('autoCollision');
            expect(stored.metadata.uag.decisions['triage.claimType']).to.include({ source: 'client', status: 'uncertain' });
        });
    });

    describe('updating a claim through the UAG', function () {
        const base = {
            policyNumber: 'P-3003',
            lossDate: '2026-10-19',
            lossLocation: 'Main Street',
            policeReportNumber: 'APD-88',
            contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true,
        };

        /** Create a claim through the UAG, then update it through the UAG with `changes`. */
        async function saveThenUpdate(data, changes) {
            const created = await fetch(`${UAG_URL}/claim/submission`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data }),
            });
            const first = await created.json();
            expect(created.status, JSON.stringify(first)).to.equal(201);
            const stored = await formio.getSubmission('claim', first._id);
            const updated = await fetch(`${UAG_URL}/claim/submission/${first._id}`, {
                method: 'PUT',
                headers: adminHeaders,
                body: JSON.stringify({ data: { ...stored.data, ...changes, triage: { ...stored.data.triage, ...changes.triage } } }),
            });
            expect(updated.status, await updated.clone().text()).to.equal(200);
            return { first: stored, stored: await formio.getSubmission('claim', first._id) };
        }

        it('re-decides triage on the update, so a tampered value is not stored', async function () {
            const { stored } = await saveThenUpdate({
                ...base,
                lossDescription: 'My car was stolen. I paid cash for it and there is no receipt.',
                // As the wizard sends it: triage decided in the browser, so the theft pages apply.
                triage: { claimType: 'theft' },
            }, { triage: { fraudSignals: false } });
            expect(stored.data.triage.fraudSignals).to.equal(true);
            expect(stored.metadata.uag.decisions['triage.fraudSignals']).to.include({ engine: 'e2e-decision', model: 'e2e-decision-1', source: 'server' });
        });

        it('clears a tampered authoritative value the server cannot confirm', async function () {
            const { stored } = await saveThenUpdate({
                ...base,
                lossDescription: 'My car was stolen from the street.',
                // A low confidence keeps the Confirm page, and so the field, in the saved data.
                triage: { claimType: 'theft', claimTypeConfidence: 0.3 },
            }, { triage: { fraudSignals: true } });
            expect(stored.data.triage).to.not.have.property('fraudSignals');
        });

        it('keeps a value the user confirmed when the server is unsure', async function () {
            const { stored } = await saveThenUpdate({
                ...base,
                // Fits glass and theft; the user confirmed theft on the Confirm page.
                lossDescription: 'A rock left cracked glass across my windshield, and then my car was stolen.',
                triage: { claimType: 'theft', claimTypeConfidence: 0.33 },
            }, { triage: { claimType: 'theft', claimTypeConfidence: 0.33 } });
            expect(stored.data.triage.claimType).to.equal('theft');
        });

        it('runs no task for a claim saved straight to Form.io', async function () {
            const created = await formio.createSubmission('claim', {
                ...base,
                lossDescription: 'My car was stolen. I paid cash for it and there is no receipt.',
                triage: { claimType: 'theft', fraudSignals: false },
            });
            const stored = await formio.getSubmission('claim', created._id);
            expect(stored.data.triage.fraudSignals).to.equal(false);
            expect(stored.metadata?.uag).to.equal(undefined);
        });
    });
});
