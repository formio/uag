import { expect } from 'chai';
import { agentProvide, agentProvideData } from '../../src/tools/agentProvide';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface, MockFormInterface } from './mock';
import { requireTestLicense } from '../agent/fixtures';

describe('agent_provide tool', () => {
    let mockProject: MockProjectInterface;
    let mockForm: MockFormInterface;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async function () {
        // Agentic workflow over MCP needs a license; only the refusal and the metadata do not.
        const test = this.currentTest;
        if (test?.parent?.title !== 'without a license' && test?.title !== 'returns correct tool metadata') {
            requireTestLicense(this);
        }
        mockAuthInfo = {
            formPermissions: () => ({ create: true, read: true, update: true })
        };

        mockProject = new MockProjectInterface({
            testForm: {
                title: 'Test Form',
                name: 'testForm',
                tags: ['uag'],
                components: [
                    {
                        key: 'firstName',
                        label: 'First Name',
                        type: 'textfield',
                        input: true,
                        validate: { required: true }
                    },
                    {
                        key: 'email',
                        label: 'Email',
                        type: 'email',
                        input: true,
                        validate: { required: true }
                    }
                ]
            }
        }, {
            testForm: [
                {
                    _id: 'sub123',
                    created: '2025-01-01',
                    modified: '2025-01-01',
                    data: { firstName: 'John', email: 'john@example.com' }
                }
            ]
        });

        mockForm = mockProject.forms.testForm as MockFormInterface;

        // Set up uagFields with a task
        mockForm.uagFields = {
            analyst: {
                task: 'analyst',
                criteria: 'Analyze the submission data and provide insights.',
                components: {
                    analysis: {
                        path: 'analysis',
                        label: 'Analysis',
                        type: 'textarea',
                        format: '',
                        description: 'Agent analysis output',
                        validation: {}
                    }
                }
            }
        };

        tool = await agentProvide(mockProject);
    });

    it('returns correct tool metadata', () => {
        expect(tool.name).to.equal('agent_provide');
        expect(tool.title).to.equal('Agent Provide');
        expect(tool.description).to.include('agents to process');
        expect(tool.inputSchema).to.exist;
        expect(tool.inputSchema).to.have.property('form_name');
        expect(tool.execute).to.be.a('function');
    });

    describe('without a license', () => {
        it('refuses, as an agentic workflow, before reading the form or the submission', async () => {
            mockProject.mockConfig = { license: '' };
            for (const run of [tool, await agentProvideData(mockProject as any)]) {
                const result = await run.execute({ form_name: 'testForm', submission_id: 'sub123' }, { authInfo: mockAuthInfo });
                expect(result.isError).to.equal(true);
                const body = JSON.parse(result.content[0].text);
                expect(body.code).to.equal('license_required');
                expect(body.error).to.contain('conversation forms do not need either');
            }
        });
    });

    it('returns form not found for invalid form name', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', submission_id: 'sub123' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('returns uagComponentNotFound when no UAG fields exist (no_uag)', async () => {
        mockForm.uagFields = {};
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.uagComponentNotFound);
        expect(result.data.error).to.equal('no_uag');
    });

    it('returns submissionNotFound when submission does not exist', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'nonexistent' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.submissionNotFound);
    });

    it('returns uagComponentNotFound when no criteria (no_criteria)', async () => {
        mockForm.uagFields = {
            analyst: {
                task: 'analyst',
                criteria: '',
                components: {
                    analysis: {
                        path: 'analysis',
                        label: 'Analysis',
                        type: 'textarea',
                        format: '',
                        description: '',
                        validation: {}
                    }
                }
            }
        };

        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', task: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.uagComponentNotFound);
        expect(result.data.error).to.equal('no_criteria');
    });

    it('returns uagComponentNotFound when no agent fields (no_fields)', async () => {
        mockForm.uagFields = {
            analyst: {
                task: 'analyst',
                criteria: 'Analyze the data',
                components: {}
            }
        };

        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', task: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.uagComponentNotFound);
        expect(result.data.error).to.equal('no_fields');
    });

    it('returns agentProcessData with the task, criteria, values and fields', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', task: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.agentProcessData);
        // Both names reach the template: a customized template may still render `persona`.
        expect(result.data).to.include({ task: 'analyst', persona: 'analyst' });
        expect(result.data.criteria).to.include('Analyze');
        expect(result.data.values).to.exist;
        expect(result.data.fields).to.exist;
    });

    it('uses the first task when none is named', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.agentProcessData);
        expect(result.data.task).to.equal('analyst');
    });

    it('accepts the legacy persona argument, which stays in its schema', async () => {
        expect(tool.inputSchema).to.have.property('task');
        expect(tool.inputSchema).to.have.property('persona');
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', persona: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.data.task).to.equal('analyst');
    });

    it('refuses a task and persona that disagree', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', task: 'analyst', persona: 'reviewer' },
            { authInfo: mockAuthInfo }
        );
        expect(result.isError).to.equal(true);
    });

    it('respects tool overrides from config, and those written for its earlier name', async () => {
        const withOverrides = (toolOverrides: any) => {
            const project = new MockProjectInterface({ testForm: { title: 'Test Form', name: 'testForm', tags: ['uag'], components: [] } });
            Object.defineProperty(project, 'config', { get: () => ({ toolOverrides }) });
            return project;
        };
        const own = await agentProvide(withOverrides({ agent_provide: { description: 'Custom provide' } }));
        expect(own.description).to.equal('Custom provide');
        // An override for agent_provide_data applies to agent_provide too, except a rename.
        const legacy = withOverrides({ agent_provide_data: { name: 'custom_agent_data', description: 'Custom agent data tool' } });
        const renamed = await agentProvide(legacy);
        expect(renamed.name).to.equal('agent_provide');
        expect(renamed.description).to.equal('Custom agent data tool');
        const alias = await agentProvideData(legacy);
        expect(alias.name).to.equal('custom_agent_data');
    });

    it('builds the same tools on every request from an override for its earlier name', async () => {
        const toolOverrides: any = { agent_provide_data: { description: 'Custom agent data tool' } };
        const project = new MockProjectInterface({ testForm: { title: 'Test Form', name: 'testForm', tags: ['uag'], components: [] } });
        Object.defineProperty(project, 'config', { get: () => ({ toolOverrides }) });
        // Built in getTools() order, once per request: the deprecated tool must not
        // write its title and execute into the shared override for the next request.
        for (let request = 0; request < 2; request++) {
            const provide = await agentProvide(project);
            await agentProvideData(project);
            expect(provide.title, `request ${request + 1}`).to.equal('Agent Provide');
        }
        expect(toolOverrides.agent_provide_data).to.deep.equal({ description: 'Custom agent data tool' });
    });

    describe('agent_provide_data, its deprecated name', () => {
        const realWarn = console.warn;
        afterEach(() => { console.warn = realWarn; });

        it('is served with the same arguments and answers, and says it is deprecated', async () => {
            const alias = await agentProvideData(mockProject);
            expect(alias.name).to.equal('agent_provide_data');
            expect(alias.description).to.match(/^Deprecated: use `agent_provide`/);
            expect(Object.keys(alias.inputSchema || {})).to.deep.equal(Object.keys(tool.inputSchema || {}));
            const args = { form_name: 'testForm', submission_id: 'sub123', task: 'analyst' };
            const viaAlias = await alias.execute(args, { authInfo: mockAuthInfo });
            const viaTool = await tool.execute(args, { authInfo: mockAuthInfo });
            expect(viaAlias).to.deep.equal(viaTool);
        });

        it('logs one deprecation notice for many calls', async () => {
            const warnings: string[] = [];
            console.warn = (message: any) => { warnings.push(String(message)); };
            const alias = await agentProvideData(mockProject);
            for (let i = 0; i < 3; i++) {
                await alias.execute({ form_name: 'testForm', submission_id: 'sub123', task: 'analyst' }, { authInfo: mockAuthInfo });
            }
            // At most one: the notice is logged once per process, so an earlier test may have logged it.
            const notices = warnings.filter((message) => message.includes('agent_provide_data MCP tool'));
            expect(notices.length).to.be.at.most(1);
        });
    });
});
