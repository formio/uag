import { expect } from 'chai';
import { submissionUpdate } from '../../src/tools/submissionUpdate';
import { ResponseTemplate } from '../../src/template';

describe('submissionUpdate Tool', () => {
    let mockProject: any;
    let mockForm: any;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async () => {
        mockAuthInfo = {
            formPermissions: () => ({ create: true, read: true, update: true })
        };

        mockForm = {
            form: { title: 'Test Form', name: 'testForm' },
            loadSubmission: async (id: string) => {
                if (id === 'valid123') {
                    return {
                        _id: 'valid123',
                        created: '2025-01-01',
                        modified: '2025-01-01',
                        data: {
                            firstName: 'John',
                            email: 'john@example.com',
                            phone: '555-1234'
                        }
                    };
                }
                return null;
            },
            submit: async (submission: any) => {
                return {
                    ...submission,
                    modified: '2025-01-02'
                };
            },
            formatSubmission: (sub: any) => ({ data: Object.entries(sub.data).map(([path, value]) => ({ path, value })) })
        };

        mockProject = {
            formNames: ['testForm'],
            forms: { testForm: mockForm },
            getForm: async (name: string) => name === 'testForm' ? mockForm : null,
            mcpResponse: (template: string, data: any, isError?: boolean) => ({
                template,
                data,
                isError: !!isError
            }),
            uagTemplate: {
                renderTemplate: (template: string, data: any) => JSON.stringify(data)
            },
            config: {}
        };

        tool = await submissionUpdate(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('submission_update');
        expect(tool.title).to.equal('Submission Update');
        expect(tool.description).to.include('Apply multiple planned field updates');
        expect(tool.inputSchema).to.exist;
        expect(tool.execute).to.be.a('function');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            {
                form_name: 'invalidForm',
                submission_id: 'valid123',
                update_plan: []
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
        expect(result.isError).to.be.true;
    });

    it('returns submission not found error for invalid submission ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'invalid999',
                update_plan: []
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionNotFound);
        expect(result.isError).to.be.true;
    });

    it('updates single field successfully', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
        expect(result.data.submissionId).to.equal('valid123');
        expect(result.data.totalFieldsUpdated).to.equal(1);
    });

    it('updates multiple fields simultaneously', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    },
                    {
                        field_path: 'phone',
                        field_label: 'Phone',
                        new_value: '555-9999'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
        expect(result.data.totalFieldsUpdated).to.equal(2);
    });

    it('includes update summary with previous and new values', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
        expect(result.data.updateSummary).to.be.an('array');
        expect(result.data.updateSummary[0].field_path).to.equal('email');
        expect(result.data.updateSummary[0].new_value).to.equal('newemail@example.com');
        expect(result.data.updateSummary[0].previous_value).to.equal('john@example.com');
    });

    it('handles nested field paths', async () => {
        mockForm.loadSubmission = async () => ({
            _id: 'valid123',
            created: '2025-01-01',
            modified: '2025-01-01',
            data: {
                person: {
                    name: {
                        first: 'John',
                        last: 'Doe'
                    }
                }
            }
        });

        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'person.name.first',
                        field_label: 'First Name',
                        new_value: 'Jane'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
    });

    it('includes timestamps in response', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
        expect(result.data.created).to.exist;
        expect(result.data.modified).to.exist;
    });

    it('includes formatted data summary', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
        expect(result.data.dataSummary).to.exist;
    });

    it('handles update errors gracefully', async () => {
        mockForm.submit = async () => {
            throw new Error('Update failed: validation error');
        };

        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'invalid-email'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdateError);
        expect(result.isError).to.be.true;
        expect(result.data.error).to.include('Update failed');
    });

    it('handles null submission from submit', async () => {
        mockForm.submit = async () => null;

        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdateError);
        expect(result.isError).to.be.true;
        expect(result.data.error).to.include('Unknown error');
    });

    it('preserves existing fields not in update plan', async () => {
        let submittedData: any = null;
        mockForm.submit = async (submission: any) => {
            submittedData = submission.data;
            return {
                ...submission,
                modified: '2025-01-02'
            };
        };

        await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                update_plan: [
                    {
                        field_path: 'email',
                        field_label: 'Email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(submittedData.firstName).to.equal('John');
        expect(submittedData.phone).to.equal('555-1234');
        expect(submittedData.email).to.equal('newemail@example.com');
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                submission_update: {
                    name: 'custom_update',
                    description: 'Custom update tool'
                }
            }
        };

        const customTool = await submissionUpdate(mockProject);
        expect(customTool.name).to.equal('custom_update');
        expect(customTool.description).to.equal('Custom update tool');
    });
});
