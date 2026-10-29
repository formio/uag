import { expect } from 'chai';

const template = require('../../demo/module/project.json');

/**
 * The demo project runs its agents with "Agent: Run task" actions, saved
 * through the UAG: no webhooks, no agentDecide, no placeholders for keys.
 */
describe('Demo project', () => {
    const actions = Object.values<any>(template.actions);

    it('runs admissions after an application is created, and finance after an update on the scholarship track', () => {
        expect(template.actions['application:admissions']).to.deep.include({
            name: 'agentRunTask', method: ['create'], handler: ['before', 'after'],
            settings: { task: 'admissions', answer: 'task', when: 'after' }
        });
        expect(template.actions['application:finance']).to.deep.include({
            name: 'agentRunTask', method: ['update'],
            settings: { task: 'finance', answer: 'task', when: 'after' },
            condition: {
                conjunction: 'all',
                conditions: [
                    { component: 'status', operator: 'isEqual', value: 'scholarshipEvaluation' },
                    { component: 'awardLevel', operator: 'isEmpty' }
                ],
                custom: ''
            }
        });
        expect(template.actions['sum:agent']).to.deep.include({ name: 'agentRunTask', settings: { task: 'agent', answer: 'task', when: 'after' } });
    });

    it('has no webhook or agentDecide actions, and no placeholders for keys or URLs', () => {
        expect(actions.map((action) => action.name)).to.not.include.members(['webhook', 'agentDecide']);
        expect(JSON.stringify(template)).to.not.match(/REPLACE_WITH_|agent\/provide/);
    });

    it('lets only the agents set their fields', () => {
        const owned: string[] = [];
        const walk = (components: any[]) => components.forEach((component) => {
            if (component.properties?.uagAuthoritative === 'true') owned.push(component.key);
            if (Array.isArray(component.components)) walk(component.components);
            if (Array.isArray(component.columns)) walk(component.columns);
        });
        walk(template.forms.application.components);
        expect(owned).to.have.members([
            'status', 'decision', 'awardLevel', 'academicsScore', 'testingScore', 'extracurricularScore',
            'leadershipScore', 'serviceScore', 'essaysScore', 'overallScore', 'agentRationale', 'financeRationale'
        ]);
    });
});
