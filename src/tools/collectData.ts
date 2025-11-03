import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo, ParentInfo, DataUpdate, getParentLabel, getParentDataPath } from "./utils";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
import { SchemaBuilder } from "./SchemaBuilder";
import { get } from 'lodash';
export const collectData = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.collect_field_data || {}, {
        name: 'collect_field_data',
        title: 'Collect Field Data',
        description: 'Collect data for a form, or a specific field with nested components. Identify the component by its path, validate the provided value, and update the form_data object. After updating, determine the next required field to collect or indicate if all required fields are complete. PREREQUISITE: This tool should only be called after the `get_form_fields` tool AND subsequentially the `get_field_info` tool have been called to understand the structure and validation rules of the fields.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .form_data()
            .parent()
            .updates().schema,
        execute: async ({ form_name, form_data, parent, updates }: {
            form_name: string;
            form_data: Record<string, any>;
            parent: ParentInfo | undefined;
            updates: DataUpdate[]
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            // Ensure the parent is undefined if the type or data_path is missing.
            if (!parent?.data_path || !parent.type) {
                parent = undefined;
            }

            // Merge the updates into the current data.
            for (const { data_path, new_value } of updates) {
                form_data[data_path] = new_value;
            }

            // Get any form errors.
            const submission = form.convertToSubmission(form_data);

            // Find next required field that hasn't been filled
            const fields = await form.getFields(submission, extra.authInfo, parent?.data_path);
            if (fields.errors.length > 0) {
                return project.mcpResponse(ResponseTemplate.fieldValidationErrors, { invalidFields: fields.errors });
            }

            const collectedData = parent ? get(submission, parent.data_path || '') : submission.data;

            // If no required fields remain, then we can move onto a new tool.
            if (!fields.required.components.length) {
                return project.mcpResponse(ResponseTemplate.allFieldsCollected, {
                    form: form.form,
                    parent,
                    parentDataPath: getParentDataPath(parent, fields.rowIndex),
                    parentLabel: getParentLabel(parent),
                    rowIndex: fields.rowIndex,
                    dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                        data: form.formatData(collectedData)
                    })
                });
            }

            // Collect more required fields.
            return project.mcpResponse(ResponseTemplate.fieldCollectedNext, {
                parent,
                parentDataPath: getParentDataPath(parent, fields.rowIndex),
                parentLabel: getParentLabel(parent, form.form),
                message: 'Form data collected successfully!',
                rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.required.rules) }),
                fields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { fields: fields.required.components }),
                dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                    data: form.formatData(collectedData)
                }),
                progress: {
                    collected: Object.keys(form_data).length,
                    total: fields.required.components.length + Object.keys(form_data).length
                }
            });
        }
    });
};