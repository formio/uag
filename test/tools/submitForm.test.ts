import { expect } from 'chai';
import { submitCompletedForm } from '../../src/tools/submitForm';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('submitForm tool', () => {
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
          convertToSubmission: (data: any) => ({ data }),
          formatFormDataForDisplay: (data: any) => Object.entries(data).map(([k, v]) => ({ path: k, value: v })),
          submit: async (submission: any, authInfo: any) => ({
            _id: 'sub123',
            data: submission.data,
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        };
      }
      return null;
    };

    tool = await submitCompletedForm(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('submit_completed_form');
    expect(tool.title).to.equal('Submit Completed Form');
  });

  it('has inputSchema requiring form_name and current_data', () => {
    expect(tool.inputSchema).to.have.property('form_name');
    expect(tool.inputSchema).to.have.property('current_data');
  });

  it('returns formNotFound for non-existent form', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'nonexistent',
      current_data: {}
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.formNotFound);
    expect(result.isError).to.be.true;
  });

  it('submits form successfully', async () => {
    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      current_data: { name: 'John', email: 'john@example.com' }
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.formSubmitted);
    expect(result.data.submissionId).to.equal('sub123');
    expect(result.data.submittedFieldsCount).to.equal(2);
  });

  it('handles validation errors during submission', async () => {
    project.getForm = async () => ({
      form: { name: 'testform' },
      convertToSubmission: (data: any) => ({ data }),
      formatFormDataForDisplay: (data: any) => [],
      submit: async () => {
        const error: any = new Error('Validation failed');
        error.name = 'ValidationError';
        error.details = [{
          message: 'Name is required',
          context: { label: 'Name', path: 'name' }
        }];
        throw error;
      }
    });

    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      current_data: {}
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submitValidationError);
    expect(result.isError).to.be.true;
    expect(result.data.validationErrors).to.be.an('array');
    expect(result.data.validationErrors[0].message).to.equal('Name is required');
  });

  it('handles null submission response', async () => {
    project.getForm = async () => ({
      form: { name: 'testform' },
      convertToSubmission: (data: any) => ({ data }),
      formatFormDataForDisplay: (data: any) => [],
      submit: async () => null
    });

    const extra = { authInfo: {} };
    const result = await tool.execute({
      form_name: 'testform',
      current_data: { name: 'John' }
    }, extra);
    expect(result.template).to.equal(ResponseTemplate.submitValidationError);
    expect(result.isError).to.be.true;
  });
});
