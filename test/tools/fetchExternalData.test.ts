import { expect } from 'chai';
import { fetchExternalData } from '../../src/tools/fetchExternalData';
import { ResponseTemplate } from '../../src/template';
import { MockProjectInterface, MockFormInterface } from './mock';

describe('fetchExternalData Tool', () => {
    let mockProject: any;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async () => {
        mockAuthInfo = {
            token: 'test-token',
            formPermissions: () => ({ create: true, read: true, update: true })
        };
        mockProject = new MockProjectInterface({
            selectTest: {
                title: 'Select Test Form',
                name: 'selectTest',
                tags: ['uag'],
                components: [
                    {
                        type: 'textfield',
                        key: 'name',
                        label: 'Name',
                        input: true,
                        validate: { required: true }
                    },
                    {
                        type: 'select',
                        key: 'urlSelect',
                        label: 'URL Select',
                        input: true,
                        dataSrc: 'url',
                        data: {
                            url: 'https://api.example.com/items',
                            headers: [
                                { key: 'Accept', value: 'application/json' }
                            ]
                        },
                        valueProperty: 'id',
                        template: '<span>{{ item.name }}</span>',
                        searchField: 'name',
                        selectValues: 'results',
                        limit: 50,
                        authenticate: false,
                        validate: { required: true }
                    },
                    {
                        type: 'select',
                        key: 'resourceSelect',
                        label: 'Resource Select',
                        input: true,
                        dataSrc: 'resource',
                        data: {
                            resource: 'res123abc'
                        },
                        valueProperty: 'data.email',
                        template: '<span>{{ item.firstName }}</span>',
                        searchField: 'firstName',
                        validate: { required: false }
                    },
                    {
                        type: 'select',
                        key: 'staticSelect',
                        label: 'Static Select',
                        input: true,
                        dataSrc: 'values',
                        data: {
                            values: [
                                { label: 'Option A', value: 'a' },
                                { label: 'Option B', value: 'b' }
                            ]
                        }
                    },
                    {
                        type: 'radio',
                        key: 'radioField',
                        label: 'Radio Field',
                        input: true,
                        values: [
                            { label: 'Yes', value: 'yes' },
                            { label: 'No', value: 'no' }
                        ]
                    }
                ]
            }
        });

        // Mock getFormById for resource selects
        const resourceForm = new MockFormInterface(mockProject, {
            title: 'People Resource',
            name: 'people',
            tags: ['uag'],
            components: [
                { type: 'textfield', key: 'firstName', label: 'First Name', input: true },
                { type: 'email', key: 'email', label: 'Email', input: true }
            ]
        }, [
            { _id: 'sub1', data: { firstName: 'Alice', email: 'alice@example.com' } },
            { _id: 'sub2', data: { firstName: 'Bob', email: 'bob@example.com' } },
            { _id: 'sub3', data: { firstName: 'Charlie', email: 'charlie@example.com' } }
        ]);
        mockProject.getFormById = async (id: string) => {
            if (id === 'res123abc') return resourceForm;
            return null;
        };

        tool = await fetchExternalData(mockProject);
    });

    it('returns correct tool metadata', () => {
        expect(tool.name).to.equal('fetch_external_data');
        expect(tool.title).to.equal('Fetch External Data');
        expect(tool.description).to.include('Fetch external data');
        expect(tool.inputSchema).to.exist;
        expect(tool.inputSchema).to.have.property('form_name');
        expect(tool.inputSchema).to.have.property('field_path');
        expect(tool.inputSchema).to.have.property('form_data');
        expect(tool.inputSchema).to.have.property('search_value');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', field_path: 'urlSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('returns error for non-existent field path', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'nonExistent' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('No component found');
    });

    it('returns error for component that does not load external data', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'name' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('does not load external data');
    });

    it('returns error for static select (dataSrc=values)', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'staticSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('does not load external data');
    });

    it('fetches resource select options successfully', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'resourceSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
        expect(result.data.options).to.be.an('array');
        expect(result.data.options.length).to.equal(3);
        expect(result.data.options[0].label).to.equal('Alice');
        expect(result.data.options[0].value).to.equal('alice@example.com');
        expect(result.data.options[1].label).to.equal('Bob');
        expect(result.data.options[1].value).to.equal('bob@example.com');
    });

    it('fetches resource select options with search filter', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'resourceSelect', search_value: 'Ali' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
        expect(result.data.options).to.be.an('array');
        expect(result.data.options.length).to.equal(1);
        expect(result.data.options[0].label).to.equal('Alice');
    });

    it('returns error when resource form is not found', async () => {
        // Override getFormById to return null
        mockProject.getFormById = async () => null;
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'resourceSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('not found');
    });

    it('interpolates filter tokens with form_data for resource selects', async () => {
        // Create a form with a resource select that has an interpolated filter
        const interpolateProject = new MockProjectInterface({
            interpolateForm: {
                title: 'Interpolate Test Form',
                name: 'interpolateForm',
                tags: ['uag'],
                components: [
                    {
                        type: 'textfield',
                        key: 'company',
                        label: 'Company',
                        input: true
                    },
                    {
                        type: 'select',
                        key: 'employee',
                        label: 'Employee',
                        input: true,
                        dataSrc: 'resource',
                        data: {
                            resource: 'employees123'
                        },
                        valueProperty: 'data.email',
                        template: '<span>{{ item.firstName }}</span>',
                        filter: 'data.company={{ data.company }}',
                        searchField: 'firstName'
                    }
                ]
            }
        });

        const employeeResource = new MockFormInterface(interpolateProject, {
            title: 'Employees',
            name: 'employees',
            tags: ['uag'],
            components: [
                { type: 'textfield', key: 'firstName', label: 'First Name', input: true },
                { type: 'email', key: 'email', label: 'Email', input: true },
                { type: 'textfield', key: 'company', label: 'Company', input: true }
            ]
        }, [
            { _id: 'e1', data: { firstName: 'Alice', email: 'alice@acme.com', company: 'Acme' } },
            { _id: 'e2', data: { firstName: 'Bob', email: 'bob@globex.com', company: 'Globex' } },
            { _id: 'e3', data: { firstName: 'Charlie', email: 'charlie@acme.com', company: 'Acme' } }
        ]);

        interpolateProject.getFormById = async (id: string) => {
            if (id === 'employees123') return employeeResource;
            return null;
        };

        const interpolateTool = await fetchExternalData(interpolateProject);

        // Provide form_data with company = "Acme" so the filter interpolates to "data.company=Acme"
        const result = await interpolateTool.execute(
            {
                form_name: 'interpolateForm',
                field_path: 'employee',
                form_data: { company: 'Acme' }
            },
            { authInfo: mockAuthInfo }
        );

        expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
        expect(result.data.options).to.be.an('array');
        // Only Alice and Charlie work at Acme
        expect(result.data.options.length).to.equal(2);
        expect(result.data.options[0].label).to.equal('Alice');
        expect(result.data.options[0].value).to.equal('alice@acme.com');
        expect(result.data.options[1].label).to.equal('Charlie');
        expect(result.data.options[1].value).to.equal('charlie@acme.com');
    });

    it('works without form_data when no interpolation tokens exist', async () => {
        // Should still work when form_data is not provided
        const result = await tool.execute(
            { form_name: 'selectTest', field_path: 'resourceSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
        expect(result.data.options).to.be.an('array');
        expect(result.data.options.length).to.equal(3);
    });
});
