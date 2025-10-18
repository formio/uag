import { expect } from 'chai';
import { getForms } from '../../src/tools/getForms';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { ResponseTemplate } from '../../src/template';

describe('getForms tool', () => {
  let project: any;
  let tool: any;

  beforeEach(async () => {
    // Create minimal mock project
    project = Object.create(UAGProjectInterface.prototype);
    project.forms = {};
    project.formNames = [];
    project.mcpResponse = (template: ResponseTemplate, data: any, isError?: boolean) => ({
      template,
      data,
      isError
    });

    tool = await getForms(project);
  });

  it('returns tool metadata with correct name and description', () => {
    expect(tool.name).to.equal('get_forms');
    expect(tool.title).to.equal('Get Available Forms');
    expect(tool.description).to.include('Get a list of all available forms');
  });

  it('returns empty schema for inputSchema', () => {
    expect(tool.inputSchema).to.be.an('object');
    expect(Object.keys(tool.inputSchema)).to.have.lengthOf(0);
  });

  it('returns noFormsAvailable when no UAG forms exist', async () => {
    const extra = { authInfo: { formPermissions: () => ({}) } };
    const result = await tool.execute({}, extra);
    expect(result.template).to.equal(ResponseTemplate.noFormsAvailable);
  });

  it('returns available forms with permissions', async () => {
    // Add a UAG form to project
    project.forms = {
      testform: {
        uag: {
          name: 'testform',
          title: 'Test Form',
          description: 'A test form'
        }
      }
    };

    const extra = {
      authInfo: {
        formPermissions: () => ({ create: true, read: true, update: false })
      }
    };

    const result = await tool.execute({}, extra);
    expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
    expect(result.data.forms).to.be.an('array');
    expect(result.data.forms).to.have.lengthOf(1);
    expect(result.data.forms[0].name).to.equal('testform');
    expect(result.data.forms[0].hasAccess).to.be.true;
  });

  it('filters out non-UAG forms', async () => {
    project.forms = {
      uagForm: { uag: { name: 'uagForm', title: 'UAG Form' } },
      normalForm: { form: { name: 'normalForm' } } // no uag property
    };

    const extra = {
      authInfo: { formPermissions: () => ({ create: true }) }
    };

    const result = await tool.execute({}, extra);
    expect(result.data.forms).to.have.lengthOf(1);
    expect(result.data.forms[0].name).to.equal('uagForm');
  });
});
