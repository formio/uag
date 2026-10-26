import { expect } from 'chai';
import { EngineRegistry } from '../../src/formflow';
import { agentDecide } from '../../src/tools/agentDecide';
import { auth, claimForm, makeProject, requireTestLicense } from '../agent/fixtures';

describe('agent_decide tool', () => {
    before(function () { requireTestLicense(this); });

    let project: any;
    let tool: any;

    beforeEach(async () => {
        project = makeProject({ claim: claimForm() });
        project.mcpJSONResponse = (data: any, isError = false) => ({ structuredContent: data, isError });
        tool = await agentDecide(project);
    });

    it('is annotated read-only', () => {
        expect(tool.name).to.equal('agent_decide');
        expect(tool.annotations.readOnlyHint).to.equal(true);
    });

    it('returns the state, questions and mappings without calling a model', async () => {
        const result = await tool.execute({ form_name: 'claim', task: 'triage', form_data: { lossDescription: 'Someone stole my car' } }, { authInfo: auth });
        const out = result.structuredContent;
        expect(out.task).to.equal('triage');
        expect(out.state.input).to.deep.equal({ 'Tell us what happened': 'Someone stole my car' });
        expect(out.fields.map((f: any) => f.path)).to.include.members(['triage.claimType', 'triage.injuryInvolved']);
        expect(Object.keys(out.questions)).to.include.members(['choice:triage.claimType', 'choice-reversed:triage.claimType', 'mention:triage.claimType', 'affirm:triage.injuryInvolved', 'deny:triage.injuryInvolved']);
        expect(out.mappings['choice:triage.claimType']).to.include({ path: 'triage.claimType', role: 'choice' });
        expect(out.mappings['choice:triage.claimType'].values).to.deep.include({ Theft: 'theft' });
        expect(out.fields.find((f: any) => f.path === 'triage.claimType').threshold).to.equal('0.85');
    });

    it('reads a saved submission when given its id', async () => {
        project.forms.claim.submissions.push({ _id: 'sub1', data: { lossDescription: 'Hail cracked the windshield', triage: { claimType: 'autoGlass' } } });
        const result = await tool.execute({ form_name: 'claim', task: 'triage', submission_id: 'sub1' }, { authInfo: auth });
        expect(result.structuredContent.state.input['Tell us what happened']).to.equal('Hail cracked the windshield');
        // A saved submission is re-decided, so filled decision fields are included.
        expect(result.structuredContent.fields.map((f: any) => f.path)).to.include('triage.claimType');
    });

    it('reports an unknown task as an error that lists the form\'s tasks', async () => {
        const result = await tool.execute({ form_name: 'claim', task: 'decide the claim type', form_data: {} }, { authInfo: auth });
        expect(result.isError).to.equal(true);
        expect(result.structuredContent.error).to.contain('decide the claim type').and.contain('triage');
    });

    it('accepts the legacy persona argument, and refuses one that disagrees with task', async () => {
        expect(tool.inputSchema).to.have.property('task');
        expect(tool.inputSchema).to.have.property('persona');
        const legacy = await tool.execute({ form_name: 'claim', persona: 'triage', form_data: {} }, { authInfo: auth });
        expect(legacy.structuredContent.task).to.equal('triage');
        const conflict = await tool.execute({ form_name: 'claim', task: 'triage', persona: 'finance', form_data: {} }, { authInfo: auth });
        expect(conflict.isError).to.equal(true);
        expect(conflict.structuredContent.error).to.contain('"persona"');
    });

    it('reports that the license is required on an unlicensed production deployment', async () => {
        project.endpoint = 'https://forms.example.com';
        project.engines = new EngineRegistry([{ name: 'jev', kind: 'decision', model: 'jev-1', maxOptions: 255, decide: async () => ({ model: 'jev-1', answers: {} }) } as any]);
        const result = await tool.execute({ form_name: 'claim', task: 'triage', form_data: {} }, { authInfo: auth });
        expect(result.isError).to.equal(true);
        expect(result.structuredContent.code).to.equal('license_required');
        expect(result.structuredContent.error).to.contain('includes the UAG');
        expect(result.structuredContent).to.not.have.property('questions');
    });
});
