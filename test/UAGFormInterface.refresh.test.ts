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
