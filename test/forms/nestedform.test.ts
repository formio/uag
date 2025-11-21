import { expect } from 'chai';
import { MockProjectInterface } from '../tools/mock';
import nestedForm from './nestedform.test.json';
import { collectData } from '../../src/tools/collectData';
describe('Nested Form tests', async () => {
    const mockProject = new MockProjectInterface({ nestedForm });
    const tool = await collectData(mockProject);
    it('Should ask for all the required top-level fields.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
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
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(1);
        expect(fields[0].path).to.equal('company.data.name');
    });
    it('Should ask for all the required fields within the nested form if the parent is provided.', async () => {
        const result = await tool.execute(
            {
                form_name: 'nestedForm',
                updates: [],
                form_data: {company: {data: {name: 'Acme Corp'}}},
                parent_path: 'company'
            },
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
        );
        expect(result.template).to.equal('allFieldsCollected');
        expect(result.data.parent.label).to.equal('Company');
        expect(result.data.parent.isForm).to.equal(true);
        expect(result.data.parentDataPath).to.equal('company.data');
    });
});