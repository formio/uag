import { expect } from 'chai';
import { MockProjectInterface } from '../tools/mock';
import dataGrid from './datagrid.test.json';
import { collectData } from '../../src/tools/collectData';
describe('DataGrid form tests', async () => {
    const mockProject = new MockProjectInterface({ dataGrid });
    const tool = await collectData(mockProject);
    it('Should ask for all the required top-level fields.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {}
            },
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
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
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(1);
        expect(fields[0].path).to.equal('children[0].childName');
    });
    it('Should ask for all the required fields within the datagrid if the parent is provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'dataGrid',
                updates: [],
                form_data: {children: [{childName: 'Alice'}]},
                parent_path: 'children'
            },
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.label).to.equal('Children');
        expect(result.data.parent.isTable).to.equal(true);
        expect(result.data.parentDataPath).to.equal('children[0]');
    });
});