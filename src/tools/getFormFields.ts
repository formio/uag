import z from "zod";
import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./types";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
const error = require('debug')('formio:uag:getFormFields:error');
export const getFormFields = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.get_form_fields || {}, {
        name: 'get_form_fields',
        title: 'Get Form Fields',
        description: 'Get detailed information about all fields in a form including their types, validation rules, options, and properties. This helps understand the structure and requirements of a form. You cannot call this tool unless you verify if the user has access to submit this form using the `get_forms` tool.',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form to get fields for')
        },
        execute: async ({ form_name }: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            try {
                const fields = form.getFields(form);
                return project.mcpResponse(ResponseTemplate.getFormFields, {
                    form: form.form,
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.rules) }),
                    fields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { fields: [...fields.required, ...fields.optional] }),
                    totalFields: fields.required.length + fields.optional.length,
                    requiredFields: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: fields.required }),
                    totalRequired: fields.required.length
                });
            } catch (err) {
                error('Error extracting form fields:', err);
                return project.mcpResponse(ResponseTemplate.getFormFieldsError, {
                    form: form.form,
                    error: err instanceof Error ? err.message : 'Unknown error'
                }, true);
            }
        }
    });
};