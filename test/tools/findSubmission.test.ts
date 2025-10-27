import { expect } from 'chai';
import { findSubmission } from '../../src/tools/findSubmission';
import { ResponseTemplate } from '../../src/template';

describe('findSubmission Tool', () => {
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
            loadSubmission: async (id: string) => {
                if (id === 'valid123') {
                    return {
                        _id: 'valid123',
                        created: '2025-01-01',
                        modified: '2025-01-01',
                        data: { firstName: 'John', email: 'john@example.com' }
                    };
                }
                return null;
            },
            find: async (query: any) => ({
                items: [
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
            config: {}
        };

        tool = await findSubmission(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('find_submission_by_field');
        expect(tool.title).to.equal('Find Submission by Field Data');
        expect(tool.description).to.include('Find existing form submissions');
        expect(tool.inputSchema).to.exist;
        expect(tool.execute).to.be.a('function');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            {
                form_name: 'invalidForm',
                search_query: [{ field_path: 'email', search_value: 'test@example.com' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
        expect(result.isError).to.be.true;
    });

    it('finds submissions by field value with contains operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
        expect(result.data.resultCount).to.equal(2);
    });

    it('finds submissions by field value with equals operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'email', operator: 'equals', search_value: 'john@example.com' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
    });

    it('loads submission by specific ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [],
                submission_id: 'valid123'
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions).to.be.an('array');
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0]._id).to.equal('valid123');
    });

    it('returns requested field values only', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'John' }],
                fields_requested: ['email']
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions[0].data).to.be.an('array');
    });

    it('returns no submissions found when search yields no results', async () => {
        mockForm.find = async () => ({ items: [] });

        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'NonExistent' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.noSubmissionsFound);
    });

    it('respects limit parameter', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'John' }],
                limit: 5
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
    });

    it('filters by partial submission ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'J' }],
                submission_id_partial: '1234'
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0]._id).to.include('1234');
    });

    it('handles search errors gracefully', async () => {
        mockForm.find = async () => {
            throw new Error('Database connection failed');
        };

        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
        expect(result.isError).to.be.true;
        expect(result.data.error).to.include('Database connection failed');
    });

    it('validates search query has required fields', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: '', search_value: '' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
        expect(result.isError).to.be.true;
    });

    it('includes partial ID in submission results', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ field_path: 'firstName', operator: 'contains', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions[0].partialId).to.exist;
        expect(result.data.submissions[0].partialId).to.equal('1234');
    });
});
