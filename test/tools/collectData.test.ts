import { expect } from 'chai';
import { collectData } from '../../src/tools/collectData';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface } from './mock';

describe('collectData Tool', () => {
    let mockProject: any;
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
        });
        tool = await collectData(mockProject);
    });

    it('returns correct tool metadata', () => {
        expect(tool.name).to.equal('collect_field_data');
        expect(tool.title).to.equal('Collect Field Data');
        expect(tool.description).to.include('Collect data for a form');
        expect(tool.inputSchema).to.exist;
        expect(tool.inputSchema).to.have.property('form_name');
        expect(tool.inputSchema).to.have.property('updates');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', updates: [], form_data: {} },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('collects field data successfully and indicates next required field', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ data_path: 'firstName', new_value: 'John' }],
                form_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldCollectedNext);
        expect(result.data.message).to.equal('Form data collected successfully!');
        expect(result.data.progress).to.exist;
        expect(result.data.progress.collected).to.equal(1);
        expect(result.data.progress.total).to.equal(2);
    });

    it('merges updates with existing form_data', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ data_path: 'lastName', new_value: 'Doe' }],
                form_data: { firstName: 'John' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldCollectedNext);
        expect(result.data).to.have.property('fields');
        expect(result.data.progress).to.exist;
    });

    it('returns all fields collected when no required fields remain', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ data_path: 'email', new_value: 'john@example.com' }],
                form_data: { firstName: 'John', lastName: 'Doe' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.allFieldsCollected);
    });

    it('returns validation errors for invalid field data', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [{ data_path: 'email', new_value: 'invalid-email' }],
                form_data: { firstName: 'John', lastName: 'Doe' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldValidationErrors);
        expect(result.data).to.have.property('invalidFields');
        expect(result.data.invalidFields[0].path).to.equal('email');
    });

    it('handles multiple field updates in single call', async () => {
        const result = await tool.execute(
            {
                form_name: 'testForm',
                updates: [
                    { data_path: 'firstName', new_value: 'John' },
                    { data_path: 'lastName', new_value: 'Doe' }
                ],
                form_data: {}
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fieldCollectedNext);
        expect(result.data).to.have.property('fields');
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
        
        // Override the config getter
        Object.defineProperty(projectWithConfig, 'config', {
            get: () => ({
                toolOverrides: {
                    collect_field_data: {
                        name: 'custom_collect_data',
                        title: 'Custom Collect'
                    }
                }
            })
        });

        const customTool = await collectData(projectWithConfig);
        expect(customTool.name).to.equal('custom_collect_data');
        expect(customTool.title).to.equal('Custom Collect');
    });
});
