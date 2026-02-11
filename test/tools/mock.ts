import { UAGProjectInterface } from "../../src/UAGProjectInterface";
import { UAGFormInterface } from "../../src/UAGFormInterface";
import { ResponseTemplate } from "../../src/template";
import { get } from "lodash";
export class MockProjectInterface extends UAGProjectInterface {
    constructor(
        mockForms: Record<string, any> = {},
        submissions: Record<string, any[]> = {},
        endpoint: string = 'https://mock.form.io'
    ) {
        super(endpoint);
        for (const [key, formDef] of Object.entries(mockForms)) {
            const form = new MockFormInterface(this, formDef, submissions[key] || []);
            if (form.uag) {
                this.forms[key] = form;
            }
        }
        this.formNames = Object.keys(this.forms);
        this.uagTemplate = {
            renderTemplate: (templateName: string, data: any) => {
                return JSON.stringify(data);
            }
        } as any;
    }

    get config() { return {}; }
    
    async getForm(formName: string) {
        return this.forms[formName] || null;
    }
    
    mcpResponse(templateName: ResponseTemplate, data?: object): any {
        return {
            template: templateName,
            data
        };
    }
}

export class MockFormInterface extends UAGFormInterface {
    constructor(
        project: MockProjectInterface,
        formDef: any,
        public submissions: any[]
    ) {
        super(project, formDef);
        
        // Set up UAG properties if form has uag tag
        if (formDef.tags?.includes('uag')) {
            const key = formDef.name || formDef.path;
            this.uag = {
                machineName: key,
                name: formDef.name || formDef.path || key,
                title: formDef.title || formDef.name || key,
                description: formDef.properties?.description || `A form to submit new ${formDef.title} records.`
            };
        }
    }

    async find(query: any) {
        let found = [...this.submissions];
        delete query.limit;
        delete query.skip;
        for (const [key, value] of Object.entries(query)) {
            const [field, operator] = key.split('__');
            found = this.submissions.filter(sub => {
                const fieldValue = get(sub, field);
                if (operator === 'regex') {
                    const regex = new RegExp((value as string).slice(1, -2), 'i'); // Remove slashes and flags
                    return regex.test(fieldValue);
                } else if (operator === 'gt') {
                    return fieldValue > parseFloat(value as string);
                } else if (operator === 'gte') {
                    return fieldValue >= parseFloat(value as string);
                } else if (operator === 'lt') {
                    return fieldValue < parseFloat(value as string);
                } else if (operator === 'lte') {
                    return fieldValue <= parseFloat(value as string);
                } else if (operator === 'in') {
                    return ((value as string).split(',') as string[]).includes(fieldValue);
                } else if (operator === 'nin') {
                    return !((value as string).split(',') as string[]).includes(fieldValue);
                } else {
                    return fieldValue === (value as string);
                }
            });
        }

        return {items: found} as any;
    }

    async loadSubmission(id: string) {
        return this.submissions.find(sub => sub._id === id) || null;
    }
}