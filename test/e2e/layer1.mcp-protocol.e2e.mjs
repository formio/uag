import { expect } from 'chai';
import { startStack, getUagToken, connectMcp, formio, mcpText, UAG_URL } from './helpers/stack.mjs';

/**
 * Layer 1: MCP protocol tests against a real UAG + Form.io OSS stack.
 *
 * No Claude involvement — a real MCP client drives the UAG tools directly
 * with deterministic inputs, and results are verified against the Form.io
 * server's REST API.
 */
describe('Layer 1: UAG MCP protocol', function () {
    this.timeout(300000);

    let stack;
    let mcp;

    before(async function () {
        stack = await startStack();
        mcp = await connectMcp(await getUagToken());
    });

    after(async function () {
        if (mcp) await mcp.close().catch(() => {});
        if (stack) await stack.stop();
    });

    it('rejects unauthenticated MCP requests', async function () {
        const resp = await fetch(`${UAG_URL}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        expect(resp.status).to.equal(401);
        expect(resp.headers.get('www-authenticate')).to.include('resource_metadata');
    });

    it('rejects a client_credentials grant with a bad admin key', async function () {
        const resp = await fetch(`${UAG_URL}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: 'formio-oss-x-admin-key',
                client_secret: 'wrong-key',
            }),
        });
        expect(resp.ok).to.equal(false);
    });

    it('lists the full UAG toolset', async function () {
        const { tools } = await mcp.listTools();
        const names = tools.map((t) => t.name);
        expect(names).to.include.members([
            'get_forms', 'get_form_fields', 'get_field_info', 'collect_field_data',
            'confirm_form_submission', 'submit_completed_form', 'find_submissions',
            'submission_update', 'agent_provide_data', 'fetch_external_data',
        ]);
    });

    it('exposes only uag-tagged forms through get_forms', async function () {
        const text = mcpText(await mcp.callTool({ name: 'get_forms', arguments: {} }));
        expect(text).to.include('customer');
        expect(text).to.include('employee');
        expect(text).to.include('application');
        // Untagged forms from the same project must not be exposed.
        expect(text).to.not.include('employeeLogin');
        expect(text).to.not.include('userRegister');
    });

    it('describes required fields of the customer form', async function () {
        const text = mcpText(await mcp.callTool({
            name: 'get_form_fields',
            arguments: { form_name: 'customer', criteria: 'required' },
        }));
        for (const field of ['firstName', 'lastName', 'email', 'referralSource']) {
            expect(text, `expected required field ${field}`).to.include(field);
        }
    });

    it('collects, validates, and submits a customer with a conditional field', async function () {
        const data = {
            firstName: 'Protocol',
            lastName: 'Tester',
            email: 'protocol.tester@example.com',
            referralSource: 'other',
            otherReferral: 'UAG e2e protocol suite',
        };

        // Collecting only part of the data should report the outstanding required fields.
        const partial = mcpText(await mcp.callTool({
            name: 'collect_field_data',
            arguments: {
                form_name: 'customer',
                form_data: {},
                updates: [
                    { data_path: 'firstName', new_value: 'Protocol' },
                    { data_path: 'lastName', new_value: 'Tester' },
                ],
            },
        }));
        expect(partial.toLowerCase()).to.include('email');

        // Submit the completed data set.
        const submitted = mcpText(await mcp.callTool({
            name: 'submit_completed_form',
            arguments: { form_name: 'customer', form_data: data },
        }));
        expect(submitted.toLowerCase()).to.not.include('error');

        // The submission must now exist in the Form.io server.
        const submissions = await formio.getSubmissions('customer', '&data.email=protocol.tester@example.com');
        expect(submissions).to.have.lengthOf(1);
        expect(submissions[0].data).to.include({
            firstName: 'Protocol',
            lastName: 'Tester',
            email: 'protocol.tester@example.com',
            referralSource: 'other',
            otherReferral: 'UAG e2e protocol suite',
        });
    });

    it('reports an error and creates nothing when required fields are missing', async function () {
        const result = await mcp.callTool({
            name: 'submit_completed_form',
            arguments: { form_name: 'customer', form_data: { firstName: 'Only' } },
        });
        const text = mcpText(result);
        expect(text).to.not.include('Successfully');
        // The server's field-level validation messages must reach the agent.
        expect(text).to.include('validation errors');
        expect(text).to.include('**Last Name (lastName)**: Last Name is required');
        expect(text).to.include('**Email (email)**: Email is required');
        const submissions = await formio.getSubmissions('customer', '&data.firstName=Only');
        expect(submissions).to.have.lengthOf(0);
    });

    it('finds submissions through find_submissions', async function () {
        const text = mcpText(await mcp.callTool({
            name: 'find_submissions',
            arguments: {
                form_name: 'customer',
                search_query: [{ data_path: 'email', operator: 'equals', search_value: 'protocol.tester@example.com' }],
                fields_requested: ['firstName', 'email'],
            },
        }));
        expect(text).to.include('Found **1**');
        expect(text).to.include('Protocol');
        expect(text).to.include('protocol.tester@example.com');
    });

    it('returns the agentic criteria prompt through agent_provide_data', async function () {
        const submission = await formio.createSubmission('application', {
            firstName: 'Agent', lastName: 'Fixture', email: 'agent.fixture@example.com',
            gpa: 3.8, essay: 'A short but well structured essay about perseverance.',
        });
        const text = mcpText(await mcp.callTool({
            name: 'agent_provide_data',
            arguments: { form_name: 'application', submission_id: submission._id, persona: 'application' },
        }));
        // The rendered prompt must contain the criteria and the agent fields.
        expect(text).to.include('aiEssayScore');
        expect(text).to.include('aiRecommendation');
        expect(text).to.include('3.5');
        // ... and the existing submission values for the agent to analyze.
        expect(text).to.include('perseverance');
    });
});
