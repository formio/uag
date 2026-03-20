import { expect } from 'chai';
import { MockProjectInterface } from '../tools/mock';
import nestedForm from './nestedform.test.json';
import { collectData } from '../../src/tools/collectData';
import { ResponseTemplate } from '../../src/template';
describe('Nested Form tests', async () => {
    const mockProject = new MockProjectInterface({ nestedForm });
    const tool = await collectData(mockProject);
    const authInfo = {
        formPermissions: () => ({ create: true, read: true, update: true })
    };
    it('Should ask for all the required top-level fields.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {}
            },
            { authInfo }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(4);
        expect(fields[0].path).to.equal('firstName');
        expect(fields[1].path).to.equal('lastName');
        expect(fields[2].path).to.equal('email');
        expect(fields[3].path).to.equal('company');
    });
    it('Should ask for all the required fields within the nested form if the parent is provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {},
                parent_path: 'company'
            },
            { authInfo }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(1);
        expect(fields[0].path).to.equal('company.data.name');
    });
    it('Should return allFieldsCollected when nested form data is provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {company: {data: {name: 'Acme Corp'}}},
                parent_path: 'company'
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.label).to.equal('Company');
        expect(result.data.parent.isForm).to.equal(true);
        expect(result.data.parentDataPath).to.equal('company.data');
    });
    it('Should collect a nested form field via updates.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [{ data_path: 'company.data.name', new_value: 'Acme Corp' }],
                form_data: {},
                parent_path: 'company'
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.isForm).to.equal(true);
        expect(result.data.parentDataPath).to.equal('company.data');
    });
    it('Should collect top-level fields while nested form remains required.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [
                    { data_path: 'firstName', new_value: 'Jane' },
                    { data_path: 'lastName', new_value: 'Smith' }
                ],
                form_data: {}
            },
            { authInfo }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        expect(result.data.progress.collected).to.equal(2);
        const { fields } = JSON.parse(result.data?.fields || '{}');
        const paths = fields.map((f: any) => f.path);
        expect(paths).to.include('email');
        expect(paths).to.include('company');
    });
    it('Should return allFieldsCollected when all top-level and nested form data are provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {
                    firstName: 'Jane',
                    lastName: 'Smith',
                    email: 'jane@example.com',
                    'company.data.name': 'Acme Corp'
                }
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        const summary = JSON.parse(result.data?.dataSummary || '{}');
        expect(summary.data).to.be.an('array');
        expect(summary.data.length).to.be.greaterThan(0);
    });
    it('Should still require company when top-level fields are filled but nested form is empty.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {
                    firstName: 'Jane',
                    lastName: 'Smith',
                    email: 'jane@example.com'
                }
            },
            { authInfo }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(1);
        expect(fields[0].path).to.equal('company');
    });
    it('Should include parent label for nested form fields.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {},
                parent_path: 'company'
            },
            { authInfo }
        );
        expect(result.data.parentLabel).to.be.a('string');
        expect(result.data.parentLabel).to.include('Company');
    });
    it('Should return JSON response for nested form when as_json is true.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [{ data_path: 'company.data.name', new_value: 'Acme Corp' }],
                form_data: {},
                parent_path: 'company',
                as_json: true
            },
            { authInfo }
        );
        expect(result.content).to.be.an('array');
        expect(result.content[0].type).to.equal('text');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.data).to.exist;
        expect(parsed.data.company.data.name).to.equal('Acme Corp');
    });
    it('Should use correct data path prefix for nested form (company.data).', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [{ data_path: 'company.data.name', new_value: 'Test Inc' }],
                form_data: {},
                parent_path: 'company'
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        // Nested forms use the .data prefix in their data path
        expect(result.data.parentDataPath).to.equal('company.data');
        // Verify it's identified as a form type, not a table
        expect(result.data.parent.isForm).to.equal(true);
        expect(result.data.parent.isTable).to.not.exist;
    });
});
