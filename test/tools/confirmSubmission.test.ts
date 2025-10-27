import { expect } from 'chai';
import { confirmSubmission } from '../../src/tools/confirmSubmission';
import { ResponseTemplate } from '../../src/template';

describe('confirmSubmission Tool', () => {
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
            validateData: async () => [],
            getFields: async () => ({
                required: [],
                optional: [{ path: 'phone', label: 'Phone', type: 'phoneNumber' }],
                rules: {}
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

        tool = await confirmSubmission(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('confirm_form_submission');
        expect(tool.title).to.equal('Confirm Form Submission');
        expect(tool.description).to.include('Show a summary of the collected form data');
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

    it('confirms submission when all required fields are filled', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John', email: 'john@example.com' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.confirmFormSubmission);
        expect(result.data.form).to.equal(mockForm);
        expect(result.data.dataSummary).to.exist;
        expect(result.data.currentData).to.deep.equal({ firstName: 'John', email: 'john@example.com' });
    });

    it('returns validation errors for invalid data', async () => {
        mockForm.validateData = async () => [
            { path: 'email', message: 'Invalid email format' }
        ];

        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John', email: 'invalid' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldValidationErrors);
        expect(result.data.invalidFields).to.be.an('array');
        expect(result.data.invalidFields.length).to.equal(1);
    });

    it('returns field collection prompt when required fields are missing', async () => {
        mockForm.getFields = async () => ({
            required: [{ path: 'email', label: 'Email', type: 'email' }],
            optional: [],
            rules: {}
        });

        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldCollectedNext);
        expect(result.data.message).to.include('additional data that needs to be collected');
        expect(result.data.progress).to.exist;
    });

    it('includes data summary in confirmation response', async () => {
        const testData = {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com'
        };

        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: testData
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.confirmFormSubmission);
        expect(result.data.dataSummary).to.exist;
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                confirm_form_submission: {
                    name: 'custom_confirm',
                    description: 'Custom confirmation'
                }
            }
        };

        const customTool = await confirmSubmission(mockProject);
        expect(customTool.name).to.equal('custom_confirm');
        expect(customTool.description).to.equal('Custom confirmation');
    });
});
