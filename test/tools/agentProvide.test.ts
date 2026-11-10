import { expect } from 'chai';
import { agentProvide } from '../../src/tools/agentProvide';
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
            const result = await tool.execute({ form_name: 'testForm', submission_id: 'sub123' }, { authInfo: mockAuthInfo });
            expect(result.isError).to.equal(true);
            const body = JSON.parse(result.content[0].text);
            expect(body.code).to.equal('license_required');
            expect(body.error).to.contain('conversation forms do not need either');
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
        expect(result.data).to.include({ task: 'analyst' });
        expect(result.data).to.not.have.property('persona');
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

    it('takes task, and has no persona argument', () => {
        expect(tool.inputSchema).to.have.property('task');
        expect(tool.inputSchema).to.not.have.property('persona');
    });

    it('respects tool overrides from config, and builds the same tool on every request', async () => {
        const toolOverrides: any = { agent_provide: { description: 'Custom provide' } };
        const project = new MockProjectInterface({ testForm: { title: 'Test Form', name: 'testForm', tags: ['uag'], components: [] } });
        Object.defineProperty(project, 'config', { get: () => ({ toolOverrides }) });
        for (let request = 0; request < 2; request++) {
            const provide = await agentProvide(project);
            expect(provide.name).to.equal('agent_provide');
            expect(provide.description, `request ${request + 1}`).to.equal('Custom provide');
        }
        expect(toolOverrides.agent_provide).to.deep.equal({ description: 'Custom provide' });
    });
});
