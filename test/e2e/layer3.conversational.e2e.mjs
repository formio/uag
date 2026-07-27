import { expect } from 'chai';
import { startStack, getUagToken, connectMcp, formio } from './helpers/stack.mjs';
import { runConversation } from './helpers/conversation.mjs';

const MODEL = process.env.E2E_CLAUDE_MODEL || 'claude-opus-5';

/**
 * Layer 3, flow 1: Conversational Forms.
 *
 * A real Claude model, given the real UAG MCP tools against a real Form.io
 * stack, acts as a conversational front-end for the uag-tagged "customer"
 * resource. The test plays the user with scripted turns and verifies the
 * conversation ends with a correct submission stored in Form.io — including
 * a conditionally required field (otherReferral, shown only when
 * referralSource is "other").
 */
describe('Layer 3: conversational forms flow', function () {
    this.timeout(900000);

    let stack;
    let mcp;

    before(async function () {
        if (!process.env.CLAUDE_API_KEY) {
            console.warn('    Skipping: CLAUDE_API_KEY is not set.');
            this.skip();
        }
        stack = await startStack();
        mcp = await connectMcp(await getUagToken());
    });

    after(async function () {
        if (mcp) await mcp.close().catch(() => {});
        if (stack) await stack.stop();
    });

    it('guides a user through creating a Contact and submits it', async function () {
        const findSubmission = async () =>
            (await formio.getSubmissions('customer', '&data.email=jane.doe@example.com'))[0] || null;

        const { transcript, toolCalls } = await runConversation({
            mcp,
            model: MODEL,
            isDone: async () => !!(await findSubmission()),
            userTurns: [
                'Hello! I would like to add a new Contact.',
                [
                    'Her name is Jane Doe and her email is jane.doe@example.com.',
                    'Phone number is (212) 555-0100 and she works at Acme Corporation.',
                    'She heard about us from "Other" - specifically a conference booth at FormConf 2026.',
                    'I do not have any other details about her.',
                ].join(' '),
                'That all looks correct. Please submit the form now.',
                'Yes, go ahead and submit it now.',
            ],
        });

        const debug = () => JSON.stringify({ transcript, toolCalls: toolCalls.map((c) => c.name) }, null, 2);

        // The agent must have discovered the form through the UAG tools.
        const toolNames = toolCalls.map((c) => c.name);
        expect(toolNames, debug()).to.include('get_forms');
        expect(toolNames, debug()).to.include('submit_completed_form');

        // The conversation must end with a real submission in Form.io.
        const submission = await findSubmission();
        expect(submission, `No customer submission was created.\n${debug()}`).to.not.equal(null);
        expect(submission.data.firstName).to.equal('Jane');
        expect(submission.data.lastName).to.equal('Doe');
        expect(submission.data.email).to.equal('jane.doe@example.com');
        expect(submission.data.company).to.match(/acme/i);
        // The conditional required field must have been collected because
        // referralSource was 'other'.
        expect(submission.data.referralSource).to.equal('other');
        expect(submission.data.otherReferral, debug()).to.be.a('string').and.to.have.length.greaterThan(0);
    });
});
