import { expect } from 'chai';
import { collectData } from '../../src/tools/collectData';
import { ResponseTemplate } from '../../src/template';

describe('collectData Tool', () => {
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
                required: [
                    { path: 'firstName', label: 'First Name', type: 'textfield' },
                    { path: 'email', label: 'Email', type: 'email' }
                ],
                optional: [],
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

        tool = await collectData(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('collect_field_data');
        expect(tool.title).to.equal('Collect Field Data');
        expect(tool.description).to.include('Collect data for form');
        expect(tool.inputSchema).to.exist;
        expect(tool.execute).to.be.a('function');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', updates: [], current_data: {} },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
        expect(result.isError).to.be.true;
    });

    it('collects field data successfully and indicates next required field', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ path: 'firstName', value: 'John' }],
                current_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldCollectedNext);
        expect(result.data.message).to.equal('Form data collected successfully!');
        expect(result.data.progress).to.exist;
        expect(result.data.progress.collected).to.equal(1);
    });

    it('merges updates with existing current_data', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ path: 'email', value: 'john@example.com' }],
                current_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldCollectedNext);
        expect(result.data.progress.collected).to.equal(2);
    });

    it('returns all fields collected when no required fields remain', async () => {
        mockForm.getFields = async () => ({
            required: [],
            optional: [],
            rules: {}
        });

        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ path: 'email', value: 'john@example.com' }],
                current_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.allFieldsCollected);
        expect(result.data.dataSummary).to.exist;
    });

    it('returns validation errors for invalid field data', async () => {
        mockForm.validateData = async () => [
            { path: 'email', message: 'Invalid email format' }
        ];

        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ path: 'email', value: 'invalid-email' }],
                current_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldValidationErrors);
        expect(result.data.invalidFields).to.be.an('array');
        expect(result.data.invalidFields.length).to.equal(1);
    });

    it('handles multiple field updates in single call', async () => {
        // When we update both required fields, there are no required fields left
        mockForm.getFields = async () => ({
            required: [],
            optional: [],
            rules: {}
        });

        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [
                    { path: 'firstName', value: 'John' },
                    { path: 'email', value: 'john@example.com' }
                ],
                current_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.allFieldsCollected);
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                collect_field_data: {
                    name: 'custom_collect_data',
                    title: 'Custom Collect'
                }
            }
        };

        const customTool = await collectData(mockProject);
        expect(customTool.name).to.equal('custom_collect_data');
        expect(customTool.title).to.equal('Custom Collect');
    });
});
