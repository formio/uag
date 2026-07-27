import { expect } from 'chai';
import { startStack, getUagToken, connectMcp, formio, mcpText, UAG_URL } from './helpers/stack.mjs';

/**
 * Layer 1, non-happy paths.
 *
 * Every bug found in this library so far has been on a failure path — a
 * rejected submission reported as a success, and validation messages that
 * rendered blank once they finally reached the agent. These tests pin the
 * behavior of the failure paths themselves: the agent must be told what went
 * wrong, and nothing partial or invalid may reach the database.
 */
describe('Layer 1: UAG MCP failure paths', function () {
    this.timeout(300000);

    let stack;
    let mcp;

    /** Calls a tool and returns { isError, text } without throwing. */
    async function call(name, args) {
        try {
            const result = await mcp.callTool({ name, arguments: args });
            return { isError: !!result.isError, text: mcpText(result) };
        }
        catch (err) {
            // Schema-level rejections surface as thrown MCP protocol errors.
            return { isError: true, text: err.message };
        }
    }

    before(async function () {
        stack = await startStack();
        mcp = await connectMcp(await getUagToken());
    });

    after(async function () {
        if (mcp) await mcp.close().catch(() => {});
        if (stack) await stack.stop();
    });

    describe('form access', function () {
        it('refuses a form that exists but is not uag-tagged', async function () {
            const { isError, text } = await call('get_form_fields', { form_name: 'employeeLogin' });
            expect(isError).to.equal(true);
            expect(text).to.include('form_name');
        });

        it('refuses a form that does not exist', async function () {
            const { isError } = await call('get_form_fields', { form_name: 'noSuchForm' });
            expect(isError).to.equal(true);
        });

        it('does not invent fields for unknown field paths', async function () {
            const { text } = await call('get_field_info', {
                form_name: 'customer',
                field_paths: ['notAField', 'alsoNotAField'],
            });
            // The unknown paths must not come back described as real fields.
            expect(text).to.not.include('notAField');
            expect(text).to.not.include('alsoNotAField');
        });
    });

    describe('submission validation', function () {
        it('rejects an invalid email and stores nothing', async function () {
            const { isError, text } = await call('submit_completed_form', {
                form_name: 'customer',
                form_data: {
                    firstName: 'Bad', lastName: 'Email',
                    email: 'not-an-email', referralSource: 'web',
                },
            });
            expect(isError).to.equal(true);
            expect(text).to.include('**Email (email)**: Email must be a valid email.');
            expect(await formio.getSubmissions('customer', '&data.lastName=Email')).to.have.lengthOf(0);
        });

        it('rejects a select value outside the configured options and stores nothing', async function () {
            const { isError, text } = await call('submit_completed_form', {
                form_name: 'customer',
                form_data: {
                    firstName: 'Bad', lastName: 'Select',
                    email: 'bad.select@example.com', referralSource: 'not-an-option',
                },
            });
            expect(isError).to.equal(true);
            expect(text).to.include('Referral Source');
            expect(await formio.getSubmissions('customer', '&data.lastName=Select')).to.have.lengthOf(0);
        });

        it('rejects a missing conditionally required field and names it', async function () {
            // otherReferral is only required when referralSource is 'other'.
            const { isError, text } = await call('submit_completed_form', {
                form_name: 'customer',
                form_data: {
                    firstName: 'Cond', lastName: 'Missing',
                    email: 'cond.missing@example.com', referralSource: 'other',
                },
            });
            expect(isError).to.equal(true);
            expect(text).to.include('**Other Referral Details (otherReferral)**');
            expect(await formio.getSubmissions('customer', '&data.lastName=Missing')).to.have.lengthOf(0);
        });

        it('drops a conditionally hidden field rather than storing it', async function () {
            const { isError } = await call('submit_completed_form', {
                form_name: 'customer',
                form_data: {
                    firstName: 'Cond', lastName: 'Hidden',
                    email: 'cond.hidden@example.com', referralSource: 'web',
                    otherReferral: 'should not be stored',
                },
            });
            expect(isError).to.equal(false);
            const [submission] = await formio.getSubmissions('customer', '&data.lastName=Hidden');
            expect(submission).to.exist;
            expect(submission.data.otherReferral).to.equal(undefined);
        });

        it('rejects a non-numeric value for a number field and stores nothing', async function () {
            const { isError, text } = await call('submit_completed_form', {
                form_name: 'application',
                form_data: {
                    firstName: 'Bad', lastName: 'Gpa', email: 'bad.gpa@example.com',
                    gpa: 'very high', essay: 'An essay.',
                },
            });
            expect(isError).to.equal(true);
            // Form.io discards the uncoercible value, so this surfaces as GPA
            // being absent rather than as a type error.
            expect(text).to.include('GPA');
            expect(await formio.getSubmissions('application', '&data.lastName=Gpa')).to.have.lengthOf(0);
        });

        it('reports validation errors when collecting an invalid value', async function () {
            const { text } = await call('collect_field_data', {
                form_name: 'customer',
                form_data: {},
                updates: [{ data_path: 'email', new_value: 'not-an-email' }],
            });
            expect(text).to.include('Validation Errors');
            expect(text).to.include('**Email (email)**: Email must be a valid email.');
        });
    });

    describe('submission lookup and update', function () {
        it('reports no results rather than failing when nothing matches', async function () {
            const { isError, text } = await call('find_submissions', {
                form_name: 'customer',
                search_query: [{ data_path: 'email', operator: 'equals', search_value: 'nobody@example.com' }],
            });
            expect(isError).to.equal(false);
            expect(text).to.include('No submissions found');
        });

        it('handles a malformed submission id without erroring out', async function () {
            // A non-ObjectId string must not produce a server error.
            const { text } = await call('find_submissions', {
                form_name: 'customer',
                submission_id: 'this-is-not-an-object-id',
            });
            expect(text).to.include('No submissions found');
        });

        it('refuses to update a submission that does not exist', async function () {
            const { isError, text } = await call('submission_update', {
                form_name: 'customer',
                submission_id: '000000000000000000000000',
                updates: [{ data_path: 'firstName', new_value: 'Ghost' }],
            });
            expect(isError).to.equal(true);
            expect(text).to.include('was not found');
        });

        it('leaves the stored value untouched when an update is invalid', async function () {
            const submission = await formio.createSubmission('application', {
                firstName: 'Partial', lastName: 'Write', email: 'partial.write@example.com',
                gpa: 3.1, essay: 'An essay.',
            });
            const { isError } = await call('submission_update', {
                form_name: 'application',
                submission_id: submission._id,
                updates: [{ data_path: 'gpa', new_value: 'not a number' }],
            });
            expect(isError).to.equal(true);
            // The rejected update must not have partially written.
            const after = await formio.getSubmission('application', submission._id);
            expect(after.data.gpa).to.equal(3.1);
        });
    });

    describe('agentic workflow misconfiguration', function () {
        it('refuses agent_provide_data for a submission that does not exist', async function () {
            const { isError, text } = await call('agent_provide_data', {
                form_name: 'application',
                submission_id: '000000000000000000000000',
                persona: 'application',
            });
            expect(isError).to.equal(true);
            expect(text).to.include('was not found');
        });

        it('explains the uag configuration when the persona does not exist', async function () {
            const submission = await formio.createSubmission('application', {
                firstName: 'Wrong', lastName: 'Persona', email: 'wrong.persona@example.com',
                gpa: 3.2, essay: 'An essay.',
            });
            const { isError, text } = await call('agent_provide_data', {
                form_name: 'application',
                submission_id: submission._id,
                persona: 'noSuchPersona',
            });
            expect(isError).to.equal(true);
            expect(text).to.include('uagField="criteria"');
            expect(text).to.include('uag="noSuchPersona"');
        });

        it('explains the uag configuration for a form with no agent fields', async function () {
            const submission = await formio.createSubmission('customer', {
                firstName: 'No', lastName: 'Uag', email: 'no.uag@example.com', referralSource: 'web',
            });
            const { isError, text } = await call('agent_provide_data', {
                form_name: 'customer',
                submission_id: submission._id,
            });
            expect(isError).to.equal(true);
            expect(text).to.include('uagField="criteria"');
        });
    });

    describe('authentication', function () {
        it('rejects a malformed bearer token', async function () {
            const resp = await fetch(`${UAG_URL}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    Authorization: 'Bearer not.a.real.token',
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
            });
            expect(resp.status).to.equal(401);
        });

        it('rejects a token signed with the wrong secret', async function () {
            const jwt = await import('jsonwebtoken');
            const forged = jwt.default.sign({ sub: 'forged' }, 'not-the-jwt-secret');
            const resp = await fetch(`${UAG_URL}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    Authorization: `Bearer ${forged}`,
                },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
            });
            expect(resp.status).to.equal(401);
        });
    });
});
