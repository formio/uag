import { expect } from 'chai';
import { getFormFields } from '../../src/tools/getFormFields';
import { ResponseTemplate } from '../../src/template';

describe('getFormFields Tool', () => {
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
            getFields: async () => ({
                required: [
                    { path: 'firstName', label: 'First Name', type: 'textfield' },
                    { path: 'email', label: 'Email', type: 'email' }
                ],
                optional: [
                    { path: 'phone', label: 'Phone', type: 'phoneNumber' }
                ],
                rules: {
                    email: 'Must be a valid email address',
                    phone: 'Format: (999) 999-9999'
                }
            })
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

        tool = await getFormFields(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('get_form_fields');
        expect(tool.title).to.equal('Get Form Fields');
        expect(tool.description).to.include('Get detailed information about all fields');
        expect(tool.inputSchema).to.exist;
        expect(tool.execute).to.be.a('function');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
        expect(result.isError).to.be.true;
    });

    it('returns form fields successfully', async () => {
        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.form).to.equal(mockForm.form);
        expect(result.data.totalFields).to.equal(3);
        expect(result.data.totalRequired).to.equal(2);
    });

    it('includes field rules in response', async () => {
        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.rules).to.exist;
    });

    it('includes all fields (required and optional) in response', async () => {
        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.fields).to.exist;
    });

    it('includes list of required fields', async () => {
        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.requiredFields).to.exist;
    });

    it('handles forms with no fields', async () => {
        mockForm.getFields = async () => ({
            required: [],
            optional: [],
            rules: {}
        });

        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.totalFields).to.equal(0);
        expect(result.data.totalRequired).to.equal(0);
    });

    it('handles error during field extraction', async () => {
        mockForm.getFields = async () => {
            throw new Error('Failed to extract fields');
        };

        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFieldsError);
        expect(result.isError).to.be.true;
        expect(result.data.error).to.include('Failed to extract fields');
    });

    it('passes authInfo to form.getFields', async () => {
        let passedAuthInfo: any = null;
        mockForm.getFields = async (submission: any, authInfo: any) => {
            passedAuthInfo = authInfo;
            return { required: [], optional: [], rules: {} };
        };

        await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(passedAuthInfo).to.equal(mockAuthInfo);
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                get_form_fields: {
                    name: 'custom_get_fields',
                    description: 'Custom field getter'
                }
            }
        };

        const customTool = await getFormFields(mockProject);
        expect(customTool.name).to.equal('custom_get_fields');
        expect(customTool.description).to.equal('Custom field getter');
    });
});
