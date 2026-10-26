import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { startStack, getUagToken, connectMcp, formio, ADMIN_KEY, JWT_SECRET, UAG_URL, FORMIO_URL, requireLicense } from './helpers/stack.mjs';

/**
 * Layer 1: the Agent API against a real UAG + Form.io OSS stack, with the stub
 * engines, so no model credentials are needed. Drives the FNOL wizard's claim
 * form through extraction, decisions, provide's reconciled save, authentication
 * modes and scoped MCP tokens, verifying results against the Form.io REST API.
 */
describe('Layer 1: Agent API', function () {
    this.timeout(300000);

    let stack;
    const admin = { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };
    const description = { policyNumber: 'P-4471', lossDescription: 'Someone rear-ended me on I-35 yesterday and my neck hurts.' };

    function events(text) {
        return text.trim().split('\n\n').map((block) => ({
            event: /event: (.*)/.exec(block)?.[1],
            data: JSON.parse(/data: (.*)/.exec(block)?.[1] || 'null'),
        }));
    }

    before(async function () {
        requireLicense(this);
        stack = await startStack({ uagEnv: { UAG_ENGINES: 'stub-decision,stub-agent' } });
        // The claim form comes from the e2e template; wait for it to be imported.
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            const resp = await fetch(`${FORMIO_URL}/form?limit=100&select=name`, { headers: { 'x-admin-key': ADMIN_KEY } });
            if ((await resp.json()).some((f) => f.name === 'claim')) break;
            await new Promise((r) => setTimeout(r, 1000));
        }
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    it('reports the enabled engines', async function () {
        const resp = await fetch(`${UAG_URL}/agent/capabilities`, { headers: admin });
        expect(resp.status).to.equal(200);
        const body = await resp.json();
        expect(body.engines.map((e) => e.name)).to.deep.equal(['stub-decision', 'stub-agent']);
        expect(body.operations.extract.available).to.equal(true);
        expect(Object.keys(body.operations)).to.have.members(['extract', 'decide', 'generate', 'provide']);
    });

    it('refuses requests without credentials, and admin keys from a browser', async function () {
        expect((await fetch(`${UAG_URL}/agent/capabilities`)).status).to.equal(401);
        const fromBrowser = await fetch(`${UAG_URL}/agent/capabilities`, { headers: { ...admin, Origin: 'https://app.example.com' } });
        expect(fromBrowser.status).to.equal(401);
    });

    it('extracts with a bearer token and streams decisions before the merged result', async function () {
        const token = await getUagToken();
        const resp = await fetch(`${UAG_URL}/agent/extract`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify({ form: 'claim', data: description }),
        });
        expect(resp.status).to.equal(200);
        expect(resp.headers.get('content-type')).to.include('text/event-stream');
        const list = events(await resp.text());
        const names = list.map((e) => `${e.event}:${e.data.kind || ''}`);
        expect(names.at(-1)).to.equal('done:');
        expect(names).to.include('result:decision');
        const done = list.at(-1).data;
        expect(done.tasks).to.deep.equal(['triage']);
        // Stub decisions are deterministic: the alphabetically first option, confidently.
        expect(done.fields['triage.claimType']).to.include({ status: 'confident', engine: 'stub-decision', calibrated: true, value: 'autoCollision' });
        expect(done.data.triage.claimTypeConfidence).to.be.a('number');
        // Pages hidden by the form's conditionals are not filled.
        expect(done.excluded.map((e) => e.path)).to.include('injuredName');
    });

    it('decides against in-flight data without saving anything', async function () {
        const before = (await formio.getSubmissions('claim')).length;
        const resp = await fetch(`${UAG_URL}/agent/decide`, { method: 'POST', headers: admin, body: JSON.stringify({ form: 'claim', data: description }) });
        const body = await resp.json();
        expect(resp.status).to.equal(200);
        expect(Object.keys(body.fields)).to.include('triage.injuryInvolved');
        expect(Object.keys(body.fields)).to.not.include('lossDate');
        expect((await formio.getSubmissions('claim')).length).to.equal(before);
    });

    it('provides decisions and provenance to a saved submission', async function () {
        // Form.io requires the triage, loss and contact fields; the stored values are then re-decided.
        const created = await formio.createSubmission('claim', {
            ...description,
            contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true,
            lossDate: '2026-10-19',
            lossLocation: 'I-35',
            policeReportNumber: 'APD-2026-1019',
            triage: { claimType: 'theft' }
        });
        const resp = await fetch(`${UAG_URL}/agent/provide`, {
            method: 'POST', headers: admin,
            body: JSON.stringify({ form: 'claim', task: 'triage', submissionId: created._id }),
        });
        expect(resp.status).to.equal(200);
        const stored = await formio.getSubmission('claim', created._id);
        // The saved 'theft' is replaced by the confident (stub) decision.
        expect(stored.data.triage.claimType).to.equal('autoCollision');
        expect(stored.metadata.uag.decisions['triage.claimType']).to.include({ engine: 'stub-decision', model: 'stub-decision-1' });
    });

    it('reports, and does not save, decisions that would leave the submission invalid', async function () {
        // Glass only, no injury: no police report needed when saved.
        const created = await formio.createSubmission('claim', {
            ...description, lossDate: '2026-10-19', lossLocation: 'I-35', contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true, triage: { claimType: 'autoGlass' }
        });
        // The stub decides an injury, which makes the police report required.
        const resp = await fetch(`${UAG_URL}/agent/provide`, {
            method: 'POST', headers: admin,
            body: JSON.stringify({ form: 'claim', task: 'triage', submissionId: created._id }),
        });
        expect(resp.status).to.equal(422);
        expect((await resp.json()).details.map((d) => d.path)).to.include('policeReportNumber');
        const stored = await formio.getSubmission('claim', created._id);
        expect(stored.data.triage.claimType).to.equal('autoGlass');
    });

    it('exposes agent_decide over MCP without calling a model', async function () {
        const mcp = await connectMcp(await getUagToken());
        try {
            const result = await mcp.callTool({ name: 'agent_decide', arguments: { form_name: 'claim', task: 'triage', form_data: description } });
            const out = result.structuredContent;
            expect(out.task).to.equal('triage');
            expect(Object.keys(out.questions)).to.include.members(['choice:triage.claimType', 'mention:triage.claimType', 'affirm:triage.injuryInvolved', 'deny:triage.injuryInvolved']);
        }
        finally {
            await mcp.close().catch(() => {});
        }
    });

    it('limits /mcp to a scoped token\'s read-only tools, even if it names a write tool', async function () {
        const scoped = jwt.sign({ typ: 'uag-scoped', admin: true, tools: ['get_forms', 'submit_completed_form'] }, JWT_SECRET, { expiresIn: 60 });
        const mcp = await connectMcp(scoped);
        try {
            const { tools } = await mcp.listTools();
            expect(tools.map((t) => t.name)).to.deep.equal(['get_forms']);
            const refused = await mcp.callTool({ name: 'submit_completed_form', arguments: {} }).catch((err) => ({ isError: true, err }));
            expect(refused.isError).to.equal(true);
        }
        finally {
            await mcp.close().catch(() => {});
        }
    });

    it('refuses an expired scoped token', async function () {
        const expired = jwt.sign({ typ: 'uag-scoped', admin: true, tools: [], exp: Math.floor(Date.now() / 1000) - 5 }, JWT_SECRET);
        const resp = await fetch(`${UAG_URL}/mcp`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${expired}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        expect(resp.status).to.equal(401);
    });
});
