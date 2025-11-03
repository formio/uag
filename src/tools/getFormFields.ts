import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo, ParentInfo, getParentLabel, getParentDataPath } from "./utils";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep, upperFirst } from "lodash";
import { SchemaBuilder } from './SchemaBuilder';
const error = require('debug')('formio:uag:getFormFields:error');
export const getFormFields = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.get_form_fields || {}, {
        name: 'get_form_fields',
        title: 'Get Form Fields',
        description: 'Get high level overview of the fields that are present in a form, and to understand the "rules" on how the data for each field type should be collected. The purpose of this tool is to determine what fields the user is requesting (and to understand how to format that values for that data), and use that to create a list of field data_path\'s that the user is providing context for. This list can then be provided to the `get_field_info` tool to determine the specific field level information for those fields (validation, required, collection rules, etc). PREREQUISITE: You must call the `get_forms` tool first to understand what forms are available to submit and the permissions associated with those forms.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .criteria()
            .parent().schema,
        execute: async ({ form_name, criteria, parent }: {
            form_name: string;
            criteria?: 'all' | 'required' | 'optional';
            parent?: ParentInfo | undefined;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            try {
                // Ensure the parent is null if the type or data_path is missing.
                if (!parent?.data_path || !parent.type) {
                    parent = undefined;
                }

                // Get the fields at the specified data path (or root if not provided).
                const fields = await form.getFields({data: {}}, extra.authInfo, parent?.data_path);

                // Determine which fields to show based on the criteria.
                const criteriaFields = criteria === 'all' ? 
                    [...fields.required.components, ...fields.optional.components] :
                    criteria === 'required' ? fields.required.components : fields.optional.components;
                if (criteriaFields.length === 0) {
                    return project.mcpResponse(ResponseTemplate.getFormFieldsEmpty, {
                        parent,
                        parentLabel: getParentLabel(parent),
                        type: upperFirst(criteria),
                        form: form.form,
                    });
                }

                // Determine the rules based on the criteria.
                const criteriaRules = criteria === 'all' ? 
                    {...fields.required.rules, ...fields.optional.rules} :
                    criteria === 'required' ? fields.required.rules : fields.optional.rules;

                // Show the form fields based on the criteria.
                return project.mcpResponse(ResponseTemplate.getFormFields, {
                    parent,
                    parentLabel: getParentLabel(parent, form.form),
                    parentDataPath: getParentDataPath(parent, fields.rowIndex),
                    type: upperFirst(criteria),
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(criteriaRules) }),
                    fieldList: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: criteriaFields })
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