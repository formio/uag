import { expect } from 'chai';
import { startStack, getUagToken, connectMcp, formio } from './helpers/stack.mjs';
import { runConversation } from './helpers/conversation.mjs';

const MODEL = process.env.E2E_CLAUDE_MODEL || 'claude-opus-5';

/**
 * Layer 3, conversational forms with invalid user input.
 *
 * This is the flow-level counterpart to the failure-path unit and protocol
 * tests: the agent must actually receive intelligible validation errors and
 * act on them. A regression that hides validation messages, or reports a
 * rejected submission as a success, shows up here as the agent cheerfully
 * confirming a submission that does not exist.
 */
describe('Layer 3: conversational forms with invalid input', function () {
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

    it('refuses invalid values, then submits once the user corrects them', async function () {
        const findSubmission = async () =>
            (await formio.getSubmissions('customer', '&data.lastName=Quimby'))[0] || null;

        const { transcript, toolCalls } = await runConversation({
            mcp,
            model: MODEL,
            isDone: async () => !!(await findSubmission()),
            userTurns: [
                'I would like to add a new Contact.',
                // The email is incomplete rather than merely obfuscated: there is
                // no domain, so it cannot be repaired without inventing one.
                'Name is Ramona Quimby. For her email I only have "ramona.quimby" — that is everything she wrote down. Go ahead and submit it.',
                'I do not have anything else. Please just submit whatever you have.',
                // Supply the complete address.
                'She got back to me — her full email is ramona.quimby@example.com, and put her referral source down as Web Search. Submit it now.',
                'Yes, submit it.',
            ],
        });

        const debug = () => JSON.stringify({ transcript, toolCalls: toolCalls.map((c) => c.name) }, null, 2);
        const assistantText = transcript.filter((t) => t.role === 'assistant').map((t) => t.text).join('\n');

        // The agent must have told the user something was wrong with the input
        // rather than silently submitting or silently inventing values.
        expect(assistantText.toLowerCase(), debug()).to.match(/valid|invalid|format|option|correct/);

        // The corrected submission must exist, with the corrected values.
        const submission = await findSubmission();
        expect(submission, `No corrected submission was created.\n${debug()}`).to.not.equal(null);
        expect(submission.data.email).to.equal('ramona.quimby@example.com');
        expect(submission.data.referralSource).to.equal('web');

        // No submission may hold an incomplete email or an invented option value.
        const all = await formio.getSubmissions('customer');
        for (const stored of all) {
            expect(stored.data.email, debug()).to.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
            expect(['web', 'friend', 'other', undefined], debug()).to.include(stored.data.referralSource);
        }
    });
});
