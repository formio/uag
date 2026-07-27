import { expect } from 'chai';
import { startStack, formio, UAG_CLAUDE_URL, ADMIN_KEY } from './helpers/stack.mjs';

const ESSAY = [
    'From the moment I rebuilt my first bicycle at age eleven, I understood that persistence',
    'is a skill, not a trait. Throughout high school I applied that lesson everywhere: founding',
    'a robotics club that grew from four members to forty, tutoring younger students in',
    'mathematics, and volunteering weekends at the community repair cafe. Each experience',
    'taught me that showing up consistently matters more than natural talent, and I intend to',
    'bring that same persistence to my college education.',
].join(' ');

/**
 * Layer 3, flow 2: Agentic Workflows.
 *
 * Uses the full stack including the uag-claude integration server. An
 * application submission is created directly in Form.io, then the
 * integration's /agent/claude/agent_provide_data endpoint is invoked — the
 * same call a Form.io Webhook action would make. A real Claude agent reads
 * the submission, follows the criteria configured on the form (a Content
 * component flagged with uag/uagField properties), and writes its assessment
 * back into the submission via the UAG tools.
 */
describe('Layer 3: agentic workflow flow', function () {
    this.timeout(900000);

    let stack;

    before(async function () {
        if (!process.env.CLAUDE_API_KEY) {
            console.warn('    Skipping: CLAUDE_API_KEY is not set.');
            this.skip();
        }
        stack = await startStack({ withClaudeIntegration: true });
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    async function runAgentProvideData(submissionId) {
        const resp = await fetch(`${UAG_CLAUDE_URL}/agent/claude/agent_provide_data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY },
            body: JSON.stringify({
                formName: 'application',
                submissionId,
                persona: 'application',
            }),
        });
        expect(resp.status, stack.claude.getOutput()).to.equal(200);
        return resp.json();
    }

    it('supplements a strong application with an accept recommendation', async function () {
        const submission = await formio.createSubmission('application', {
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada.lovelace@example.com',
            gpa: 3.9,
            essay: ESSAY,
        });

        await runAgentProvideData(submission._id);

        const updated = await formio.getSubmission('application', submission._id);
        expect(updated.data.aiRecommendation, JSON.stringify(updated.data)).to.equal('accept');
        expect(updated.data.aiEssayScore).to.be.a('number').within(1, 10);
        expect(updated.data.aiSummary).to.be.a('string').and.to.have.length.greaterThan(10);
        // The agent must not have altered the applicant's own answers.
        expect(updated.data.firstName).to.equal('Ada');
        expect(updated.data.gpa).to.equal(3.9);
        expect(updated.data.essay).to.equal(ESSAY);
    });

    it('supplements a weak application with a reject recommendation', async function () {
        const submission = await formio.createSubmission('application', {
            firstName: 'Rex',
            lastName: 'Barely',
            email: 'rex.barely@example.com',
            gpa: 2.4,
            essay: 'I want to go to college because my parents said I should. I like video games.',
        });

        await runAgentProvideData(submission._id);

        const updated = await formio.getSubmission('application', submission._id);
        expect(updated.data.aiRecommendation, JSON.stringify(updated.data)).to.equal('reject');
        expect(updated.data.aiEssayScore).to.be.a('number').within(1, 10);
    });
});
