import { expect } from 'chai';
import { getForms } from '../../src/tools/getForms';
import { ResponseTemplate } from '../../src/template';

describe('getForms Tool', () => {
    let mockProject: any;
    let mockAuthInfo: any;
    let tool: any;

    beforeEach(async () => {
        mockAuthInfo = {
            formPermissions: (form: any) => ({
                create: true,
                read: true,
                update: true,
                delete: false
            })
        };

        mockProject = {
            forms: {
                testForm1: {
                    form: { title: 'Test Form 1', name: 'testForm1' },
                    uag: {
                        name: 'testForm1',
                        title: 'Test Form 1',
                        description: 'First test form'
                    }
                },
                testForm2: {
                    form: { title: 'Test Form 2', name: 'testForm2' },
                    uag: {
                        name: 'testForm2',
                        title: 'Test Form 2',
                        description: 'Second test form'
                    }
                },
                nonUagForm: {
                    form: { title: 'Non-UAG Form', name: 'nonUagForm' }
                }
            },
            mcpResponse: (template: string, data: any, isError?: boolean) => ({
                template,
                data,
                isError: !!isError
            }),
            config: {}
        };

        tool = await getForms(mockProject);
    });

    it('returns correct tool metadata', async () => {
        expect(tool.name).to.equal('get_forms');
        expect(tool.title).to.equal('Get Available Forms');
        expect(tool.description).to.include('Get a list of all available forms');
        expect(tool.inputSchema).to.exist;
        expect(tool.execute).to.be.a('function');
    });

    it('returns all UAG-enabled forms', async () => {
        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        expect(result.data.forms).to.be.an('array');
        expect(result.data.forms.length).to.equal(2);
        expect(result.data.totalForms).to.equal(2);
    });

    it('filters out non-UAG forms', async () => {
        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        const formNames = result.data.forms.map((f: any) => f.name);
        expect(formNames).to.include('testForm1');
        expect(formNames).to.include('testForm2');
        expect(formNames).to.not.include('nonUagForm');
    });

    it('includes form permissions in response', async () => {
        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        const form = result.data.forms[0];
        expect(form.permissions).to.exist;
        expect(form.permissions.create).to.be.true;
        expect(form.permissions.read).to.be.true;
        expect(form.permissions.update).to.be.true;
    });

    it('indicates access status for each form', async () => {
        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        result.data.forms.forEach((form: any) => {
            expect(form.hasAccess).to.be.true;
        });
    });

    it('includes form metadata', async () => {
        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        const form = result.data.forms[0];
        expect(form.name).to.exist;
        expect(form.title).to.exist;
        expect(form.description).to.exist;
    });

    it('provides default description when not specified', async () => {
        mockProject.forms.testForm1.uag.description = undefined;

        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        const form = result.data.forms.find((f: any) => f.name === 'testForm1');
        expect(form.description).to.include('Form for');
    });

    it('returns no forms available when project has no UAG forms', async () => {
        mockProject.forms = {
            nonUagForm: {
                form: { title: 'Non-UAG Form', name: 'nonUagForm' }
            }
        };

        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.noFormsAvailable);
        expect(result.data.message).to.include('No forms are currently available');
    });

    it('handles forms with no access correctly', async () => {
        mockAuthInfo.formPermissions = () => ({
            create: false,
            read: false,
            update: false,
            delete: false
        });

        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        result.data.forms.forEach((form: any) => {
            expect(form.hasAccess).to.be.false;
        });
    });

    it('indicates partial access when only some permissions are granted', async () => {
        mockAuthInfo.formPermissions = () => ({
            create: false,
            read: true,
            update: false,
            delete: false
        });

        const result = await tool.execute({}, { authInfo: mockAuthInfo });

        expect(result.template).to.equal(ResponseTemplate.getAvailableForms);
        result.data.forms.forEach((form: any) => {
            expect(form.hasAccess).to.be.true; // read access is sufficient
        });
    });

    it('respects tool overrides from config', async () => {
        mockProject.config = {
            toolOverrides: {
                get_forms: {
                    name: 'custom_get_forms',
                    description: 'Custom forms getter'
                }
            }
        };

        const customTool = await getForms(mockProject);
        expect(customTool.name).to.equal('custom_get_forms');
        expect(customTool.description).to.equal('Custom forms getter');
    });
});
