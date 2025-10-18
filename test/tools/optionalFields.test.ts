import { expect } from 'chai';
import { optionalFields } from '../../src/tools/getOptionalFields';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('optionalFields tool', () => {
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
          getFields: (data: any) => ({
            rules: { textfield: 'text rule' },
            required: [],
            optional: [
              { path: 'phone', label: 'Phone', type: 'phoneNumber' },
              { path: 'address', label: 'Address', type: 'textarea' }
            ]
          }),
          formatFormDataForDisplay: (data: any) => Object.entries(data).map(([k, v]) => ({ path: k, value: v }))
        };
      }
      return null;
    };

    tool = await optionalFields(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('offer_optional_fields');
    expect(tool.title).to.equal('Offer Optional Fields');
    expect(tool.description).to.include('optional fields');
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

  it('offers optional fields successfully', async () => {
    const result = await tool.execute({
      form_name: 'testform',
      current_data: { name: 'John' }
    });
    expect(result.template).to.equal(ResponseTemplate.offerOptionalFields);
    expect(result.data.totalOptionalFields).to.equal(2);
    expect(result.data.optionalFields).to.include('rendered:fieldList');
  });

  it('includes data summary in response', async () => {
    const result = await tool.execute({
      form_name: 'testform',
      current_data: { name: 'John', email: 'john@test.com' }
    });
    expect(result.data.dataSummary).to.include('rendered:collectedData');
  });
});
