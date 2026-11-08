/**
 * Pinning tests: a 1.x-style module.
 *
 * `server.use()` with a module in the UAG 1.x shape (`config.tools`,
 * `config.toolOverrides`, `config.responseTemplates`, `config.template`,
 * `actions`) yields the tools, actions and templates recorded here. Fixtures
 * change only on purpose (UPDATE_FIXTURES=1).
 */
import { allTools } from '../../src/agent/tools';
import { requireTestLicense } from '../agent/fixtures';
import { matchesFixture } from './fixture';
import { oneXModule, start, Started } from './harness';

describe('Pinning: 1.x-style modules', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; });

    const moduleAction = {
        info: {
            name: 'crmSync', title: 'CRM sync', group: 'default', description: 'Copies the submission to the CRM.', priority: 0,
            defaults: { handler: ['after'], method: ['create'] }, access: { handler: false, method: false }
        },
        settingsForm: async () => [{ type: 'textfield', input: true, key: 'endpoint', label: 'Endpoint' }],
        executor: async () => async (req: any, res: any, next: any) => next()
    };

    function module() {
        const base: any = oneXModule();
        base.config.responseTemplates = { formNotFound: 'No form called "<%= formName %>" here. Call get_forms to see the forms.' };
        base.config.template = {
            title: 'CRM', name: 'crm', version: '1.0.0',
            roles: {},
            resources: {},
            forms: {
                lead: { title: 'Lead', type: 'form', name: 'lead', path: 'lead', tags: ['uag'], components: [{ type: 'textfield', key: 'company', label: 'Company', input: true }] }
            },
            actions: {}
        };
        base.actions = { crmSync: moduleAction };
        return base;
    }

    it('yields the same tools, actions and templates', async () => {
        started = await start({ modules: [module()], config: { templateSync: 'off' } });
        const project: any = started.server.uagProject;
        const server: any = started.server;
        matchesFixture('modules-1x', {
            tools: (await allTools(project)).map((tool) => ({ name: tool.name, title: tool.title ?? null, description: tool.description, annotations: tool.annotations ?? null })),
            actions: Object.fromEntries(Object.entries(server.module.actions || {}).map(([name, action]: [string, any]) => [name, { title: action.info?.title, platform: !!action.platform }])),
            responses: {
                formNotFound: project.mcpResponse('formNotFound', { formName: 'invoice' }, true),
                formSubmitted: project.mcpResponse('formSubmitted', { form: { title: 'Lead' }, submissionId: 'abc123', submittedFieldsCount: 1, dataSummary: '- Company: Acme' })
            },
            template: {
                forms: Object.keys(server.config.template?.forms || {}),
                title: server.config.template?.title ?? null
            }
        });
    });
});
