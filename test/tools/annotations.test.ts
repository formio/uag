import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect } from 'chai';
import { getTools } from '../../src/tools';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';

/**
 * Every tool must say whether calling it changes data.
 *
 * A client deciding between ten tools has the annotations and nothing else to go
 * on: `readOnlyHint` is what lets it explore safely, and `destructiveHint` is what
 * makes it ask before overwriting a submission. Directories score these too — the
 * Claude Connectors Directory names missing annotations as a top rejection reason
 * after a missing privacy policy.
 */
describe('tool annotations', () => {
    let project: UAGProjectInterface;

    beforeEach(() => {
        project = Object.create(UAGProjectInterface.prototype);
        project.forms = {};
        project.formNames = [];
        project.user = null;
    });

    const READS = [
        'get_forms',
        'get_form_fields',
        'get_field_info',
        'find_submissions',
        'fetch_external_data',
        'collect_field_data',
        'confirm_form_submission',
        'agent_provide_data',
    ];

    // submit_completed_form creates a submission; submission_update calls
    // form.submit() over an existing one.
    const WRITES = ['submit_completed_form', 'submission_update'];

    it('annotates every tool', async () => {
        const tools = await getTools(project);
        expect(tools.length).to.be.greaterThan(0);
        for (const tool of tools) {
            expect(tool.annotations, `${tool.name} has no annotations`).to.be.an('object');
            expect(tool.annotations?.title, `${tool.name} has no annotation title`).to.be.a('string');
            expect(
                tool.annotations?.readOnlyHint,
                `${tool.name} does not declare readOnlyHint`
            ).to.be.a('boolean');
            expect(
                tool.annotations?.destructiveHint,
                `${tool.name} does not declare destructiveHint`
            ).to.be.a('boolean');
        }
    });

    it('marks the tools that only read as read-only', async () => {
        const tools = await getTools(project);
        for (const name of READS) {
            const tool = tools.find((t) => t.name === name);
            expect(tool, `${name} is missing from getTools`).to.not.be.undefined;
            expect(tool?.annotations?.readOnlyHint, `${name} should be read-only`).to.equal(true);
            // A read-only tool cannot also be destructive; asserting the pair keeps
            // copy-paste between tool files from producing a contradiction.
            expect(tool?.annotations?.destructiveHint, `${name} is read-only yet destructive`).to.equal(
                false
            );
        }
    });

    it('marks the tools that persist as writes, and the update as destructive', async () => {
        const tools = await getTools(project);
        for (const name of WRITES) {
            const tool = tools.find((t) => t.name === name);
            expect(tool, `${name} is missing from getTools`).to.not.be.undefined;
            expect(tool?.annotations?.readOnlyHint, `${name} writes, so it is not read-only`).to.equal(
                false
            );
        }

        const update = tools.find((t) => t.name === 'submission_update');
        // Overwrites a stored submission: the prior values are gone.
        expect(update?.annotations?.destructiveHint).to.equal(true);
        expect(update?.annotations?.idempotentHint).to.equal(true);

        const submit = tools.find((t) => t.name === 'submit_completed_form');
        // Creates a new record, so calling it twice creates two.
        expect(submit?.annotations?.idempotentHint).to.equal(false);
    });

    it('declares that every tool depends on the Form.io deployment', async () => {
        const tools = await getTools(project);
        for (const tool of tools) {
            expect(tool.annotations?.openWorldHint, `${tool.name} should be open-world`).to.equal(true);
        }
    });

    // Declaring annotations on ToolInfo is useless if buildMcpServer drops them on
    // the way into registerTool, so this asserts what a connected client actually
    // receives rather than what the definitions contain.
    it('serves the annotations to a connected client', async () => {
        const server = await project.buildMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'annotations-test', version: '0.0.0' });
        await client.connect(clientTransport);

        const { tools } = await client.listTools();
        expect(tools.length).to.be.greaterThan(0);
        for (const tool of tools) {
            expect(tool.annotations, `${tool.name} reached the client unannotated`).to.be.an('object');
            expect(tool.annotations?.readOnlyHint, `${tool.name} lost readOnlyHint`).to.be.a('boolean');
        }

        const submit = tools.find((t) => t.name === 'submit_completed_form');
        expect(submit?.annotations?.readOnlyHint).to.equal(false);
        const forms = tools.find((t) => t.name === 'get_forms');
        expect(forms?.annotations?.readOnlyHint).to.equal(true);
    });
});
