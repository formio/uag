import { expect } from 'chai';
import { confirmSubmission } from '../../src/tools/confirmSubmission';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface } from './mock';

describe('confirmSubmission Tool', () => {
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
            { form_name: 'invalidForm', form_data: {} },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('confirms submission when all required fields are filled', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: { firstName: 'John', email: 'john@example.com' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.confirmFormSubmission);
        expect(result.data.dataSummary).to.equal(JSON.stringify({
            data: [
                {prefix:"",path:"firstName",label:"First Name",value:"\"John\""},
                {prefix:"",path:"email",label:"Email",value:"\"john@example.com\""}
            ]
        }));
    });

    it('returns validation errors for invalid data', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: { firstName: 'John', email: 'invalid' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldValidationErrors);
        expect(result.data).to.have.property('invalidFields');
        expect(result.data.invalidFields[0].path).to.equal('email');
    });

    it('returns field collection prompt when required fields are missing', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: { firstName: 'John' }
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
                form_data: testData
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.confirmFormSubmission);
        expect(result.data.dataSummary).to.exist;
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
                    confirm_form_submission: {
                        name: 'custom_confirm',
                        description: 'Custom confirmation'
                    }
                }
            })
        });

        const customTool = await confirmSubmission(projectWithConfig);
        expect(customTool.name).to.equal('custom_confirm');
        expect(customTool.description).to.equal('Custom confirmation');
    });
});
