import { expect } from 'chai';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { startStack, formio, ADMIN_KEY, UAG_URL, requireLicense } from './helpers/stack.mjs';
import { spawnNode, waitForHttp } from './helpers/proc.mjs';

const VERSION = '1.3.2';
const INTEGRATION_PORT = 3312;
const MESSAGES_PORT = 3398;
const integration = (p) => `http://127.0.0.1:${INTEGRATION_PORT}${p}`;

/**
 * Layer 1: the retired Claude integration, as published (`@formio/uag-claude`
 * 1.3.x), still works against UAG 2.0 for deployments that have not moved
 * their webhooks to the Agent API yet. Its commands drive a model over the
 * UAG's MCP tools; the deprecated `agent_provide_data` tool still answers, and
 * the model writes with `submission_update`.
 *
 * The integration runs from npm, unchanged. A scripted Messages API stands in
 * for Claude, through the SDK's ANTHROPIC_BASE_URL.
 */
describe(`Layer 1: @formio/uag-claude ${VERSION} against UAG 2.0`, function () {
    this.timeout(300000);

    let stack;
    let messages;
    let proc;
    /** The requests the scripted model received. */
    const requests = [];

    before(async function () {
        requireLicense(this);
        // Installed once per machine, outside the repository.
        const dir = path.join(os.tmpdir(), `uag-claude-${VERSION}`);
        const entry = path.join(dir, 'node_modules', '@formio', 'uag-claude', 'index.js');
        if (!existsSync(entry)) {
            await promisify(execFile)('npm', ['install', '--prefix', dir, `@formio/uag-claude@${VERSION}`, '--no-audit', '--no-fund', '--omit=dev'], { timeout: 240000 });
        }

        messages = http.createServer(async (req, res) => {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const body = JSON.parse(raw);
            requests.push(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(reply(body)));
        });
        await new Promise((resolve) => messages.listen(MESSAGES_PORT, '127.0.0.1', resolve));

        stack = await startStack();
        proc = spawnNode(entry, {
            cwd: path.dirname(entry),
            env: {
                UAG_SERVER: UAG_URL,
                ADMIN_KEY,
                PROJECT: '',
                PROJECT_KEY: '',
                PORT: String(INTEGRATION_PORT),
                CLAUDE_API_KEY: 'sk-ant-scripted',
                CLAUDE_MODEL: 'scripted-claude',
                ANTHROPIC_BASE_URL: `http://127.0.0.1:${MESSAGES_PORT}`,
            },
        });
        await waitForHttp(integration('/agent/claude'), { method: 'POST', timeoutMs: 30000 });
    });

    after(async function () {
        if (proc) await proc.kill();
        if (stack) await stack.stop();
        if (messages) await new Promise((resolve) => messages.close(resolve));
    });

    /** The tool results the model has been sent so far in a conversation. */
    const results = (body) => body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []));
    const message = (content, stop_reason) => ({
        id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'scripted-claude',
        content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
    });
    const use = (name, input) => message([{ type: 'tool_use', id: `toolu_${requests.length}`, name, input }], 'tool_use');

    /** A model that does what the command asks, one tool call at a time. */
    function reply(body) {
        const command = body.messages[0].content;
        const done = results(body).length;
        const provide = /form_name` is \*\*(\w+)\*\*\.\nThe `submission_id` is \*\*(\w+)\*\*/.exec(command);
        if (provide) {
            const [, form, id] = provide;
            if (done === 0) return use('agent_provide_data', { form_name: form, submission_id: id, persona: 'application' });
            if (done === 1) return use('submission_update', { form_name: form, submission_id: id, updates: [{ data_path: 'aiSummary', new_value: `Reviewed by uag-claude ${VERSION}.` }] });
            return message([{ type: 'text', text: 'The application is reviewed.' }], 'end_turn');
        }
        if (done === 0) return use('get_forms', {});
        return message([{ type: 'text', text: 'Listed the forms.' }], 'end_turn');
    }

    it('runs agent_provide_data from a webhook: the deprecated tool answers, and the model saves with submission_update', async function () {
        requests.length = 0;
        const applicant = await formio.createSubmission('application', { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', gpa: 3.9, essay: 'Engines.' });
        const resp = await fetch(integration('/agent/claude/agent_provide_data'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
            body: JSON.stringify({ formName: 'application', submissionId: applicant._id, persona: 'application' }),
        });
        expect(resp.status).to.equal(200);
        expect((await resp.json()).content[0].text).to.equal('The application is reviewed.');

        const tools = requests[0].tools.map((tool) => tool.name);
        expect(tools).to.include.members(['agent_provide', 'agent_provide_data', 'submission_update']);
        const [provided, updated] = results(requests[requests.length - 1]);
        expect(provided.is_error).to.equal(false);
        expect(JSON.stringify(provided.content)).to.include('admissions reviewer');
        expect(updated.is_error).to.equal(false);
        expect((await formio.getSubmission('application', applicant._id)).data.aiSummary).to.equal(`Reviewed by uag-claude ${VERSION}.`);
    });

    it('runs a direct command over the UAG\'s MCP tools', async function () {
        requests.length = 0;
        const resp = await fetch(integration('/agent/claude'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
            body: JSON.stringify({ command: 'List the forms.' }),
        });
        expect(resp.status).to.equal(200);
        const [forms] = results(requests[requests.length - 1]);
        expect(forms.is_error).to.equal(false);
        expect(JSON.stringify(forms.content)).to.include('application');
    });

    it('still refuses a caller without its key', async function () {
        const resp = await fetch(integration('/agent/claude'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        expect(resp.status).to.equal(401);
    });
});
