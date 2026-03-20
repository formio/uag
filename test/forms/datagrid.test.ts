import { expect } from 'chai';
import { MockProjectInterface } from '../tools/mock';
import dataGrid from './datagrid.test.json';
import { collectData } from '../../src/tools/collectData';
import { ResponseTemplate } from '../../src/template';
describe('DataGrid form tests', async () => {
    const mockProject = new MockProjectInterface({ dataGrid });
    const tool = await collectData(mockProject);
    const authInfo = {
        formPermissions: () => ({ create: true, read: true, update: true })
    };
    it('Should ask for all the required top-level fields.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
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
        expect(fields[3].path).to.equal('children');
    });
    it('Should ask for all the required fields within the datagrid if the parent is provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {},
                parent_path: 'children'
            },
            { authInfo }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(1);
        expect(fields[0].path).to.equal('children[0].childName');
    });
    it('Should return allFieldsCollected when datagrid row data is provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {children: [{childName: 'Alice'}]},
                parent_path: 'children'
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.label).to.equal('Children');
        expect(result.data.parent.isTable).to.equal(true);
        expect(result.data.parentDataPath).to.equal('children[0]');
    });
    it('Should collect a datagrid child field via updates.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [{ data_path: 'children[0].childName', new_value: 'Bob' }],
                form_data: {},
                parent_path: 'children'
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.isTable).to.equal(true);
        expect(result.data.parentDataPath).to.equal('children[0]');
    });
    it('Should handle multiple rows in the datagrid.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {
                    children: [
                        { childName: 'Alice' },
                        { childName: 'Bob' }
                    ]
                },
                parent_path: 'children'
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.isTable).to.equal(true);
    });
    it('Should collect top-level fields while datagrid remains required.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [
                    { data_path: 'firstName', new_value: 'John' },
                    { data_path: 'lastName', new_value: 'Doe' }
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
        expect(paths).to.include('children');
    });
    it('Should return allFieldsCollected when all top-level and datagrid data are provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {
                    firstName: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    children: [{ childName: 'Alice' }]
                }
            },
            { authInfo }
        );
        expect(result.template).to.equal('allFieldsCollected');
        const summary = JSON.parse(result.data?.dataSummary || '{}');
        expect(summary.data).to.be.an('array');
        expect(summary.data.length).to.be.greaterThan(0);
    });
    it('Should still require children when top-level fields are filled but datagrid is empty.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {
                    firstName: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com'
                }
            },
            { authInfo }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(1);
        expect(fields[0].path).to.equal('children');
    });
    it('Should include parent label for datagrid fields.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {},
                parent_path: 'children'
            },
            { authInfo }
        );
        expect(result.data.parentLabel).to.be.a('string');
        expect(result.data.parentLabel).to.include('Children');
    });
    it('Should return JSON response for datagrid when as_json is true.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [{ data_path: 'children[0].childName', new_value: 'Alice' }],
                form_data: {},
                parent_path: 'children',
                as_json: true
            },
            { authInfo }
        );
        expect(result.content).to.be.an('array');
        expect(result.content[0].type).to.equal('text');
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.data).to.exist;
        expect(parsed.data.children[0].childName).to.equal('Alice');
    });
});
