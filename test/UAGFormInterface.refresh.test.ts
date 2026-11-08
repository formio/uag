import { expect } from 'chai';
import { UAGFormInterface } from '../src/UAGFormInterface';
import { claimForm, makeProject } from './agent/fixtures';

// A form is set again whenever it loads, and whenever a TTL refresh or a deploy brings the
// project's new version of it.
describe('UAGFormInterface when its form is set again', () => {
    it('derives its registration and agent fields when it is constructed', () => {
        const project = makeProject({});
        const form = new UAGFormInterface(project, claimForm() as any);

        expect(form.uag).to.include({ machineName: 'claim', name: 'claim', title: 'Claim' });
        expect(form.uagFields.triage.inputs).to.deep.equal(['lossDescription']);
    });

    it('does not repeat the agent inputs', () => {
        const project = makeProject({ claim: claimForm() });
        const form = project.forms.claim as UAGFormInterface;

        form.setForm(claimForm() as any);
        form.setForm(claimForm() as any);

        expect(form.uagFields.triage.inputs).to.deep.equal(['lossDescription']);
    });

    it('drops the agent fields the new version no longer has', () => {
        const project = makeProject({ claim: claimForm() });
        const form = project.forms.claim as UAGFormInterface;
        expect(form.uagFields).to.have.property('triage');

        form.setForm({ ...claimForm(), components: [{ type: 'textfield', key: 'name', label: 'Name', input: true }] } as any);

        expect(form.uagFields).to.deep.equal({});
    });

    it('is no longer a UAG form once the new version drops the tag', () => {
        const project = makeProject({ claim: claimForm() });
        const form = project.forms.claim as UAGFormInterface;
        expect(project.formNames).to.deep.equal(['claim']);

        form.setForm({ ...claimForm(), tags: [] } as any);

        expect(form.uag).to.equal(null);
        expect(project.formNames).to.deep.equal([]);
    });

    it('lists each UAG form the project has once, and only while the project has it', () => {
        const project = makeProject({ claim: claimForm() });
        project.addForm(claimForm() as any, 'claim');
        project.addForm(claimForm() as any, 'claim');
        expect(project.formNames).to.deep.equal(['claim']);

        delete project.forms.claim;

        expect(project.formNames).to.deep.equal([]);
    });
});

// A task's fields are every input inside the component flagged with `uag`,
// whatever kind of layout holds them.
describe('UAGFormInterface task fields inside a flagged layout', () => {
    const form = (layout: any) => ({ _id: 'f', name: 'f', path: 'f', title: 'F', tags: ['uag'], components: [layout] });
    const a = { type: 'textfield', key: 'a', label: 'A', input: true };
    const b = { type: 'number', key: 'b', label: 'B', input: true };
    const fieldsOf = (layout: any) => Object.keys(new UAGFormInterface(makeProject({}), form(layout) as any).uagFields.t?.components || {});

    for (const [name, layout] of Object.entries({
        panel: { type: 'panel', key: 'p', input: false, components: [a, b], properties: { uag: 't' } },
        columns: { type: 'columns', key: 'cols', input: false, columns: [{ components: [a] }, { components: [b] }], properties: { uag: 't' } },
        table: { type: 'table', key: 'tbl', input: false, rows: [[{ components: [a] }, { components: [b] }]], properties: { uag: 't' } },
        tabs: { type: 'tabs', key: 'tabs', input: false, components: [{ key: 'tab1', components: [a, b] }], properties: { uag: 't' } }
    })) {
        it(`flags each input inside a ${name}`, () => {
            expect(fieldsOf(layout)).to.deep.equal(['a', 'b']);
        });
    }

    it('flags the inputs of columns nested inside a container under the container\'s path', () => {
        const container = { type: 'container', key: 'c', input: true, tree: true, components: [
            { type: 'columns', key: 'cols', input: false, columns: [{ components: [a] }, { components: [b] }], properties: { uag: 't' } }
        ] };
        expect(fieldsOf(container)).to.deep.equal(['c.a', 'c.b']);
    });
});

// Validation runs on the UAG for Run task and the Agent API, which have no database
// to expand references from.
describe('UAGFormInterface validation of a form with references', () => {
    const def = () => ({
        _id: 'f', name: 'f', path: 'f', title: 'F', tags: ['uag'], components: [
            { type: 'select', key: 'customer', label: 'Customer', input: true, dataSrc: 'resource', reference: true,
                data: { resource: '507f1f77bcf86cd799439011' }, valueProperty: '', template: '<span>{{ item.data.name }}</span>' },
            { type: 'textfield', key: 'summary', label: 'Summary', input: true, validate: { maxLength: 5 } }
        ]
    });

    it('validates a "Save as reference" select\'s stored value without throwing, and still reports other errors', async () => {
        const form = new UAGFormInterface(makeProject({}), def() as any);
        const errors = await form.validateData({ data: { customer: { _id: '507f191e810c19729de860ea', data: { name: 'Acme' } }, summary: 'Far too long' } } as any, { admin: true } as any);
        expect(errors.map((e) => e.path)).to.deep.equal(['summary']);
    });
});
