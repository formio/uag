import { expect } from 'chai';
import { confirmSubmission } from '../../src/tools/confirmSubmission';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('confirmSubmission tool', () => {
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
      renderTemplate: (name: string, data: any) => `rendered:${name}:${JSON.stringify(data)}`
    };
    project.getForm = async (name: string) => {
      if (name === 'testform') {
        return {
          form: { name: 'testform', title: 'Test Form' },
          formatFormDataForDisplay: (data: any) => Object.entries(data).map(([k, v]) => ({ path: k, value: v, label: k }))
        };
      }
      return null;
    };

    tool = await confirmSubmission(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('confirm_form_submission');
    expect(tool.title).to.equal('Confirm Form Submission');
    expect(tool.description).to.include('Show a summary');
  });

  it('has inputSchema requiring form_name and current_data', () => {
    expect(tool.inputSchema).to.have.property('form_name');
    expect(tool.inputSchema).to.have.property('current_data');
  });

  it('returns formNotFound for non-existent form', async () => {
    const result = await tool.execute({
      form_name: 'nonexistent',
      current_data: {}
    });
    expect(result.template).to.equal(ResponseTemplate.formNotFound);
    expect(result.isError).to.be.true;
  });

  it('returns confirmation template with data summary', async () => {
    const result = await tool.execute({
      form_name: 'testform',
      current_data: { name: 'John', email: 'john@example.com' }
    });
    expect(result.template).to.equal(ResponseTemplate.confirmFormSubmission);
    expect(result.data.dataSummary).to.include('rendered:collectedData');
    expect(result.data.currentData).to.deep.equal({ name: 'John', email: 'john@example.com' });
  });
});
