import { expect } from 'chai';
import { collectData } from '../../src/tools/collectData';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('collectData tool', () => {
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
          getComponent: (path: string) => {
            if (path === 'name') return { key: 'name', type: 'textfield', label: 'Name' };
            if (path === 'email') return { key: 'email', type: 'email', label: 'Email' };
            return null;
          },
          validateComponent: async (component: any, value: any) => ({ isValid: true }),
          getFields: (data: any) => ({
            rules: {},
            required: Object.keys(data).includes('name') ? [] : [{ path: 'name', label: 'Name' }],
            optional: []
          }),
          formatFormDataForDisplay: (data: any) => Object.entries(data).map(([k, v]) => ({ path: k, value: v }))
        };
      }
      return null;
    };

    tool = await collectData(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('collect_field_data');
    expect(tool.title).to.equal('Collect Field Data');
  });

  it('has inputSchema with form_name, field_updates, and current_data', () => {
    expect(tool.inputSchema).to.have.property('form_name');
    expect(tool.inputSchema).to.have.property('field_updates');
    expect(tool.inputSchema).to.have.property('current_data');
  });

  it('returns formNotFound for non-existent form', async () => {
    const result = await tool.execute({
      form_name: 'nonexistent',
      field_updates: [],
      current_data: {}
    });
    expect(result.template).to.equal(ResponseTemplate.formNotFound);
    expect(result.isError).to.be.true;
  });

  it('collects field data successfully', async () => {
    const result = await tool.execute({
      form_name: 'testform',
      field_updates: [{ field_path: 'name', new_value: 'John' }],
      current_data: {}
    });
    // Since name was the only required field, should indicate all fields collected or next field
    expect(result.template).to.be.oneOf([
      ResponseTemplate.fieldCollectedNext,
      ResponseTemplate.allFieldsCollected
    ]);
  });

  it('returns validation errors for invalid field', async () => {
    project.getForm = async () => ({
      getComponent: (path: string) => null, // field not found
      validateComponent: async () => ({ isValid: false, error: 'Field not found' }),
      getFields: () => ({ rules: {}, required: [], optional: [] }),
      formatFormDataForDisplay: (data: any) => []
    });

    const result = await tool.execute({
      form_name: 'testform',
      field_updates: [{ field_path: 'unknown', new_value: 'test' }],
      current_data: {}
    });
    expect(result.template).to.equal(ResponseTemplate.fieldValidationErrors);
    expect(result.data.invalidFields).to.be.an('array');
    expect(result.data.invalidFields[0].path).to.equal('unknown');
  });

  it('indicates all fields collected when no required fields remain', async () => {
    const result = await tool.execute({
      form_name: 'testform',
      field_updates: [{ field_path: 'email', new_value: 'test@example.com' }],
      current_data: { name: 'John' }
    });
    expect(result.template).to.equal(ResponseTemplate.allFieldsCollected);
  });
});
