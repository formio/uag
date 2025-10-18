import { expect } from 'chai';
import { UAGFormInterface } from '../src/UAGFormInterface';

describe('UAGFormInterface', () => {
  let uag: UAGFormInterface;

  beforeEach(() => {
    // Create an instance-like object without calling the constructor which requires arguments
    uag = Object.create(UAGFormInterface.prototype) as any;
    // Minimal form skeleton used by the methods under test
    uag.form = {
      components: [
        { type: 'textfield', key: 'firstName', label: 'First Name', input: true, validate: { required: true }, placeholder: 'Enter first name' },
        { type: 'select', key: 'color', label: 'Favorite Color', input: true, data: { values: [{ label: 'Red', value: 'red' }, { label: 'Blue', value: 'blue' }] } },
        { type: 'datetime', key: 'when', label: 'When', input: true, widget: { format: 'yyyy-MM-dd' } },
        { type: 'phoneNumber', key: 'phone', label: 'Phone', input: true },
        { type: 'checkbox', key: 'agree', label: 'Agree', input: true }
      ]
    } as any;
  });

  it('returns correct component formats for known types', () => {
    const phoneFmt = uag.getComponentFormat({ type: 'phoneNumber', inputMask: '(999) 999-9999' } as any);
    expect(phoneFmt).to.equal('(999) 999-9999');

    const dateFmt = uag.getComponentFormat({ type: 'datetime', widget: { format: 'yyyy-MM-dd' } } as any);
    expect(dateFmt).to.equal('yyyy-MM-dd');

    const dayFmt = uag.getComponentFormat({ type: 'day', dayFirst: true } as any);
    expect(dayFmt).to.equal('dd/MM/yyyy');
  });

  it('getComponentInfo returns options for select components', () => {
    const selectComp = uag.getComponent('color') || uag.form.components[1];
    const info = uag.getComponentInfo(selectComp as any, 'color');
    expect(info).to.be.an('object');
    expect(info.options).to.be.an('array');
    expect(info.options![0]).to.have.property('label');
  });

  it('supportsComponent recognizes supported and unsupported types', () => {
    expect(uag.supportsComponent({ type: 'textfield' } as any)).to.be.true;
    expect(uag.supportsComponent({ type: 'unknown' } as any)).to.be.false;
  });

  it('getFields separates required and optional fields', () => {
    const fields = uag.getFields();
    // firstName is required by the component validate
    const requiredPaths = fields.required.map(f => f.path);
    expect(requiredPaths).to.include('firstName');
    // color was optional
    const optionalPaths = fields.optional.map(f => f.path);
    expect(optionalPaths).to.include('color');
  });

  it('convertToSubmission nests data according to dot paths', () => {
    const data = { 'person.name': 'Alice', 'person.age': 30 };
    const submission = uag.convertToSubmission(data) as any;
    expect(submission).to.have.property('data');
    expect(submission.data.person).to.exist;
    expect(submission.data.person.name).to.equal('Alice');
    expect(submission.data.person.age).to.equal(30);
  });

  it('formatSubmission returns readable array for a submission', () => {
    const submission = {
      _id: 'sub1',
      created: 'now',
      modified: 'now',
      data: {
        firstName: 'Bob',
        color: 'red'
      }
    } as any;
    const formatted = uag.formatSubmission(submission as any);
    expect(formatted).to.have.property('data');
    expect(formatted.data).to.be.an('array');
    const paths = formatted.data.map((d: any) => d.path);
    expect(paths).to.include('firstName');
    expect(paths).to.include('color');
  });
});
