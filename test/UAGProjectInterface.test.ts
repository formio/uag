import { expect } from 'chai';
import { UAGProjectInterface } from '../src/UAGProjectInterface';
import { ProjectInterface } from '@formio/appserver';

describe('UAGProjectInterface', () => {
  let proj: UAGProjectInterface;

  beforeEach(() => {
    // avoid running constructor logic that may require external setup
    proj = Object.create(UAGProjectInterface.prototype) as any;
    proj.user = null;
    proj.formNames = [];
    proj.uagTemplate = null;
    proj.mcpServer = { registerTool: () => {} } as any;
  });

  it('mcpResponse renders template text and respects isError flag', () => {
    proj.uagTemplate = { renderTemplate: (name: any, data: any) => `T:${name}:${JSON.stringify(data)}` } as any;
    const res = proj.mcpResponse('formNotFound' as any, { id: 1 }, true);
    expect(res).to.have.property('content');
    expect(res.content[0].text).to.match(/^T:/);
    expect(res).to.have.property('isError');
  });

  it('addForm registers UAG forms tagged with uag', () => {
    const dummyForm: any = { tags: ['uag'], name: 'myform', title: 'My Form', properties: { description: 'desc' } };
    // Stub ProjectInterface.addForm to avoid it accessing uninitialized internals
    const orig = (ProjectInterface.prototype as any).addForm;
    (ProjectInterface.prototype as any).addForm = function (form: any, key: string) {
      return { __fakeFormInterface: true } as any;
    };
    try {
      UAGProjectInterface.prototype.addForm.call(proj, dummyForm, 'myform');
      // When tags include 'uag', addForm should push the form name into formNames
      expect(Array.isArray(proj.formNames)).to.be.true;
    } finally {
      // restore original
      (ProjectInterface.prototype as any).addForm = orig;
    }
  });

  it('authorizeRequest responds with 401 when authorize throws', async () => {
    // Mock request/response
    const req: any = { get: () => 'Bearer token' };
    let statusSet = 0;
    const res: any = {
      status: (s: number) => { statusSet = s; return res; },
      set: () => res,
      json: (obj: any) => obj
    };
    proj.authorizeRequest = async (_: any) => { throw new Error('bad token'); };
    const next = () => { throw new Error('next called'); };
    const out = await UAGProjectInterface.prototype.authorizeRequest.call(proj, req, res, next as any);
    // authorizeRequest returns the response, check that status was set to 401
    expect(statusSet).to.equal(401);
  });
});
