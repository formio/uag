import z from "zod";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo } from "./types";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
export const collectData = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.collect_field_data || {},{
        name: 'collect_field_data',
        title: 'Collect Field Data',
        description: 'Collect data for form. Identify the component by its path, validate the provided value, and update the current_data object. After updating, determine the next required field to collect or indicate if all required fields are complete.',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form being filled'),
            field_updates: z.array(z.object({
                field_path: z.string().describe('The data path of the field to update. To find the field_path, you can use the `get_form_fields` tool.'),
                new_value: z.string().describe('The complete new value for the field. If appending to existing content, include both the existing content and the new content in the proper order.')
            })).describe('Array of field updates to apply. Each update specifies the field path and the complete new value.'),
            current_data: z.record(z.any()).optional().default({}).describe('The current data collected so far for this form session (key-value pairs where the field_path is the key). Include ALL previously collected field data to maintain session state.')
        },
        execute: async ({ form_name, field_updates, current_data = {} }: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            const invalidFields: { path: string, error: string }[] = [];
            const updatedData = { ...current_data };
            for (const { field_path, new_value: field_value } of field_updates) {
                const component = form.getComponent(field_path);
                if (!component) {
                    invalidFields.push({
                        path: field_path,
                        error: 'Field not found in form'
                    });
                    continue;
                }

                // Validate the provided field value
                const validation = await form.validateComponent(component, field_value);
                if (!validation.isValid) {
                    invalidFields.push({
                        path: field_path,
                        error: validation.error || 'Unknown validation error'
                    });
                    continue;
                }

                updatedData[field_path] = field_value;
            }

            // If there are errors, then return the errors.
            if (invalidFields.length > 0) {
                return project.mcpResponse(ResponseTemplate.fieldValidationErrors, { invalidFields });
            }
``
            // Find next required field that hasn't been filled
            const fields = form.getFields(updatedData);
            const collectedDataSummary = project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                data: form.formatFormDataForDisplay(updatedData)
            });
            if (!fields.required.length) {
                return project.mcpResponse(ResponseTemplate.allFieldsCollected, {
                    dataSummary: collectedDataSummary
                });
            }

            return project.mcpResponse(ResponseTemplate.fieldCollectedNext, {
                rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.rules) }),
                requiredFields: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: fields.required }),
                progress: {
                    collected: Object.keys(updatedData).length,
                    total: fields.required.length + Object.keys(updatedData).length
                }
            });
        }
    });
};