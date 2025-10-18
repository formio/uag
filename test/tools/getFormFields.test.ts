import { expect } from 'chai';
import { getFormFields } from '../../src/tools/getFormFields';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('getFormFields tool', () => {
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
          getFields: () => ({
            rules: { textfield: 'some rule', select: 'another rule' },
            required: [{ path: 'name', label: 'Name', type: 'textfield' }],
            optional: [{ path: 'email', label: 'Email', type: 'email' }]
          })
        };
      }
      return null;
    };

    tool = await getFormFields(project);
  });

  it('returns tool metadata with correct name', () => {
    expect(tool.name).to.equal('get_form_fields');
    expect(tool.title).to.equal('Get Form Fields');
  });

  it('has inputSchema requiring form_name', () => {
    expect(tool.inputSchema).to.have.property('form_name');
  });

  it('returns formNotFound for non-existent form', async () => {
    const result = await tool.execute({ form_name: 'nonexistent' });
    expect(result.template).to.equal(ResponseTemplate.formNotFound);
    expect(result.isError).to.be.true;
  });

  it('returns form fields successfully', async () => {
    const result = await tool.execute({ form_name: 'testform' });
    expect(result.template).to.equal(ResponseTemplate.getFormFields);
    expect(result.data.form.name).to.equal('testform');
    expect(result.data.totalFields).to.equal(2);
    expect(result.data.totalRequired).to.equal(1);
  });

  it('handles errors during field extraction', async () => {
    project.getForm = async () => ({
      form: { name: 'errorform' },
      getFields: () => {
        throw new Error('Field extraction failed');
      }
    });

    const result = await tool.execute({ form_name: 'testform' });
    expect(result.template).to.equal(ResponseTemplate.getFormFieldsError);
    expect(result.isError).to.be.true;
    expect(result.data.error).to.equal('Field extraction failed');
  });
});
