import { expect } from 'chai';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, oneXModule, start, Started } from '../characterization/harness';

/**
 * Engines, MCP tools and form actions are listed in the plugin registry as
 * internal types: they keep loading their own way, and appear in
 * GET {project}/plugins with no settings values.
 */
describe('Plugin registry: engines, tools and actions listed', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    const originalWarn = console.warn;
    afterEach(async () => { console.warn = originalWarn; await started?.stop(); started = undefined; });

    async function manifest(type?: string) {
        const res = await started!.request().get(`/plugins${type ? `?type=${type}` : ''}`).set('x-admin-key', ADMIN_KEY);
        expect(res.status, res.text).to.equal(200);
        return res.body;
    }

    it('lists each engine type with its instances, kinds, what it reads and whether it generates, never its settings', async () => {
        process.env.UAG_ENGINE_SECRETIVE_API_KEY = 'listing-secret-value';
        try {
            started = await start({ config: { engines: ['triage:stub-decision', 'check:stub-decision', 'stub-agent'] } });
            const engines = await manifest('engine');
            expect(engines.map((e: any) => e.name)).to.deep.equal(['stub-decision', 'stub-agent']);
            expect(engines[0]).to.include({ type: 'engine', title: 'Stub decision engine', stability: 'stable', generate: false });
            expect(engines[0].kinds).to.deep.equal(['decision']);
            expect(engines[0].instances).to.deep.equal(['triage', 'check']);
            expect(engines[1]).to.include({ name: 'stub-agent', generate: true });
            expect(engines[1].accepts).to.deep.equal(['text']);
            expect(engines[0]).to.not.have.property('settings');
            expect(JSON.stringify(engines)).to.not.include('listing-secret-value');
        }
        finally {
            delete process.env.UAG_ENGINE_SECRETIVE_API_KEY;
        }
    });

    it('lists every MCP tool, a module\'s included, with its annotations', async () => {
        started = await start({ modules: [oneXModule()] });
        const tools = await manifest('tool');
        const names = tools.map((t: any) => t.name);
        expect(names[0]).to.equal('get_forms');
        expect(names).to.include('module_lookup');
        const lookup = tools.find((t: any) => t.name === 'module_lookup');
        expect(lookup).to.include({ type: 'tool', title: 'Module lookup', description: 'Look up a record in the module\'s directory by its id.' });
        expect(lookup.annotations).to.include({ readOnlyHint: true });
        // The override reaches the listing as it reaches MCP clients.
        expect(tools.find((t: any) => t.name === 'get_forms').description).to.equal('List the CRM forms the user can use.');
    });

    it('lists form actions, and a module action replacing a built-in one is a warning, not a refusal', async () => {
        const warned: string[] = [];
        console.warn = (...args: any[]) => { warned.push(String(args[0])); };
        const webhook = {
            info: { name: 'webhook', title: 'Module webhook', description: 'Replaces the built-in webhook.', priority: 0, defaults: { handler: ['after'], method: ['create'] } },
            settingsForm: async () => [],
            executor: async () => async (req: any, res: any, next: any) => next()
        };
        started = await start({ modules: [{ actions: { webhook } }] });
        const actions = await manifest('action');
        expect(actions.map((a: any) => a.name)).to.include.members(['webhook', 'agentRunTask']);
        expect(actions.find((a: any) => a.name === 'webhook')).to.include({ title: 'Module webhook' });
        expect(actions.find((a: any) => a.name === 'agentRunTask')).to.include({ platform: false });
        expect(warned).to.include('[plugins] action:webhook from a module replaces the built-in action of the same name');
    });

    it('lists all three internal types in one manifest', async () => {
        started = await start({ config: { engines: ['stub-agent'] } });
        const types = new Set((await manifest()).map((p: any) => p.type));
        expect([...types]).to.include.members(['action', 'engine', 'tool']);
    });
});
