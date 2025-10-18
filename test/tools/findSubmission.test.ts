import { expect } from 'chai';
import { findSubmission } from '../../src/tools/findSubmission';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('findSubmission tool', () => {
  let project: any;
  let tool: any;

  beforeEach(async () => {
    project = Object.create(UAGProjectInterface.prototype);
    project.formNames = ['testform'];
    project.mcpResponse = (template: ResponseTemplate, data: any, isError?: boolean) => ({
      template,
      data,
      isError
    });
    project.getForm = async (name: string) => {
      if (name === 'testform') {
        return {
          form: { name: 'testform', title: 'Test Form' },
          find: async (query: any, authInfo: any) => ({
            items: [
              {
                _id: 'sub123',
                data: { name: 'John Doe', email: 'john@test.com' },
                created: '2024-01-01',
                modified: '2024-01-02'
              }
            ]
          }),
          formatSubmission: (sub: any) => ({
            _id: sub._id,
            data: Object.entries(sub.data).map(([k, v]) => ({ path: k, value: v })),
            created: sub.created,
            modified: sub.modified
          })
        };
      }
      return null;
    };

    tool = await findSubmission(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('find_submission_by_field');
    expect(tool.title).to.equal('Find Submission by Field Data');
    expect(tool.description).to.include('Find existing form submissions');
  });

  it('has inputSchema with required fields', () => {
    expect(tool.inputSchema).to.have.property('form_name');
    expect(tool.inputSchema).to.have.property('search_query');
    expect(tool.inputSchema).to.have.property('fields_requested');
    expect(tool.inputSchema).to.have.property('limit');
    expect(tool.inputSchema).to.have.property('submission_id_partial');
  });

  it('returns formNotFound for non-existent form', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'nonexistent',
      search_query: []
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.formNotFound);
    expect(result.isError).to.be.true;
  });

  it('finds submissions by field value with equals operator', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: 'email', operator: 'equals', search_value: 'john@test.com' }],
      fields_requested: ['email', 'name']
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionsFound);
    expect(result.data.submissions).to.be.an('array');
    expect(result.data.submissions[0]._id).to.equal('sub123');
  });

  it('returns noSubmissionsFound when no matches', async () => {
    project.getForm = async () => ({
      form: { name: 'testform' },
      find: async () => ({ items: [] }),
      formatSubmission: (sub: any) => sub
    });

    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: 'name', operator: 'equals', search_value: 'Nobody' }]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.noSubmissionsFound);
  });

  it('validates search query structure', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: '', search_value: '' }]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
    expect(result.isError).to.be.true;
    expect(result.data.error).to.include('must include both field_path and search_value');
  });

  it('supports contains operator for substring search', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: 'name', operator: 'contains', search_value: 'John' }],
      limit: 5
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionsFound);
  });

  it('supports greater_than operator for numeric comparison', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: 'age', operator: 'greater_than', search_value: '18' }]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionsFound);
  });

  it('handles partial submission ID matching', async () => {
    project.getForm = async () => ({
      form: { name: 'testform' },
      find: async () => ({
        items: [
          { _id: 'sub123abc', data: {}, created: '', modified: '' },
          { _id: 'sub456def', data: {}, created: '', modified: '' }
        ]
      }),
      formatSubmission: (sub: any) => ({ _id: sub._id, data: [], created: sub.created, modified: sub.modified })
    });

    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: 'name', operator: 'contains', search_value: 'test' }],
      submission_id_partial: '123a'
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionsFound);
    expect(result.data.submissions).to.have.lengthOf(1);
    expect(result.data.submissions[0]._id).to.equal('sub123abc');
  });

  it('returns error for unsupported operator', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      search_query: [{ field_path: 'name', operator: 'invalid_op', search_value: 'test' }]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionSearchError);
    expect(result.isError).to.be.true;
    expect(result.data.error).to.include('Unsupported operator');
  });
});
