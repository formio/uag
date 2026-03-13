import { expect } from 'chai';
import { MockProjectInterface } from '../tools/mock';
import simpleForm from './simple.test.json';
import { collectData } from '../../src/tools/collectData';
describe('Simple form tests', async () => {
    const mockProject = new MockProjectInterface({ simpleForm });
    const tool = await collectData(mockProject);
    it('Should ask for all the required fields', async () => {
        const result = await tool.execute(
            {
                form_name: 'simpleForm',
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
        expect(fields.length).to.equal(3);
        expect(fields[0].path).to.equal('firstName');
        expect(fields[1].path).to.equal('lastName');
        expect(fields[2].path).to.equal('email');
    });
    it('Should not include the firstName field when it is already provided', async () => {
        const result = await tool.execute(
            {
                form_name: 'simpleForm',
                updates: [],
                form_data: {firstName: 'Joe'}
            },
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
        );
        expect(result.template).to.equal('fieldCollectedNext');
        const { fields } = JSON.parse(result.data?.fields || '{}');
        expect(fields.length).to.equal(2);
        expect(fields[0].path).to.equal('lastName');
        expect(fields[1].path).to.equal('email');
    });
    it('Should give the `allFieldsCollected` template when all fields are provided', async () => {
        const result = await tool.execute(
            {
                form_name: 'simpleForm',
                updates: [],
                form_data: {firstName: 'Joe', lastName: 'Smith', email: 'joe@example.com'}
            },
            {
                authInfo: {
                    formPermissions: () => ({ create: true, read: true, update: true })
                }
            }
        );
        expect(result.template).to.equal('allFieldsCollected');
        const summary = JSON.parse(result.data?.dataSummary || '{}');
        expect(summary.data.length).to.equal(3);
        expect(summary.data[0].path).to.equal('firstName');
        expect(summary.data[0].value).to.equal('"Joe"');
        expect(summary.data[1].path).to.equal('lastName');
        expect(summary.data[1].value).to.equal('"Smith"');
        expect(summary.data[2].path).to.equal('email');
        expect(summary.data[2].value).to.equal('"joe@example.com"');
    });
});