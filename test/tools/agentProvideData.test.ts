import { expect } from 'chai';
import { agentProvideData } from '../../src/tools/agentProvideData';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface, MockFormInterface } from './mock';

describe('agentProvideData Tool', () => {
    let mockProject: MockProjectInterface;
    let mockForm: MockFormInterface;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async () => {
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

        // Set up uagFields with a persona
        mockForm.uagFields = {
            analyst: {
                persona: 'analyst',
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

        tool = await agentProvideData(mockProject);
    });

    it('returns correct tool metadata', () => {
        expect(tool.name).to.equal('agent_provide_data');
        expect(tool.title).to.equal('Agent Provide Data');
        expect(tool.description).to.include('agents to process');
        expect(tool.inputSchema).to.exist;
        expect(tool.inputSchema).to.have.property('form_name');
        expect(tool.execute).to.be.a('function');
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
                persona: 'analyst',
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
            { form_name: 'testForm', submission_id: 'sub123', persona: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.uagComponentNotFound);
        expect(result.data.error).to.equal('no_criteria');
    });

    it('returns uagComponentNotFound when no agent fields (no_fields)', async () => {
        mockForm.uagFields = {
            analyst: {
                persona: 'analyst',
                criteria: 'Analyze the data',
                components: {}
            }
        };

        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', persona: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.uagComponentNotFound);
        expect(result.data.error).to.equal('no_fields');
    });

    it('returns agentProcessData with correct persona/criteria/values/fields', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123', persona: 'analyst' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.agentProcessData);
        expect(result.data.persona).to.equal('analyst');
        expect(result.data.criteria).to.include('Analyze');
        expect(result.data.values).to.exist;
        expect(result.data.fields).to.exist;
    });

    it('uses first persona when none specified', async () => {
        const result = await tool.execute(
            { form_name: 'testForm', submission_id: 'sub123' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.agentProcessData);
        expect(result.data.persona).to.equal('default');
    });

    it('respects tool overrides from config', async () => {
        const testFormDef = {
            title: 'Test Form',
            name: 'testForm',
            tags: ['uag'],
            components: []
        };
        const projectWithConfig = new MockProjectInterface({
            testForm: testFormDef
        });

        Object.defineProperty(projectWithConfig, 'config', {
            get: () => ({
                toolOverrides: {
                    agent_provide_data: {
                        name: 'custom_agent_data',
                        description: 'Custom agent data tool'
                    }
                }
            })
        });

        const customTool = await agentProvideData(projectWithConfig);
        expect(customTool.name).to.equal('custom_agent_data');
        expect(customTool.description).to.equal('Custom agent data tool');
    });
});
