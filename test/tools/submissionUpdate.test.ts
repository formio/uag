import { expect } from 'chai';
import { submissionUpdate } from '../../src/tools/submissionUpdate';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('submissionUpdate tool', () => {
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
    project.uagTemplate = {
      renderTemplate: (name: string, data: any) => `rendered:${name}`
    };
    project.getForm = async (name: string) => {
      if (name === 'testform') {
        return {
          form: { name: 'testform', title: 'Test Form' },
          loadSubmission: async (id: string, authInfo: any) => {
            if (id === 'sub123') {
              return {
                _id: 'sub123',
                data: { name: 'John Doe', email: 'old@test.com' },
                created: '2024-01-01',
                modified: '2024-01-01'
              };
            }
            return null;
          },
          submit: async (submission: any, authInfo: any) => ({
            ...submission,
            modified: '2024-01-02'
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

    tool = await submissionUpdate(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('submission_update');
    expect(tool.title).to.equal('Submission Update');
    expect(tool.description).to.include('Apply multiple planned field updates');
  });

  it('has inputSchema with required fields', () => {
    expect(tool.inputSchema).to.have.property('form_name');
    expect(tool.inputSchema).to.have.property('submission_id');
    expect(tool.inputSchema).to.have.property('update_plan');
  });

  it('returns formNotFound for non-existent form', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'nonexistent',
      submission_id: 'sub123',
      update_plan: []
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.formNotFound);
    expect(result.isError).to.be.true;
  });

  it('returns submissionNotFound for non-existent submission', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      submission_id: 'nonexistent',
      update_plan: []
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionNotFound);
    expect(result.isError).to.be.true;
  });

  it('updates submission successfully', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      submission_id: 'sub123',
      update_plan: [
        { field_path: 'email', field_label: 'Email', new_value: 'new@test.com' },
        { field_path: 'phone', field_label: 'Phone', new_value: '555-1234' }
      ]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionUpdated);
    expect(result.data.submissionId).to.equal('sub123');
    expect(result.data.totalFieldsUpdated).to.equal(2);
    expect(result.data.updateSummary).to.be.an('array');
    expect(result.data.updateSummary[0].field_path).to.equal('email');
    expect(result.data.updateSummary[0].new_value).to.equal('new@test.com');
  });

  it('tracks previous values in update summary', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      submission_id: 'sub123',
      update_plan: [
        { field_path: 'email', field_label: 'Email', new_value: 'updated@test.com' }
      ]
    }, extra);
    expect(result.data.updateSummary[0].previous_value).to.equal('old@test.com');
    expect(result.data.updateSummary[0].new_value).to.equal('updated@test.com');
  });

  it('handles submission update errors', async () => {
    project.getForm = async () => ({
      form: { name: 'testform' },
      loadSubmission: async () => ({ _id: 'sub123', data: {} }),
      submit: async () => {
        throw new Error('Update failed');
      },
      formatSubmission: (sub: any) => sub
    });

    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      submission_id: 'sub123',
      update_plan: [{ field_path: 'name', field_label: 'Name', new_value: 'New Name' }]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionUpdateError);
    expect(result.isError).to.be.true;
    expect(result.data.error).to.equal('Update failed');
  });

  it('handles null submission response after update', async () => {
    project.getForm = async () => ({
      form: { name: 'testform' },
      loadSubmission: async () => ({ _id: 'sub123', data: {} }),
      submit: async () => null,
      formatSubmission: (sub: any) => sub
    });

    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      submission_id: 'sub123',
      update_plan: [{ field_path: 'name', field_label: 'Name', new_value: 'Test' }]
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submissionUpdateError);
    expect(result.isError).to.be.true;
  });
});
