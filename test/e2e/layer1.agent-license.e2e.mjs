import { expect } from 'chai';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnNode } from './helpers/proc.mjs';
import { startStack, getUagToken, connectMcp, formio, mcpText, ADMIN_KEY, JWT_SECRET, UAG_URL } from './helpers/stack.mjs';
import { api, engineCalls, clearEngineCalls } from './helpers/agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Layer 1: the license on Agentic Formflow, against a real UAG + Form.io OSS
 * stack. A test-only preload resolves these names to 127.0.0.1 for the UAG
 * process, so the UAG reaches the same local Form.io through each of them:
 *
 * - `formio.e2e.example`: a production endpoint. Real engines need the
 *   license; the built-in stub engines run without one, but only for work that
 *   calls them; MCP keeps working.
 * - `formio.e2e.local` and `formio.e2e.test`, and `localhost`: a project on
 *   this machine needs a license too, so Agentic Formflow is refused without one,
 *   while MCP and conversation forms keep working. The test license is issued
 *   for formio.e2e.test, so the licensed case uses it.
 *
 * The scripted e2e engines count as real engines: they are not the built-in
 * stubs. The licensed case needs E2E_UAG_LICENSE (a "uag" license for
 * formio.e2e.test) and is pending without it.
 */
describe('Layer 1: Agentic Formflow license', function () {
    this.timeout(300000);

    const PRODUCTION = 'http://formio.e2e.example:3101';
    const resolveLocally = {
        E2E_LOCAL_HOSTS: 'formio.e2e.example,formio.e2e.local,formio.e2e.test',
        NODE_OPTIONS: `--require ${path.join(here, 'helpers/resolveLocal.cjs')}`,
    };
    const description = { policyNumber: 'P-3001', lossDescription: 'My car was stolen from the street. Nobody was hurt.' };
    const claim = {
        ...description,
        lossDate: '2026-10-19', lossLocation: 'Main Street', policeReportNumber: 'APD-88',
        contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true,
        triage: { claimType: 'theft' },
    };

    let stack;
    let uag = null;

    /** Stop the running UAG and start it again with this environment. */
    async function restartUag(env) {
        if (uag) await uag.kill();
        else await stack.uag.kill();
        uag = spawnNode(path.join(here, 'helpers/uagEntry.cjs'), {
            cwd: path.resolve(here, '../..'),
            env: {
                PORT: '3210', ADMIN_KEY, JWT_SECRET, JWT_EXPIRE_TIME: '525600',
                LOGIN_FORM: `${UAG_URL}/auth/authorize`, BASE_URL: UAG_URL, PROJECT_TTL: '0', DEBUG: '',
                UAG_LICENSE: '',
                PROJECT: PRODUCTION,
                ...resolveLocally,
                ...env,
            },
        });
        const deadline = Date.now() + 60000;
        for (;;) {
            try {
                await getUagToken();
                return;
            }
            catch (err) {
                if (Date.now() > deadline) throw new Error(`UAG did not start: ${err.message}\n${uag.getOutput()}`);
                await new Promise((r) => setTimeout(r, 500));
            }
        }
    }

    const output = () => (uag || stack.uag).getOutput();

    async function saveThroughUag(data) {
        const resp = await fetch(`${UAG_URL}/claim/submission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
        });
        return { status: resp.status, body: await resp.json() };
    }

    async function capabilities() {
        return (await api('/agent/capabilities', { method: 'GET' })).body;
    }

    before(async function () {
        stack = await startStack({ uagEnv: { PROJECT: PRODUCTION, UAG_LICENSE: '', ...resolveLocally, UAG_ENGINES: 'e2e-decision,e2e-agent' } });
    });

    after(async function () {
        if (uag) await uag.kill();
        if (stack) await stack.stop();
    });

    describe('Open Source, real engines, production endpoint', function () {
        it('says at startup that Agentic Formflow needs the license', function () {
            expect(output()).to.include('Open Source edition. Agentic Formflow requires a UAG_LICENSE with the "uag" feature');
        });

        it('reports the edition on capabilities, with every operation unavailable', async function () {
            const body = await capabilities();
            expect(body.edition).to.equal('open-source');
            expect(body.formflow).to.deep.equal({ licensed: false, allowed: false, reason: 'unlicensed' });
            expect(Object.values(body.operations).every((operation) => operation.available === false)).to.equal(true);
            expect(body.engines.map((e) => e.name)).to.deep.equal(['e2e-decision', 'e2e-agent']);
        });

        it('refuses every operation with 403 and calls no engine', async function () {
            await clearEngineCalls();
            for (const [task, body] of [
                ['/agent/extract', { form: 'claim', data: description }],
                ['/agent/decide', { form: 'claim', data: description }],
                ['/agent/generate', { form: 'claim', task: 'triage', data: description }],
                ['/agent/provide', { formName: 'claim', submissionId: '000000000000000000000000', persona: 'triage' }],
            ]) {
                const resp = await api(task, { body });
                expect(resp.status, task).to.equal(403);
                expect(resp.body).to.include({ code: 'license_required', edition: 'open-source' });
                expect(resp.body.error).to.include('with the "uag" feature');
            }
            expect(await engineCalls()).to.deep.equal([]);
        });

        it('refuses a save through the UAG that the agentDecide action would re-decide, storing nothing', async function () {
            const before = (await formio.getSubmissions('claim')).length;
            const { status, body } = await saveThroughUag(claim);
            expect(status).to.equal(403);
            expect(body.code).to.equal('license_required');
            expect((await formio.getSubmissions('claim')).length).to.equal(before);
        });

        it('keeps MCP working, and answers agent_decide with the license requirement', async function () {
            const mcp = await connectMcp(await getUagToken());
            try {
                const { tools } = await mcp.listTools();
                expect(tools.map((t) => t.name)).to.include.members(['get_forms', 'collect_field_data', 'agent_decide']);
                expect(mcpText(await mcp.callTool({ name: 'get_forms', arguments: {} }))).to.include('claim');
                const decide = await mcp.callTool({ name: 'agent_decide', arguments: { form_name: 'claim', task: 'triage', form_data: description } });
                expect(decide.isError).to.equal(true);
                const refusal = JSON.parse(mcpText(decide));
                expect(refusal.code).to.equal('license_required');
                expect(refusal.error).to.include('"uag" feature');
            }
            finally {
                await mcp.close();
            }
        });
    });

    describe('Open Source, real engines, a *.local project', function () {
        before(async function () {
            await restartUag({ UAG_ENGINES: 'e2e-decision,e2e-agent', PROJECT: 'http://formio.e2e.local:3101' });
        });

        it('is not treated as this machine', async function () {
            const body = await capabilities();
            expect(body.formflow).to.deep.equal({ licensed: false, allowed: false, reason: 'unlicensed' });
            expect((await api('/agent/decide', { body: { form: 'claim', data: description } })).status).to.equal(403);
        });
    });

    for (const project of ['http://formio.e2e.test:3101', 'http://localhost:3101']) {
        describe(`Open Source, real engines, a project on this machine (${new URL(project).hostname})`, function () {
            before(async function () {
                await restartUag({ UAG_ENGINES: 'e2e-decision,e2e-agent', PROJECT: project });
            });

            it('refuses Agentic Formflow without a license, calling no engine', async function () {
                await clearEngineCalls();
                const body = await capabilities();
                expect(body.formflow).to.deep.equal({ licensed: false, allowed: false, reason: 'unlicensed' });
                const resp = await api('/agent/decide', { body: { form: 'claim', data: description } });
                expect(resp.status).to.equal(403);
                expect(resp.body.code).to.equal('license_required');
                expect(await engineCalls()).to.deep.equal([]);
            });

            it('keeps conversation forms working: MCP needs no license', async function () {
                const mcp = await connectMcp(await getUagToken());
                try {
                    const forms = mcpText(await mcp.callTool({ name: 'get_forms', arguments: {} }));
                    expect(forms).to.include('claim');
                    const provide = await mcp.callTool({ name: 'agent_provide', arguments: { form_name: 'claim', submission_id: '000000000000000000000000' } });
                    expect(provide.isError).to.equal(true);
                    expect(mcpText(provide)).to.include('license_required');
                }
                finally {
                    await mcp.close();
                }
            });
        });
    }

    describe('licensed, real engines', function () {
        before(async function () {
            if (!process.env.E2E_UAG_LICENSE) this.skip();
            await restartUag({ UAG_ENGINES: 'e2e-decision,e2e-agent', PROJECT: 'http://formio.e2e.test:3101', UAG_LICENSE: process.env.E2E_UAG_LICENSE });
        });

        it('reports the Enterprise edition, licensed', async function () {
            expect(output()).to.include('Enterprise edition. Agentic Formflow is enabled (licensed).');
            const body = await capabilities();
            expect(body.edition).to.equal('enterprise');
            expect(body.formflow).to.deep.equal({ licensed: true, allowed: true, reason: 'licensed' });
            expect(body.operations.decide).to.deep.equal({ available: true, engines: ['e2e-decision', 'e2e-agent'] });
        });

        it('decides with the real engines', async function () {
            await clearEngineCalls();
            const { status, body } = await api('/agent/decide', { body: { form: 'claim', data: description } });
            expect(status).to.equal(200);
            expect(body.fields['triage.claimType']).to.include({ engine: 'e2e-decision', value: 'theft' });
            expect((await engineCalls('e2e-decision')).length).to.be.greaterThan(0);
        });

        it('re-decides on save through the UAG', async function () {
            const { status, body } = await saveThroughUag(claim);
            expect(status, JSON.stringify(body)).to.equal(201);
            const stored = await formio.getSubmission('claim', body._id);
            expect(stored.metadata.uag.decisions['triage.claimType']).to.include({ engine: 'e2e-decision' });
        });
    });

    describe('Open Source, remote and installed engines, production endpoint', function () {
        const KEY = 'e2e-license-engine-server-key-0123456789';
        let engineServer;
        let engineRequests = [];
        let packages;
        let marker;

        before(async function () {
            // A minimal engine server: it describes one decision engine, and
            // records anything else it is asked.
            engineServer = http.createServer((req, res) => {
                engineRequests.push(`${req.method} ${req.url}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(req.url === '/v1/engines'
                    ? { protocol: 1, engines: [{ name: 'jev', kind: 'decision', model: 'jev-remote-1', maxOptions: 255 }] }
                    : { protocol: 1, model: 'jev-remote-1', answers: {} }));
            });
            await new Promise((resolve) => engineServer.listen(3303, '127.0.0.1', resolve));
            // A third-party engine package, mounted through UAG_ENGINE_PATH. Its
            // decide leaves a marker file, so a call would show.
            packages = mkdtempSync(path.join(os.tmpdir(), 'uag-license-engines-'));
            marker = path.join(packages, 'called');
            const dir = path.join(packages, 'node_modules', 'uag-engine-acme');
            mkdirSync(dir, { recursive: true });
            writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'uag-engine-acme', version: '3.1.4', main: 'index.js' }));
            writeFileSync(path.join(dir, 'index.js'), `
                module.exports = { type: 'acme', kinds: ['decision'], apiVersion: 1, create: ({ name }) => ({
                    name, kind: 'decision', model: 'acme-1', maxOptions: 255,
                    decide: async () => { require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); return { model: 'acme-1', answers: {} }; },
                }) };`);
            await restartUag({
                UAG_ENGINES: 'jev:remote,acme,triage:stub-decision',
                UAG_ENGINE_JEV_URL: 'http://127.0.0.1:3303',
                UAG_ENGINE_JEV_KEY: KEY,
                UAG_ENGINE_PATH: packages,
                PROJECT: PRODUCTION,
            });
        });

        after(async function () {
            if (engineServer) await new Promise((resolve) => engineServer.close(resolve));
            if (packages) rmSync(packages, { recursive: true, force: true });
        });

        it('loads them, and lists where each came from', async function () {
            const body = await capabilities();
            expect(body.engines).to.deep.equal([
                { name: 'jev', kind: 'decision', model: 'jev-remote-1', type: 'remote' },
                { name: 'acme', kind: 'decision', model: 'acme-1', type: 'acme', package: 'uag-engine-acme', version: '3.1.4' },
                { name: 'triage', kind: 'decision', model: 'stub-decision-1', type: 'stub-decision' },
            ]);
            expect(body.formflow).to.deep.equal({ licensed: false, allowed: false, reason: 'unlicensed' });
        });

        it('refuses them without a license, calling neither the engine server nor the package', async function () {
            engineRequests = [];
            const resp = await api('/agent/decide', { body: { form: 'claim', data: description } });
            expect(resp.status).to.equal(403);
            expect(resp.body.code).to.equal('license_required');
            expect(engineRequests).to.deep.equal([]);
            expect(existsSync(marker)).to.equal(false);
        });

        it('still runs a stub under its own instance name, which keeps its standing', async function () {
            await restartUag({ UAG_ENGINES: 'triage:stub-decision', PROJECT: PRODUCTION });
            const body = await capabilities();
            expect(body.formflow).to.deep.equal({ licensed: false, allowed: true, reason: 'stub-engines' });
            const { status, body: decided } = await api('/agent/decide', { body: { form: 'claim', data: description } });
            expect(status).to.equal(200);
            expect(decided.fields['triage.claimType']).to.include({ engine: 'triage' });
        });
    });

    describe('Open Source, stub engines, production endpoint', function () {
        before(async function () {
            await restartUag({ UAG_ENGINES: 'stub-decision,stub-agent', PROJECT: PRODUCTION });
        });

        it('runs the stubs without a license, for evaluation', async function () {
            const body = await capabilities();
            expect(body.edition).to.equal('open-source');
            expect(body.formflow).to.deep.equal({ licensed: false, allowed: true, reason: 'stub-engines' });
            const { status, body: decided } = await api('/agent/decide', { body: { form: 'claim', data: description } });
            expect(status).to.equal(200);
            expect(decided.fields['triage.claimType']).to.include({ status: 'confident', engine: 'stub-decision' });
        });

        it('does not let the stubs unlock agent_decide, which calls no engine', async function () {
            const mcp = await connectMcp(await getUagToken());
            try {
                const decide = await mcp.callTool({ name: 'agent_decide', arguments: { form_name: 'claim', task: 'triage', form_data: description } });
                expect(decide.isError).to.equal(true);
                expect(JSON.parse(mcpText(decide)).code).to.equal('license_required');
            }
            finally {
                await mcp.close();
            }
        });
    });
});
