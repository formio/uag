import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./utils";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
import { SchemaBuilder } from './SchemaBuilder';
const error = require('debug')('formio:uag:getFieldInfo:error');
export const getFieldInfo = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.get_field_info || {}, {
        name: 'get_field_info',
        title: 'Get Field(s) Info',
        description: 'Get detailed information about a specific field(s) that have been provided from the user. It is used to understand the properties, validation rules, and options of the specific field(s) the user has provided values for. PREREQUISITE: This tool should be called after the `get_form_fields` tool has been called AND once the user has provided some values for the provided fields.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .field_paths().schema,
        execute: async ({ form_name, field_paths }: {
            form_name: string;
            field_paths: string[];
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            try {
                // Get the fields at the specified data path (or root if not provided).
                const fields = await form.getFields({data: {}}, extra.authInfo, field_paths);

                // Show the form fields based on the criteria.
                return project.mcpResponse(ResponseTemplate.getFormFieldsInfo, {
                    fields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { 
                        fields: fields.required.components.concat(fields.optional.components)
                    }),
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