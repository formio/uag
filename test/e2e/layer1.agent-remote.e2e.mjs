import { expect } from 'chai';
import http from 'http';
import jwt from 'jsonwebtoken';
import { startStack, connectMcp, formio, ADMIN_KEY, UAG_URL, requireLicense } from './helpers/stack.mjs';
import { api, bearerHeaders, userToken } from './helpers/agent.mjs';

const ENGINE_SERVER_PORT = 3399;
const ENGINE_SERVER_KEY = 'e2e-engine-server-key-0123456789abcdef';

/**
 * Layer 1: the `remote` engine type, which reaches an engine hosted by an
 * engine server over the remote engine protocol, so model keys and model
 * traffic stay in that container. A fake engine server stands in for it here:
 * for research it connects back to the UAG's /mcp with the scoped token it was
 * sent, and then does what the test tells it to — including things a
 * compromised model would try. Everything it can reach is decided by that
 * token, which only ever allows the task's read-only tools.
 */
describe('Layer 1: Agent API — remote engine and scoped tokens', function () {
    this.timeout(300000);

    const uagSecret = 'uag-e2e-remote-secret';
    let stack;
    let server;
    /** What the engine server received and did, per extract request. */
    let received = [];
    /** What the engine server does with an extract: returns the model's values. */
    let behave = async () => ({});

    const json = (res, status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    };

    before(async function () {
        requireLicense(this);
        server = http.createServer(async (req, res) => {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            if (req.headers.authorization !== `Bearer ${ENGINE_SERVER_KEY}`) {
                return json(res, 401, { protocol: 1, error: 'Unauthorized', expose: true });
            }
            if (req.method === 'GET' && req.url === '/v1/engines') {
                return json(res, 200, { protocol: 1, engines: [{ name: 'claude', kind: 'agent', model: 'fake-claude-1', toolUse: true }] });
            }
            const entry = {
                url: req.url,
                headers: req.headers,
                body: JSON.parse(raw),
                token: req.headers['x-uag-scoped-token'],
                calls: [],
            };
            received.push(entry);
            try {
                const values = await behave(entry);
                json(res, 200, {
                    protocol: 1,
                    model: 'fake-claude-1',
                    values,
                    ...(entry.body.tools && { toolCalls: entry.calls.map(({ name, isError }) => ({ name, isError })) }),
                    usage: { inputTokens: 12, outputTokens: 3 },
                });
            }
            catch (err) {
                json(res, 500, { protocol: 1, error: err.message, expose: false });
            }
        });
        await new Promise((resolve) => server.listen(ENGINE_SERVER_PORT, '127.0.0.1', resolve));

        stack = await startStack({
            uagEnv: {
                JWT_SECRET: uagSecret,
                UAG_ENGINES: 'e2e-decision,claude:remote',
                // Admin-key mode: the UAG holds ADMIN_KEY, and must never send it on.
                PROJECT_KEY: '',
                UAG_ENGINE_CLAUDE_URL: `http://127.0.0.1:${ENGINE_SERVER_PORT}`,
                UAG_ENGINE_CLAUDE_KEY: ENGINE_SERVER_KEY,
                E2E_UAG_CONFIG: JSON.stringify({ agentApi: { research: { timeout: 4000 } } }),
            },
        });
    });

    after(async function () {
        if (stack) await stack.stop();
        if (server) await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(function () {
        received = [];
        behave = async () => ({});
    });

    /** Connect to /mcp as an engine server does, record each tool call, and close. */
    async function asEngineServer(entry, steps) {
        const mcp = await connectMcp(entry.token);
        try {
            entry.tools = (await mcp.listTools()).tools.map((t) => t.name);
            for (const [name, args] of steps) {
                const result = await mcp.callTool({ name, arguments: args }).catch((err) => ({ isError: true, content: [{ type: 'text', text: err.message }] }));
                entry.calls.push({ name, isError: !!result.isError, text: (result.content || []).map((c) => c.text).join('\n') });
            }
        }
        finally {
            await mcp.close().catch(() => {});
        }
    }

    it('serves plain extraction with calls that carry no tools and no token', async function () {
        behave = async () => ({ location: 'Riverside Mall' });
        const { status, body } = await api('/agent/extract', { body: { form: 'routing', data: { notes: 'My bike was stolen at the Riverside Mall.' } } });
        expect(status, JSON.stringify(body)).to.equal(200);
        expect(body.fields.location).to.include({ status: 'suggested', value: 'Riverside Mall', engine: 'claude', model: 'fake-claude-1' });
        expect(received).to.not.be.empty;
        for (const entry of received) {
            expect(entry.url).to.equal('/v1/engines/claude/extract');
            expect(entry.token).to.equal(undefined);
            expect(entry.body).to.not.have.property('tools');
            expect(entry.headers).to.not.have.property('x-admin-key');
            expect(entry.headers).to.not.have.property('x-token');
        }
    });

    it('lists the remote instance on capabilities, with its type', async function () {
        const { body } = await api('/agent/capabilities', { method: 'GET' });
        expect(body.engines).to.deep.include({ name: 'claude', kind: 'agent', model: 'fake-claude-1', type: 'remote' });
    });

    describe('provide, researching through the engine server', function () {
        let victim;
        let applicant;
        let response;
        let entry;

        before(async function () {
            received = [];
            victim = await formio.createSubmission('application', { firstName: 'Vic', lastName: 'Tim', email: 'vic@example.com', gpa: 2.0, essay: 'Mine.' });
            applicant = await formio.createSubmission('application', { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', gpa: 3.9, essay: 'Engines.' });
            behave = async (e) => {
                await asEngineServer(e, [
                    ['get_forms', {}],
                    ['submission_update', { form_name: 'application', submission_id: victim._id, updates: [{ data_path: 'aiSummary', new_value: 'Hacked' }] }],
                    ['submit_completed_form', { form_name: 'customer', data: {} }],
                ]);
                // An answer that also names a field the task does not own.
                return { aiRecommendation: 'accept', aiSummary: 'Strong applicant.', aiEssayScore: 7, gpa: 4.0 };
            };
            response = await api('/agent/provide', { body: { formName: 'application', submissionId: applicant._id, persona: 'application' } });
            entry = received[0];
        });

        it('saves the engine server\'s answer for the task\'s fields only, and reports its tool calls', async function () {
            expect(response.status, JSON.stringify(response.body)).to.equal(200);
            expect(response.body.written).to.deep.equal({ aiRecommendation: 'accept', aiSummary: 'Strong applicant.', aiEssayScore: 7 });
            expect(response.body.fields.aiSummary).to.include({ engine: 'claude', model: 'fake-claude-1', status: 'suggested' });
            expect(response.body.engines[0].toolCalls.map((call) => [call.name, call.isError])).to.deep.equal([
                ['get_forms', false], ['submission_update', true], ['submit_completed_form', true],
            ]);
            const stored = await formio.getSubmission('application', applicant._id);
            expect(stored.data).to.include({ aiRecommendation: 'accept', gpa: 3.9 });
            expect(entry.body.state.instructions).to.include('admissions reviewer');
            expect(entry.body.tools.map((tool) => tool.name)).to.have.members(['find_submissions', 'get_forms']);
            expect(entry.body.maxIterations).to.be.a('number');
        });

        it('sends the engine server key, and never a Form.io credential', function () {
            expect(entry.headers.authorization).to.equal(`Bearer ${ENGINE_SERVER_KEY}`);
            expect(entry.headers).to.not.have.property('x-admin-key');
            expect(entry.headers).to.not.have.property('x-token');
            expect(JSON.stringify(entry)).to.not.include(ADMIN_KEY);
        });

        it('gives the engine server a token for the task\'s read-only tools, for the research timeout', function () {
            const claims = jwt.decode(entry.token);
            expect(claims).to.include({ typ: 'uag-scoped', admin: true });
            expect(claims.tools).to.deep.equal(['find_submissions', 'get_forms']);
            expect(claims).to.not.have.property('submissionId');
            expect(claims).to.not.have.property('paths');
            expect(claims.exp - claims.iat).to.equal(4);
        });

        it('lists only those tools on /mcp, so the engine server cannot write anything', async function () {
            expect(entry.tools).to.have.members(['find_submissions', 'get_forms']);
            expect(entry.calls.map((c) => [c.name, c.isError])).to.deep.equal([
                ['get_forms', false],
                ['submission_update', true],
                ['submit_completed_form', true],
            ]);
            expect((await formio.getSubmission('application', victim._id)).data).to.not.have.property('aiSummary');
        });

        it('cannot use the token on the Agent API', async function () {
            const reused = await api('/agent/provide', { headers: bearerHeaders(entry.token), body: { form: 'application', submissionId: victim._id } });
            expect(reused.status).to.equal(401);
        });

        it('refuses the token once it has expired', async function () {
            const wait = jwt.decode(entry.token).exp * 1000 - Date.now() + 1500;
            await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
            const resp = await fetch(`${UAG_URL}/mcp`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${entry.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
            });
            expect(resp.status).to.equal(401);
        });
    });

    it('carries a signed-in user\'s identity to the engine server, so their permissions apply', async function () {
        const token = await userToken('remote-user@example.com', { uagSecret });
        const claim = await formio.createSubmission('claim', {
            policyNumber: 'P-REMOTE-1', lossDescription: 'Stolen.', lossDate: '2026-10-19', lossLocation: 'Main Street', policeReportNumber: 'R', contactName: 'Pat Lee', contactPhone: '(512) 555-0142', attestation: true, triage: { claimType: 'theft' },
        });
        behave = async (entry) => {
            await asEngineServer(entry, [
                ['find_submissions', { form_name: 'application', search_query: [{ data_path: 'email', operator: 'contains', search_value: '@' }], fields_requested: ['email'] }],
                ['find_submissions', { form_name: 'claim', search_query: [{ data_path: 'policyNumber', operator: 'equals', search_value: 'P-REMOTE-1' }] }],
            ]);
            return { aiSummary: 'Searched.' };
        };
        const { status } = await api('/agent/generate', {
            headers: bearerHeaders(token),
            body: { form: 'application', task: 'application', data: { firstName: 'Eve', lastName: 'Adams', gpa: 3.0, essay: 'Hello.' } },
        });
        expect(status).to.equal(200);
        const [entry] = received;
        const claims = jwt.decode(entry.token);
        expect(claims).to.include({ admin: false });
        // The user's own token travels encrypted: the engine server (and any proxy
        // logging its traffic) cannot read it out of the scoped token.
        expect(claims.bearer).to.be.a('string');
        expect(JSON.stringify(claims)).to.not.include(token);
        // The user may read applications but not claims.
        expect(entry.calls.map((c) => c.isError)).to.deep.equal([false, true]);
        expect(entry.calls[1].text).to.not.include(claim._id);
    });

    it('reports a failing engine server as an engine failure, without its hidden message, and saves nothing', async function () {
        behave = async () => {
            throw new Error('model overloaded');
        };
        const applicant = await formio.createSubmission('application', { firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com', gpa: 3.6, essay: 'Hi.' });
        const { status, body } = await api('/agent/provide', { body: { form: 'application', task: 'application', submissionId: applicant._id } });
        expect(status).to.equal(503);
        expect(body.error).to.include('claude (The engine server answered HTTP 500.)');
        expect(body.error).to.not.include('model overloaded');
        expect((await formio.getSubmission('application', applicant._id)).data).to.not.have.property('aiSummary');
    });
});
