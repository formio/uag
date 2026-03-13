import { expect } from 'chai';
import { getFieldInfo } from '../../src/tools/getFieldInfo';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface } from './mock';

describe('getFieldInfo Tool', () => {
    let mockProject: MockProjectInterface;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async () => {
        mockAuthInfo = {
            formPermissions: () => ({ create: true, read: true, update: true })
        };

        mockProject = new MockProjectInterface({
            testForm: {
                title: 'Test Form',
                name: 'testForm',
                tags: ['uag'],
                components: [
                    {
                        key: 'firstName',
                        label: 'First Name',
                        type: 'textfield',
                        input: true,
                        validate: { required: true }
                    },
                    {
                        key: 'email',
                        label: 'Email',
                        type: 'email',
                        input: true,
                        validate: { required: true }
                    },
                    {
                        key: 'phone',
                        label: 'Phone',
                        type: 'phoneNumber',
                        input: true,
                        validate: { required: false }
                    }
                ]
            }
        });

        tool = await getFieldInfo(mockProject);
    });

    it('returns correct tool metadata', () => {
        expect(tool.name).to.equal('get_field_info');
        expect(tool.title).to.equal('Get Field(s) Info');
        expect(tool.description).to.include('Get detailed information');
        expect(tool.inputSchema).to.exist;
        expect(tool.inputSchema).to.have.property('form_name');
        expect(tool.inputSchema).to.have.property('field_paths');
        expect(tool.execute).to.be.a('function');
    });

    it('returns form not found for invalid form name', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', field_paths: ['firstName'] },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('returns field info for specific field paths', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', field_paths: ['firstName'] },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.getFormFieldsInfo);
        expect(result.data.fields).to.exist;
        expect(result.data.rules).to.exist;
    });

    it('returns info for multiple field paths', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', field_paths: ['firstName', 'email'] },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.getFormFieldsInfo);
        expect(result.data.fields).to.exist;
    });

    it('includes parent label in response', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', field_paths: ['firstName'] },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.getFormFieldsInfo);
        expect(result.data.parentLabel).to.exist;
    });

    it('handles error during field extraction', async () => {
        const form = mockProject.forms.testForm as any;
        const getFields = form.getFields;
        form.getFields = async () => {
            throw new Error('Failed to extract fields');
        };

        const result = await tool.execute(
            { form_name: 'testForm', field_paths: ['firstName'] },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFieldsError);
        expect(result.data.error).to.include('Failed to extract fields');
        form.getFields = getFields;
    });

    it('respects tool overrides from config', async () => {
        const testFormDef = {
            title: 'Test Form',
            name: 'testForm',
            tags: ['uag'],
            components: []
        };
        const projectWithConfig = new MockProjectInterface({
            testForm: testFormDef
        });

        Object.defineProperty(projectWithConfig, 'config', {
            get: () => ({
                toolOverrides: {
                    get_field_info: {
                        name: 'custom_field_info',
                        description: 'Custom field info tool'
                    }
                }
            })
        });

        const customTool = await getFieldInfo(projectWithConfig);
        expect(customTool.name).to.equal('custom_field_info');
        expect(customTool.description).to.equal('Custom field info tool');
    });
});
