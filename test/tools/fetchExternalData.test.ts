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
                        template: '<span>{{ item.data.firstName }}</span>',
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
        expect(tool.inputSchema).to.have.property('data_path');
        expect(tool.inputSchema).to.have.property('form_data');
        expect(tool.inputSchema).to.have.property('search_value');
    });

    it('returns form not found error for invalid form', async () => {
        const result = await tool.execute(
            { form_name: 'invalidForm', data_path: 'urlSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.formNotFound);
    });

    it('returns error for non-existent field path', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', data_path: 'nonExistent' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('No component found');
    });

    it('returns error for component that does not load external data', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', data_path: 'name' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('does not load external data');
    });

    it('returns error for static select (dataSrc=values)', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', data_path: 'staticSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('does not load external data');
    });

    it('fetches resource select options successfully', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', data_path: 'resourceSelect' },
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
            { form_name: 'selectTest', data_path: 'resourceSelect', search_value: 'Ali' },
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
            { form_name: 'selectTest', data_path: 'resourceSelect' },
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
                        template: '<span>{{ item.data.firstName }}</span>',
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
                data_path: 'employee',
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

    it('returns error for radio field (not external select)', async () => {
        const result = await tool.execute(
            { form_name: 'selectTest', data_path: 'radioField' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
        expect(result.data.error).to.include('does not load external data');
    });

    it('works without form_data when no interpolation tokens exist', async () => {
        // Should still work when form_data is not provided
        const result = await tool.execute(
            { form_name: 'selectTest', data_path: 'resourceSelect' },
            { authInfo: mockAuthInfo }
        );
        expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
        expect(result.data.options).to.be.an('array');
        expect(result.data.options.length).to.equal(3);
    });

    describe('datasource component', () => {
        let dsProject: MockProjectInterface;
        let dsTool: any;
        let originalFetch: typeof globalThis.fetch;

        beforeEach(async () => {
            originalFetch = globalThis.fetch;

            dsProject = new MockProjectInterface({
                dsForm: {
                    title: 'Datasource Form',
                    name: 'dsForm',
                    tags: ['uag'],
                    components: [
                        {
                            type: 'textfield',
                            key: 'city',
                            label: 'City',
                            input: true
                        },
                        {
                            type: 'datasource',
                            key: 'weather',
                            label: 'Weather Data',
                            input: true,
                            fetch: {
                                url: 'https://api.weather.test/data',
                                method: 'get',
                                headers: [
                                    { key: 'Accept', value: 'application/json' }
                                ]
                            }
                        },
                        {
                            type: 'datasource',
                            key: 'authData',
                            label: 'Auth Data',
                            input: true,
                            fetch: {
                                url: 'https://api.private.test/data',
                                method: 'get',
                                forwardHeaders: true
                            }
                        },
                        {
                            type: 'datasource',
                            key: 'noUrlDs',
                            label: 'No URL Datasource',
                            input: true,
                            fetch: {}
                        }
                    ]
                }
            });

            dsTool = await fetchExternalData(dsProject);
        });

        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        it('fetches datasource data successfully with array response', async () => {
            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => [
                    { temp: 72, condition: 'sunny' },
                    { temp: 65, condition: 'cloudy' }
                ]
            })) as any;

            const result = await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
            expect(result.data.options).to.equal(false);
            expect(result.data.label).to.equal('Weather Data');
            expect(result.data.dataPath).to.equal('weather');
            expect(result.data.formData).to.exist;
        });

        it('handles non-array response with results property', async () => {
            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => ({
                    results: [
                        { temp: 72, condition: 'sunny' }
                    ],
                    total: 1
                })
            })) as any;

            const result = await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
            expect(result.data.options).to.equal(false);
        });

        it('wraps single object response in array', async () => {
            globalThis.fetch = (async () => ({
                ok: true,
                json: async () => ({ temp: 72, condition: 'sunny' })
            })) as any;

            const result = await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(result.template).to.equal(ResponseTemplate.fetchExternalData);
            expect(result.data.options).to.equal(false);
        });

        it('returns error when datasource has no URL configured', async () => {
            const result = await dsTool.execute(
                { form_name: 'dsForm', data_path: 'noUrlDs' },
                { authInfo: mockAuthInfo }
            );

            expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
            expect(result.data.error).to.include('No URL configured');
        });

        it('returns error on HTTP failure', async () => {
            globalThis.fetch = (async () => ({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            })) as any;

            const result = await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(result.template).to.equal(ResponseTemplate.fetchExternalDataError);
            expect(result.data.error).to.include('HTTP 500');
        });

        it('forwards auth token when forwardHeaders is enabled', async () => {
            let capturedHeaders: any = null;
            globalThis.fetch = (async (_url: string, opts: any) => {
                capturedHeaders = opts.headers;
                return {
                    ok: true,
                    json: async () => [{ value: 'secret' }]
                };
            }) as any;

            await dsTool.execute(
                { form_name: 'dsForm', data_path: 'authData' },
                { authInfo: mockAuthInfo }
            );

            expect(capturedHeaders['x-jwt-token']).to.equal('test-token');
        });

        it('does not forward auth token when forwardHeaders is not enabled', async () => {
            let capturedHeaders: any = null;
            globalThis.fetch = (async (_url: string, opts: any) => {
                capturedHeaders = opts.headers;
                return {
                    ok: true,
                    json: async () => [{ temp: 72 }]
                };
            }) as any;

            await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(capturedHeaders['x-jwt-token']).to.be.undefined;
        });

        it('uses correct HTTP method from fetch config', async () => {
            let capturedMethod: string = '';
            globalThis.fetch = (async (_url: string, opts: any) => {
                capturedMethod = opts.method;
                return {
                    ok: true,
                    json: async () => []
                };
            }) as any;

            await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(capturedMethod).to.equal('GET');
        });

        it('calls the correct URL', async () => {
            let capturedUrl: string = '';
            globalThis.fetch = (async (url: string) => {
                capturedUrl = url;
                return {
                    ok: true,
                    json: async () => []
                };
            }) as any;

            await dsTool.execute(
                { form_name: 'dsForm', data_path: 'weather' },
                { authInfo: mockAuthInfo }
            );

            expect(capturedUrl).to.include('api.weather.test/data');
        });
    });
});
