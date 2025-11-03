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
        description: 'Get detailed information about all fields in a form including their types, validation rules, options, and properties. This helps understand the structure and requirements of a form. PREREQUISITE: You must call the `get_forms` tool first to understand what forms are available to submit and the permissions associated with those forms.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .form_data()
            .criteria()
            .parent().schema,
        execute: async ({ form_name, form_data, criteria, parent }: {
            form_name: string;
            form_data?: Record<string, any>;
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

                // Get the submission data.
                const submission = form.convertToSubmission(form_data);

                // Get the fields at the specified data path (or root if not provided).
                const fields = await form.getFields(submission, extra.authInfo, parent?.data_path);

                // If the agent requests optional fields, but there are still requird fields to fill out, then force required
                // and inform the agent of this change.
                let message = '';
                if (criteria == 'optional' && fields.required.components.length > 0) {
                    criteria = 'required';
                    message = 'You requested "optional" fields, but the user is not finished collecting required information. Please finish collecting the following required fields first.\n\n';
                }

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

                let totalType = fields.total;
                if (criteria === 'required') {
                    totalType = fields.totalRequired;
                } else if (criteria === 'optional') {
                    totalType = fields.total - fields.totalRequired;
                }

                const totalCollected = Object.keys(form_data || {}).length;
                let totalTypeCollected = 0;
                if (criteria === 'required') {
                    totalTypeCollected = fields.totalRequiredCollected;
                } else if (criteria === 'optional') {
                    totalTypeCollected = totalCollected - fields.totalRequiredCollected;
                } else {
                    totalTypeCollected = totalCollected;
                }

                // Show the form fields based on the criteria.
                return project.mcpResponse(ResponseTemplate.getFormFields, {
                    message,
                    parent,
                    parentLabel: getParentLabel(parent, form.form),
                    parentDataPath: getParentDataPath(parent, fields.rowIndex),
                    type: upperFirst(criteria),
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(criteriaRules) }),
                    fieldList: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: criteriaFields }),
                    totalFields: fields.total,
                    totalType,
                    totalCollected,
                    totalTypeCollected
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