import { expect } from 'chai';
import { submissionUpdate } from '../../src/tools/submissionUpdate';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface, MockFormInterface } from './mock';

describe('submissionUpdate Tool', () => {
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

        const testSubmissions = [
            {
                _id: 'valid123',
                created: '2025-01-01',
                modified: '2025-01-01',
                data: {
                    firstName: 'John',
                    email: 'john@example.com',
                    phone: '555-1234'
                }
            }
        ];

        mockProject = new MockProjectInterface({
            testForm: testFormDef
        }, {
            testForm: testSubmissions
        });
        
        mockForm = mockProject.forms.testForm as MockFormInterface;
        mockForm.submit = async (submission: any, authInfo: any) => {
            return {
                ...submission,
                modified: '2025-01-02'
            };
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
                updates: []
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('returns submission not found error for invalid submission ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'invalid999',
                updates: []
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionNotFound);
    });

    it('updates single field successfully', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                updates: [
                    {
                        data_path: 'email',
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
                updates: [
                    {
                        data_path: 'email',
                        new_value: 'newemail@example.com'
                    },
                    {
                        data_path: 'phone',
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
                updates: [
                    {
                        data_path: 'email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
        expect(result.data.updateSummary).to.be.an('array');
        expect(result.data.updateSummary[0].data_path).to.equal('email');
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
                updates: [
                    {
                        data_path: 'person.name.first',
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
                updates: [
                    {
                        data_path: 'email',
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
                updates: [
                    {
                        data_path: 'email',
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
                updates: [
                    {
                        data_path: 'email',
                        new_value: 'invalid-email'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdateError);
        expect(result.data.error).to.include('Update failed');
    });

    it('handles null submission from submit', async () => {
        mockForm.submit = async () => null;

        const result = await tool.execute(
            {
                form_name: 'testForm',
                submission_id: 'valid123',
                updates: [
                    {
                        data_path: 'email',
                        new_value: 'newemail@example.com'
                    }
                ]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionUpdateError);
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
                updates: [
                    {
                        data_path: 'email',
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
                    submission_update: {
                        name: 'custom_update',
                        description: 'Custom update tool'
                    }
                }
            })
        });

        const customTool = await submissionUpdate(projectWithConfig);
        expect(customTool.name).to.equal('custom_update');
        expect(customTool.description).to.equal('Custom update tool');
    });
});
