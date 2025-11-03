import { expect } from 'chai';
import { getFormFields } from '../../src/tools/getFormFields';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface } from './mock';

describe('getFormFields Tool', () => {
    let mockProject: any;
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
    });

    it('Returns all form fields successfully', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                criteria: 'all'
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.totalFields).to.equal(3);
        expect(result.data.totalType).to.equal(3);
        expect(result.data.totalCollected).to.equal(0);
        expect(result.data.totalTypeCollected).to.equal(0);
        expect(result.data.type).to.equal('All');
    });

    it('Returns required form fields successfully', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                criteria: 'required'
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.totalFields).to.equal(3);
        expect(result.data.totalType).to.equal(2);
        expect(result.data.totalCollected).to.equal(0);
        expect(result.data.totalTypeCollected).to.equal(0);
        expect(result.data.type).to.equal('Required');
    });

    it('Returns the optional fields if all required have been collected.', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                criteria: 'optional',
                form_data: { firstName: 'John', email: 'john@example.com' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.totalFields).to.equal(3);
        expect(result.data.totalType).to.equal(1);
        expect(result.data.totalCollected).to.equal(2);
        expect(result.data.totalTypeCollected).to.equal(0);
        expect(result.data.type).to.equal('Optional');
    });

    it('Includes field rules in response', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', criteria: 'required' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.rules).to.exist;
    });

    it('includes all fields (required and optional) in response', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', criteria: 'all' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.fieldList).to.exist;
    });

    it('includes list of required fields', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', criteria: 'required' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFields);
        expect(result.data.fieldList).to.exist;
    });

    it('handles forms with no fields', async () => {
        const tempTool = await getFormFields(new MockProjectInterface({
            testForm: {
                title: 'Test Form',
                name: 'testForm',
                tags: ['uag'],
                components: []
            }
        }));

        const result = await tempTool.execute(
            { form_name: 'testForm', criteria: 'all' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFieldsEmpty);
    });

    it('handles error during field extraction', async () => {
        const getFields = mockProject.forms.testForm.getFields;
        mockProject.forms.testForm.getFields = async () => {
            throw new Error('Failed to extract fields');
        };
        ``
        const result = await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.getFormFieldsError);
        expect(result.data.error).to.include('Failed to extract fields');
        mockProject.forms.testForm.getFields = getFields;
    });

    it('passes authInfo to form.getFields', async () => {
        let passedAuthInfo: any = null;
        const getFields = mockProject.forms.testForm.getFields;
        mockProject.forms.testForm.getFields = async (submission: any, authInfo: any) => {
            passedAuthInfo = authInfo;
            return { required: [], optional: [], rules: {} };
        };

        await tool.execute(
            { form_name: 'testForm' },
            { authInfo: mockAuthInfo }
        );

        expect(passedAuthInfo).to.equal(mockAuthInfo);
        mockProject.forms.testForm.getFields = getFields;
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

        // Override the config getter
        Object.defineProperty(projectWithConfig, 'config', {
            get: () => ({
                toolOverrides: {
                    get_form_fields: {
                        name: 'custom_get_fields',
                        description: 'Custom field getter'
                    }
                }
            })
        });

        const customTool = await getFormFields(projectWithConfig);
        expect(customTool.name).to.equal('custom_get_fields');
        expect(customTool.description).to.equal('Custom field getter');
    });
});
