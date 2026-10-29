import { expect } from 'chai';
import { EngineRegistry, FormflowService, stubAgentEngine, stubDecisionEngine } from '../../src/formflow';
import { auth, makeProject, requireTestLicense } from '../agent/fixtures';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const template = require('../../demo/module/project.json');

/** The Agentic Formflow demo's claim form must stay consistent with the Agent API. */
describe('Agentic Formflow demo: the claim form', () => {
    function form() {
        const project: any = makeProject({ claim: JSON.parse(JSON.stringify(template.forms.claim)) });
        return { project, form: project.forms.claim };
    }

    it('gives the triage task its input, criteria and context', () => {
        const { form: claim } = form();
        const triage = claim.uagFields.triage;
        expect(triage.inputs).to.deep.equal(['lossDescription']);
        expect(triage.criteria).to.contain('Claim type');
        expect(triage.settings.uagContext).to.equal('policyNumber');
    });

    it('routes closed-set fields to the decision engine and open values to the agent engine', async function () {
        requireTestLicense(this);
        const { project, form: claim } = form();
        project.engines = new EngineRegistry([stubDecisionEngine({ name: 'jev' }), stubAgentEngine({ name: 'claude' })]);
        const plan = await new FormflowService(project).plan(claim, { data: { lossDescription: 'Rear-ended on I-35' }, auth, requireInput: true });
        const kinds = Object.fromEntries(plan.fields.map((f) => [f.path, f.kind]));
        expect(kinds).to.include({
            'triage.claimType': 'decision',
            'triage.injuryInvolved': 'decision',
            'triage.thirdPartyInvolved': 'decision',
            'triage.fraudSignals': 'decision',
            lossDate: 'value',
            lossLocation: 'value'
        });
        // Pages hidden by triage are not planned until triage shows them.
        expect(plan.fields.map((f) => f.path)).to.not.include('injuredName');
    });

    it('shows triage-dependent pages from the decided values', async () => {
        const { form: claim } = form();
        const hidden = await claim.getHiddenPaths({ data: { triage: { claimType: 'theft', injuryInvolved: false, claimTypeConfidence: 0.9 } } }, auth);
        expect(hidden.has('vehicle')).to.equal(true);
        expect(hidden.has('injury')).to.equal(true);
        expect(hidden.has('police')).to.equal(false);
        expect(hidden.has('confirm')).to.equal(true);

        const unsure = await claim.getHiddenPaths({ data: { triage: { claimType: 'autoCollision', injuryInvolved: true, claimTypeConfidence: 0.4 } } }, auth);
        expect(unsure.has('confirm')).to.equal(false);
        expect(unsure.has('vehicle')).to.equal(false);
        expect(unsure.has('injury')).to.equal(false);
    });

    it('routes the home, theft and vehicle pages from the claim type and the vehicle question', async () => {
        const { form: claim } = form();
        const hiddenFor = (triage: any) => claim.getHiddenPaths({ data: { triage: { claimTypeConfidence: 0.9, ...triage } } }, auth);
        const home = await hiddenFor({ claimType: 'propertyDamage' });
        expect(['home', 'vehicle', 'theft'].map((page) => home.has(page))).to.deep.equal([false, true, true]);
        const burglary = await hiddenFor({ claimType: 'theft' });
        expect(['home', 'vehicle', 'theft'].map((page) => burglary.has(page))).to.deep.equal([true, true, false]);
        expect(burglary.has('keysAccountedFor')).to.equal(true);
        const stolenCar = await hiddenFor({ claimType: 'theft', vehicleInvolved: true });
        expect(['home', 'vehicle', 'theft'].map((page) => stolenCar.has(page))).to.deep.equal([true, false, false]);
        expect(stolenCar.has('keysAccountedFor')).to.equal(false);
    });

    it('fills the pages triage shows on the follow-up request, deciding closed questions there too', async function () {
        requireTestLicense(this);
        const { project, form: claim } = form();
        project.engines = new EngineRegistry([stubDecisionEngine({ name: 'jev' }), stubAgentEngine({ name: 'claude' })]);
        const triage = { claimType: 'autoCollision', claimTypeConfidence: 0.95, vehicleInvolved: true, injuryInvolved: false, thirdPartyInvolved: true };
        const plan = await new FormflowService(project).plan(claim, { data: { lossDescription: 'Rear-ended on I-35', triage }, auth, requireInput: true });
        const kinds = Object.fromEntries(plan.fields.map((f) => [f.path, f.kind]));
        expect(kinds).to.include({ damageAreas: 'decision', drivable: 'decision', driver: 'decision', vehicle: 'value', otherPartyName: 'value', lossLocationType: 'decision' });
        expect(kinds).to.not.have.property('triage.claimType');
        expect(kinds).to.not.have.property('propertyCause');
        expect(plan.excluded).to.deep.include({ path: 'triage.claimTypeConfidence', reason: 'holds the confidence of another field', task: 'triage' });
    });

    it('re-decides triage on the server before save', () => {
        expect(template.actions['claim:triage']).to.include({ name: 'agentRunTask' });
        expect(template.actions['claim:triage'].settings).to.deep.equal({ task: 'triage', answer: 'decisions', when: 'before' });
        expect(template.actions['claim:triage'].method).to.include.members(['create', 'update']);
    });
});

describe('FNOL wizard re-decision', () => {
    before(function () { requireTestLicense(this); });

    it('re-decides an authoritative field on the hidden Confirm page', async () => {
        const project: any = makeProject({ claim: JSON.parse(JSON.stringify(template.forms.claim)) });
        project.engines = new EngineRegistry([stubDecisionEngine({
            answer: (id: string) => id.startsWith('affirm:triage.fraudSignals') ? { type: 'noul', probability: 0.3 }
                : id.startsWith('deny:triage.fraudSignals') ? { type: 'noul', probability: 0.05 } : undefined
        })]);
        const submitted = { data: { lossDescription: 'x', triage: { claimType: 'autoGlass', claimTypeConfidence: 0.95, fraudSignals: false } } };
        const { submission: saved }: any = await new FormflowService(project).runTask(project.forms.claim, 'triage', submitted, auth, { answer: 'decisions' });
        expect(saved.data.triage).to.not.have.property('fraudSignals');
        expect(saved.metadata.uag.decisions['triage.fraudSignals']).to.include({ source: 'cleared' });
    });
});
