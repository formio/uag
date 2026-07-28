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
        expect(result.data.submissions.length).to.equal(1);
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
        expect(result.data.submissions.length).to.equal(1);
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
        expect(result.data.submissions.length).to.equal(1);
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
        expect(result.data.submissions.length).to.equal(2);
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

    it('finds submissions with starts_with operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'starts_with', search_value: 'Jo' }],
                fields_requested: ['firstName']
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0].data[0].value).to.equal('John');
    });

    it('finds submissions with ends_with operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'ends_with', search_value: 'ne' }],
                fields_requested: ['firstName']
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0].data[0].value).to.equal('Jane');
    });

    it('finds submissions with not_equals operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'not_equals', search_value: 'John' }],
                fields_requested: ['firstName']
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0].data[0].value).to.equal('Jane');
    });

    it('finds submissions with in operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'in', search_value: 'John,Jane' }],
                fields_requested: ['firstName']
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(2);
    });

    it('finds submissions with nin operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'nin', search_value: 'John' }],
                fields_requested: ['firstName']
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions.length).to.equal(1);
        expect(result.data.submissions[0].data[0].value).to.equal('Jane');
    });

    it('returns error for unsupported operator', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'invalid_op', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
        expect(result.data.error).to.include('Unsupported operator');
    });

    it('returns submissionPartialIdNotFound for non-matching partial ID', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'J' }],
                submission_id_partial: 'zzzz'
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionPartialIdNotFound);
    });

    it('returns submissionPartialIdAmbiguous for ambiguous partial ID', async () => {
        // Both IDs contain 'abcd' - create submissions with overlapping partial IDs
        const ambiguousProject = new MockProjectInterface({
            testForm: {
                title: 'Test Form',
                name: 'testForm',
                tags: ['uag'],
                components: [
                    { path: 'firstName', label: 'First Name', type: 'textfield', validate: { required: true } }
                ]
            }
        }, {
            testForm: [
                { _id: 'aaa1abcd', created: '2025-01-01', modified: '2025-01-01', data: { firstName: 'Alice' } },
                { _id: 'bbb2abcd', created: '2025-01-02', modified: '2025-01-02', data: { firstName: 'Bob' } },
                { _id: 'ccc3efgh', created: '2025-01-03', modified: '2025-01-03', data: { firstName: 'Charlie' } }
            ]
        });
        const ambiguousTool = await findSubmission(ambiguousProject);
        const result = await ambiguousTool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'regex', search_value: '.' }],
                submission_id_partial: 'abcd'
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionPartialIdAmbiguous);
    });

    it('returns empty data arrays when no fields_requested', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                search_query: [{ data_path: 'firstName', operator: 'contains', search_value: 'John' }]
            },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionsFound);
        expect(result.data.submissions[0].data).to.deep.equal([]);
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

    describe('literal search values', () => {
        let literalTool: any;

        beforeEach(async () => {
            const literalProject = new MockProjectInterface({
                testForm: {
                    title: 'Test Form',
                    name: 'testForm',
                    tags: ['uag'],
                    components: [
                        { path: 'email', label: 'Email', type: 'email' },
                        { path: 'ref', label: 'Reference', type: 'textfield' }
                    ]
                }
            }, {
                testForm: [
                    { _id: 'aaa1111', created: '2025-01-01', modified: '2025-01-01', data: { email: 'joe.thompson@example.com', ref: 'a/b' } },
                    { _id: 'bbb2222', created: '2025-01-02', modified: '2025-01-02', data: { email: 'joeXthompson@exampleZcom', ref: 'plain' } },
                    { _id: 'ccc3333', created: '2025-01-03', modified: '2025-01-03', data: { email: 'someone@elsewhere.test', ref: '[bracket]' } }
                ]
            });
            literalTool = await findSubmission(literalProject);
        });

        const search = (operator: string, search_value: string, data_path = 'email') => literalTool.execute(
            { form_name: 'testForm', search_query: [{ data_path, operator, search_value }], fields_requested: [data_path] },
            { authInfo: mockAuthInfo }
        );

        it('treats dots in a contains value as literal dots', async () => {
            const result = await search('contains', 'joe.thompson@example.com');
            expect(result.template).to.equal(ResponseTemplate.submissionsFound);
            // Unescaped, every dot would be a wildcard and joeXthompson@exampleZcom
            // would match too, which is what made a new address look like a duplicate.
            expect(result.data.submissions.length).to.equal(1);
            expect(result.data.submissions[0]._id).to.equal('aaa1111');
        });

        it('does not match a similar value through wildcards', async () => {
            const result = await search('contains', 'joe.thompson@example.co');
            expect(result.data.submissions.length).to.equal(1);
            expect(result.data.submissions[0]._id).to.equal('aaa1111');
        });

        it('matches a value containing a forward slash', async () => {
            const result = await search('contains', 'a/b', 'ref');
            expect(result.template).to.equal(ResponseTemplate.submissionsFound);
            expect(result.data.submissions.length).to.equal(1);
            expect(result.data.submissions[0]._id).to.equal('aaa1111');
        });

        it('matches a value containing regex metacharacters', async () => {
            const result = await search('contains', '[bracket]', 'ref');
            expect(result.template).to.equal(ResponseTemplate.submissionsFound);
            expect(result.data.submissions.length).to.equal(1);
            expect(result.data.submissions[0]._id).to.equal('ccc3333');
        });

        it('does not widen the search when the value is not a valid pattern', async () => {
            // A bare "[" cannot compile, and the server drops a filter it cannot
            // compile, so this must not come back as every submission.
            const result = await search('contains', '[');
            expect(result.template).to.equal(ResponseTemplate.noSubmissionsFound);
        });

        it('anchors starts_with without treating the value as a pattern', async () => {
            const result = await search('starts_with', 'joe.thompson');
            expect(result.data.submissions.length).to.equal(1);
            expect(result.data.submissions[0]._id).to.equal('aaa1111');
        });

        it('anchors ends_with without treating the value as a pattern', async () => {
            const result = await search('ends_with', '@example.com');
            expect(result.data.submissions.length).to.equal(1);
            expect(result.data.submissions[0]._id).to.equal('aaa1111');
        });

        it('still treats a regex operator value as a pattern', async () => {
            const result = await search('regex', 'joe.thompson@example.com');
            expect(result.template).to.equal(ResponseTemplate.submissionsFound);
            // Opting into regex keeps the wildcard behaviour, so both records match.
            expect(result.data.submissions.length).to.equal(2);
        });

        it('reports an invalid regex instead of silently searching everything', async () => {
            const result = await search('regex', '[');
            expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
            expect(result.data.error).to.contain('not a valid regular expression');
        });
    });
});
