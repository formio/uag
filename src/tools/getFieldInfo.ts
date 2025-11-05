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
        description: 'Get detailed information about a specific field(s) that have been provided from the user. It is used to understand the properties, validation rules, and options of the specific field(s) the user has provided values for. This purpose of this tool is to provide detailed information for any field(s) (provided using the `field_paths` parameter) to help understand the structure and requirements of a form. PREREQUISITE: This tool should be called after the `get_form_fields` tool has been called AND once the user has provided some values for the provided fields.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .field_paths()
            .parent_path().schema,
        execute: async ({ form_name, field_paths, parent_path }: {
            form_name: string;
            field_paths: string[];
            parent_path: string | undefined;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            try {
                // Get the parent info if a parent_path was provided.
                const parent = form.getParentInfo(parent_path);

                // Get the fields at the specified data path (or root if not provided).
                const fields = await form.getFields({data: {}}, extra.authInfo, field_paths);
                const allRules = {...fields.required.rules, ...fields.optional.rules};

                // Show the form fields based on the criteria.
                return project.mcpResponse(ResponseTemplate.getFormFieldsInfo, {
                    parent,
                    parentLabel: form.getParentLabel(parent),
                    parentDataPath: form.getParentDataPath(parent, fields.rowIndex),
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(allRules) }),
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