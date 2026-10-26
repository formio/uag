import { expect } from 'chai';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnNode } from './helpers/proc.mjs';
import { startStack, getUagToken, connectMcp, mcpText, formio, ADMIN_KEY, JWT_SECRET, FORMIO_URL, UAG_URL, requireLicense, E2E_LICENSE } from './helpers/stack.mjs';
import { adminHeaders } from './helpers/agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Layer 1: the UAG following the project it serves (@formio/appserver 2.16).
 * The project, not the module's template, is the source of truth: the template
 * installs what the project is missing at startup, and a PROJECT_TTL refresh
 * brings in forms added, changed or deleted in Form.io, with the current
 * actions on their routes.
 */
describe('Layer 1: project changes reach the UAG', function () {
    this.timeout(300000);

    let stack;
    const admin = { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };

    before(async function () {
        requireLicense(this);
        stack = await startStack({ uagEnv: { UAG_ENGINES: 'e2e-decision,e2e-agent', PROJECT_TTL: '2' } });
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    async function formioJson(urlPath, init = {}) {
        const resp = await fetch(`${FORMIO_URL}${urlPath}`, { ...init, headers: { ...admin, ...(init.headers || {}) } });
        if (!resp.ok) throw new Error(`${init.method || 'GET'} ${urlPath}: HTTP ${resp.status} ${await resp.text()}`);
        const text = await resp.text();
        try {
            return text ? JSON.parse(text) : null;
        }
        catch {
            // DELETE answers with a plain "OK".
            return text;
        }
    }

    async function formNames() {
        const mcp = await connectMcp(await getUagToken());
        try {
            return mcpText(await mcp.callTool({ name: 'get_forms', arguments: {} }));
        }
        finally {
            await mcp.close().catch(() => {});
        }
    }

    /** Poll until `check` passes, for up to `ms` (a few PROJECT_TTL refreshes). */
    async function eventually(check, ms = 20000) {
        const deadline = Date.now() + ms;
        let last;
        while (Date.now() < deadline) {
            try {
                return await check();
            }
            catch (err) {
                last = err;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw last;
    }

    it('serves a uag form created in Form.io after startup, and stops when it is deleted', async function () {
        const created = await formioJson('/form', {
            method: 'POST',
            body: JSON.stringify({
                title: 'Pulse Survey', name: 'pulse', path: 'pulse', type: 'form', tags: ['uag'],
                components: [
                    { type: 'textarea', key: 'comment', label: 'Comment', input: true, properties: { uag: 'pulse', uagField: 'input' } },
                    { type: 'radio', key: 'mood', label: 'Mood', input: true, values: [{ label: 'Theft', value: 'theft' }, { label: 'Property damage', value: 'propertyDamage' }], properties: { uag: 'pulse' } },
                ],
            }),
        });
        await eventually(async () => expect(await formNames()).to.include('pulse'));
        const decide = await fetch(`${UAG_URL}/agent/decide`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ form: 'pulse', data: { comment: 'My bike was stolen.' } }) });
        expect(decide.status).to.equal(200);
        expect((await decide.json()).fields.mood).to.include({ status: 'confident', value: 'theft' });

        await formioJson(`/form/${created._id}`, { method: 'DELETE' });
        await eventually(async () => expect(await formNames()).to.not.include('pulse'));
        const gone = await fetch(`${UAG_URL}/agent/decide`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ form: 'pulse', data: {} }) });
        expect(gone.status).to.equal(404);
    });

    it('stops treating a form as a uag form once its tag is removed', async function () {
        const incident = await formioJson('/incident');
        await formioJson(`/form/${incident._id}`, { method: 'PUT', body: JSON.stringify({ ...incident, tags: [] }) });
        try {
            await eventually(async () => expect(await formNames()).to.not.include('incident'));
        }
        finally {
            await formioJson(`/form/${incident._id}`, { method: 'PUT', body: JSON.stringify({ ...incident, tags: ['uag'] }) });
        }
        await eventually(async () => expect(await formNames()).to.include('incident'));
    });

    it('keeps re-deciding claims on save after a refresh rebuilds the form routes', async function () {
        // Let at least one refresh rebuild the routes.
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const resp = await fetch(`${UAG_URL}/claim/submission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: {
                    policyNumber: 'P-SYNC', lossDescription: 'My car was stolen. I paid cash for it and there is no receipt.',
                    lossDate: '2026-10-19', lossLocation: 'Main Street', policeReportNumber: 'APD-9',
                    contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true,
                    triage: { claimType: 'theft', fraudSignals: false },
                },
            }),
        });
        const body = await resp.json();
        expect(resp.status, JSON.stringify(body)).to.equal(201);
        const stored = await formio.getSubmission('claim', body._id);
        expect(stored.data.triage.fraudSignals).to.equal(true);
        expect(stored.metadata.uag.decisions['triage.fraudSignals'].source).to.equal('server');
    });

    it('installs a template action that is missing from a form the project already has, at the next startup', async function () {
        const claim = await formioJson('/claim');
        const actions = await formioJson(`/form/${claim._id}/action`);
        const agentDecide = actions.find((action) => action.name === 'agentDecide');
        expect(agentDecide, 'the template installed agentDecide at the first startup').to.exist;
        await formioJson(`/form/${claim._id}/action/${agentDecide._id}`, { method: 'DELETE' });

        // A second UAG starting against the same project installs it again (TEMPLATE_SYNC=boot).
        const second = spawnNode(path.join(here, 'helpers/uagEntry.cjs'), {
            cwd: path.resolve(here, '../..'),
            env: {
                PORT: '3231', PROJECT: FORMIO_URL.replace('127.0.0.1', 'localhost'), UAG_LICENSE: E2E_LICENSE, ADMIN_KEY, JWT_SECRET, BASE_URL: 'http://127.0.0.1:3231',
                PROJECT_TTL: '0', DEBUG: '', UAG_ENGINES: 'e2e-decision,e2e-agent', E2E_UAG_CONFIG: '',
            },
        });
        try {
            await eventually(async () => {
                const after = await formioJson(`/form/${claim._id}/action`);
                const installed = after.filter((action) => action.name === 'agentDecide');
                expect(installed).to.have.lengthOf(1);
                expect(installed[0].settings).to.deep.equal({ task: 'triage' });
            }, 60000);
        }
        finally {
            await second.kill();
        }
    });
});
