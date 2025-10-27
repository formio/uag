import { expect } from 'chai';
import { submitCompletedForm } from '../../src/tools/submitForm';
import { ResponseTemplate } from '../../src/template';

describe('submitCompletedForm Tool', () => {
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
            convertToSubmission: (data: any) => ({ data }),
            submit: async (submission: any) => ({
                _id: 'sub123456',
                created: '2025-01-01',
                modified: '2025-01-01',
                data: submission.data
            }),
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

        tool = await submitCompletedForm(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('submit_completed_form');
        expect(tool.title).to.equal('Submit Completed Form');
        expect(tool.description).to.include('Submit the completed form data');
        expect(tool.inputSchema).to.exist;
        expect(tool.execute).to.be.a('function');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', current_data: {} },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
        expect(result.isError).to.be.true;
    });

    it('submits form successfully', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.submissionId).to.equal('sub123456');
        expect(result.data.submittedFieldsCount).to.equal(2);
    });

    it('includes form data in submission response', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.form).to.equal(mockForm.form);
        expect(result.data.data).to.exist;
    });

    it('includes data summary in response', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.dataSummary).to.exist;
    });

    it('handles null submission from form.submit', async () => {
        mockForm.submit = async () => null;

        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submitValidationError);
        expect(result.isError).to.be.true;
        expect(result.data.validationErrors[0]).to.equal('Unknown error during submission');
    });

    it('handles validation errors during submission', async () => {
        const validationError: any = new Error('Validation failed');
        validationError.name = 'ValidationError';
        validationError.details = [
            {
                message: 'Email is required',
                context: {
                    label: 'Email',
                    path: 'email'
                }
            },
            {
                message: 'Invalid format',
                context: {
                    label: 'Phone',
                    path: 'phone'
                }
            }
        ];

        mockForm.submit = async () => {
            throw validationError;
        };

        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submitValidationError);
        expect(result.isError).to.be.true;
        expect(result.data.validationErrors).to.be.an('array');
        expect(result.data.validationErrors.length).to.equal(2);
        expect(result.data.validationErrors[0].message).to.equal('Email is required');
    });

    it('handles generic errors during submission', async () => {
        mockForm.submit = async () => {
            throw new Error('Network error');
        };

        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submitValidationError);
        expect(result.isError).to.be.true;
        expect(result.data.validationErrors[0].message).to.include('Network error');
    });

    it('converts current_data to submission format before submitting', async () => {
        let submittedData: any = null;
        mockForm.submit = async (submission: any) => {
            submittedData = submission.data;
            return {
                _id: 'sub123456',
                created: '2025-01-01',
                modified: '2025-01-01',
                data: submission.data
            };
        };

        await tool.execute(
            {
                form_name: 'testForm',
                current_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(submittedData).to.deep.equal({
            firstName: 'John',
            email: 'john@example.com'
        });
    });

    it('handles empty current_data', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.submittedFieldsCount).to.equal(0);
    });

    it('passes authInfo to form.submit', async () => {
        let passedAuthInfo: any = null;
        mockForm.submit = async (submission: any, authInfo: any) => {
            passedAuthInfo = authInfo;
            return {
                _id: 'sub123456',
                created: '2025-01-01',
                modified: '2025-01-01',
                data: submission.data
            };
        };

        await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(passedAuthInfo).to.equal(mockAuthInfo);
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                submit_completed_form: {
                    name: 'custom_submit',
                    description: 'Custom submit tool'
                }
            }
        };

        const customTool = await submitCompletedForm(mockProject);
        expect(customTool.name).to.equal('custom_submit');
        expect(customTool.description).to.equal('Custom submit tool');
    });
});
