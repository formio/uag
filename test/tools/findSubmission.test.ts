import { expect } from 'chai';
import { findSubmission } from '../../src/tools/findSubmission';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface } from './mock';

describe('findSubmission Tool', () => {
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
                        path: 'firstName',
                        label: 'First Name',
                        type: 'textfield',
                        validate: { required: true }
                    },
                    {
                        path: 'email',
                        label: 'Email',
                        type: 'email',
                        validate: { required: true }
                    }
                ]
            }
        }, {
            testForm: [
                {
                    _id: 'abc1234',
                    created: '2025-01-01',
                    modified: '2025-01-01',
                    data: { firstName: 'John', email: 'john@example.com' }
                },
                {
                    _id: 'def5678',
                    created: '2025-01-02',
                    modified: '2025-01-02',
                    data: { firstName: 'Jane', email: 'jane@example.com' }
                }

            ]
        });
        tool = await findSubmission(mockProject);
    });

    it('returns correct tool metadata', () => {
        expect(tool.name).to.equal('find_submissions');
        expect(tool.title).to.equal('Find submissions within a form');
        expect(tool.description).to.include('Find existing form submissions');
        expect(tool.inputSchema).to.exist;
        expect(tool.inputSchema).to.have.property('form_name');
        expect(tool.inputSchema).to.have.property('search_query');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            {
                form_name: 'invalidForm',
                search_query: [{ data_path: 'email', search_value: 'test@example.com' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('Finds submissions by field value with contains operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'John' }],
                fields_requested: ['firstName', 'email']
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
        expect(result.data.resultCount).to.equal(1);
        expect(result.data.submissions[0].data).to.deep.equal([
            { path: 'firstName', value: 'John' },
            { path: 'email', value: 'john@example.com' }
        ]);
    });

    it('Finds submissions by field value with contains operator, but only returns the email.', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'John' }],
                fields_requested: ['email']
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
        expect(result.data.resultCount).to.equal(1);
        expect(result.data.submissions[0].data).to.deep.equal([
            { path: 'email', value: 'john@example.com' }
        ]);
    });

    it('finds submissions by field value with equals operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'email', operator: 'equals', search_value: 'john@example.com' }],
                fields_requested: ['firstName', 'email']
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
        expect(result.data.resultCount).to.equal(1);
        expect(result.data.submissions[0].data).to.deep.equal([
            { path: 'firstName', value: 'John' },
            { path: 'email', value: 'john@example.com' }
        ]);
    });

    it('loads submission by specific ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [],
                submission_id: 'abc1234'
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0]._id).to.equal('abc1234');
    });

    it('returns no submissions found when search yields no results', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'NonExistent' }]
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.noSubmissionsFound);
    });

    it('Finds more than one record with generic search.', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'J' }],
                fields_requested: ['firstName', 'email']
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(2);
        expect(result.data.resultCount).to.equal(2);
        expect(result.data.submissions[0].data).to.deep.equal([
            { path: 'firstName', value: 'John' },
            { path: 'email', value: 'john@example.com' }
        ]);
        expect(result.data.submissions[1].data).to.deep.equal([
            { path: 'firstName', value: 'Jane' },
            { path: 'email', value: 'jane@example.com' }
        ]);
    });

    it('filters by partial submission ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'J' }],
                submission_id_partial: '1234'
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0]._id).to.include('1234');
    });

    it('handles search errors gracefully', async () => {
        var find = mockProject.forms.testForm.find;
        mockProject.forms.testForm.find = async () => {
            throw new Error('Some Error!');
        };
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
        expect(result.data.error).to.include('Some Error!');
        mockProject.forms.testForm.find = find;
    });

    it('validates search query has required fields', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: '', search_value: '' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
    });

    it('includes partial ID in submission results', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions[0].partialId).to.exist;
        expect(result.data.submissions[0].partialId).to.equal('1234');
    });
});
