import { expect } from 'chai';
import { submitCompletedForm } from '../../src/tools/submitForm';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface, MockFormInterface } from './mock';

describe('submitCompletedForm Tool', () => {
    let mockProject: MockProjectInterface;
    let mockForm: MockFormInterface;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async () => {
        mockAuthInfo = {
            formPermissions: () => ({ create: true, read: true, update: true })
        };
        
        const testFormDef = {
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
        };
        
        mockProject = new MockProjectInterface({
            testForm: testFormDef
        });
        
        mockForm = mockProject.forms.testForm as MockFormInterface;
        mockForm.submit = async (submission: any) => ({
            _id: 'sub123456',
            created: '2025-01-01',
            modified: '2025-01-01',
            data: submission.data
        });
        
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
            { form_name: 'invalidForm', form_data: {} },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('submits form successfully', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: {
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
                form_data: {
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
                form_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.dataSummary).to.exist;
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
        var submit = mockForm.submit;
        mockForm.submit = async () => {
            throw validationError;
        };
        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: {
                    firstName: 'John'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submitValidationError);
        expect(result.data.validationErrors).to.be.an('array');
        expect(result.data.validationErrors.length).to.equal(2);
        expect(result.data.validationErrors[0].error).to.equal('Email is required');
        mockForm.submit = submit;
    });

    it('handles generic errors during submission', async () => {
        var submit = mockForm.submit;
        mockForm.submit = async () => {
            throw new Error('Network error');
        };

        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submitValidationError);
        expect(result.data.validationErrors[0].message).to.include('Network error');
        mockForm.submit = submit;
    });

    it('converts current_data to submission format before submitting', async () => {
        let submittedData: any = null;
        var submit = mockForm.submit;
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
                form_data: {
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
        mockForm.submit = submit;
    });

    it('handles empty current_data', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.submittedFieldsCount).to.equal(0);
    });

    it('passes authInfo to form.submit', async () => {
        let passedAuthInfo: any = null;
        var submit = mockForm.submit;
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
                form_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(passedAuthInfo).to.equal(mockAuthInfo);
        mockForm.submit = submit;
    });

    it('uses original submission when form.submit returns null', async () => {
        var submit = mockForm.submit;
        mockForm.submit = async () => null as any;

        const result = await tool.execute(
            {
                form_name: 'testForm',
                form_data: {
                    firstName: 'John',
                    email: 'john@example.com'
                }
            },
            { authInfo: mockAuthInfo }
        );

        // When submit returns null, the original converted submission is used
        expect(result.template).to.equal(ResponseTemplate.formSubmitted);
        expect(result.data.data).to.exist;
        mockForm.submit = submit;
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
                    submit_completed_form: {
                        name: 'custom_submit',
                        description: 'Custom submit tool'
                    }
                }
            })
        });

        const customTool = await submitCompletedForm(projectWithConfig);
        expect(customTool.name).to.equal('custom_submit');
        expect(customTool.description).to.equal('Custom submit tool');
    });
});
