import { expect } from 'chai';
import { getOptionalFields } from '../../src/tools/getOptionalFields';
import { ResponseTemplate } from '../../src/template';

describe('getOptionalFields Tool', () => {
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
            getFields: async () => ({
                required: [],
                optional: [
                    { path: 'phone', label: 'Phone', type: 'phoneNumber' },
                    { path: 'address', label: 'Address', type: 'textarea' }
                ],
                rules: {
                    phone: 'Format: (999) 999-9999'
                }
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

        tool = await getOptionalFields(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('get_optional_fields');
        expect(tool.title).to.equal('Get Optional Fields');
        expect(tool.description).to.include('Show available optional fields');
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

    it('returns optional fields when all required fields are filled', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John', email: 'john@example.com' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getOptionalFields);
        expect(result.data.totalOptionalFields).to.equal(2);
        expect(result.data.optionalFields).to.exist;
    });

    it('returns required fields prompt when required fields remain', async () => {
        mockForm.getFields = async () => ({
            required: [
                { path: 'email', label: 'Email', type: 'email' }
            ],
            optional: [
                { path: 'phone', label: 'Phone', type: 'phoneNumber' }
            ],
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
        expect(result.data.message).to.include('more "required" fields');
    });

    it('includes data summary in response', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John', email: 'john@example.com' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getOptionalFields);
        expect(result.data.dataSummary).to.exist;
    });

    it('includes field rules in response', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                current_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.data.rules).to.exist;
    });

    it('handles forms with no optional fields', async () => {
        mockForm.getFields = async () => ({
            required: [],
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

        expect(result.template).to.equal(ResponseTemplate.getOptionalFields);
        expect(result.data.totalOptionalFields).to.equal(0);
    });

    it('converts current_data to submission format', async () => {
        let convertedSubmission: any = null;
        mockForm.convertToSubmission = (data: any) => {
            convertedSubmission = { data };
            return convertedSubmission;
        };

        await tool.execute(
            {
                form_name: 'testForm',
                current_data: { 'person.firstName': 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(convertedSubmission).to.exist;
        expect(convertedSubmission.data).to.deep.equal({ 'person.firstName': 'John' });
    });

    it('passes authInfo to form.getFields', async () => {
        let passedAuthInfo: any = null;
        mockForm.getFields = async (submission: any, authInfo: any) => {
            passedAuthInfo = authInfo;
            return { required: [], optional: [], rules: {} };
        };

        await tool.execute(
            {
                form_name: 'testForm',
                current_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(passedAuthInfo).to.equal(mockAuthInfo);
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                get_optional_fields: {
                    name: 'custom_optional_fields',
                    description: 'Custom optional fields'
                }
            }
        };

        const customTool = await getOptionalFields(mockProject);
        expect(customTool.name).to.equal('custom_optional_fields');
        expect(customTool.description).to.equal('Custom optional fields');
    });
});
