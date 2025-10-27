import z from "zod";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo } from "./types";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
export const collectData = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.collect_field_data || {}, {
        name: 'collect_field_data',
        title: 'Collect Field Data',
        description: 'Collect data for form. Identify the component by its path, validate the provided value, and update the current_data object. After updating, determine the next required field to collect or indicate if all required fields are complete.',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form being filled'),
            updates: z.array(z.object({
                path: z.string().describe('The data path of the field to update. To find the field_path, you can use the `get_form_fields` tool.'),
                value: z.string().describe('The complete new value for the field. If appending to existing content, include both the existing content and the new content in the proper order.')
            })).describe('Array of field updates to apply. Each update specifies the field path and the complete new value.'),
            current_data: z.record(z.any()).optional().default({}).describe('The current data collected so far for this form session (key-value pairs where the field_path is the key). Include ALL previously collected field data to maintain session state.')
        },
        execute: async ({ form_name, updates, current_data = {} }: any, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            // Merge the updates into the current data.
            const updatedData = { ...current_data };
            for (const { path, value } of updates) {
                updatedData[path] = value;
            }

            // Get any form errors.
            const submission = form.convertToSubmission(updatedData);
            const invalidFields = await form.validateData(submission, extra.authInfo);
            if (invalidFields.length > 0) {
                return project.mcpResponse(ResponseTemplate.fieldValidationErrors, { invalidFields });
            }

            // Find next required field that hasn't been filled
            const fields = await form.getFields(submission, extra.authInfo);
            const collectedDataSummary = project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                data: form.formatSubmission(submission).data
            });
            if (!fields.required.length) {
                return project.mcpResponse(ResponseTemplate.allFieldsCollected, {
                    dataSummary: collectedDataSummary
                });
            }

            return project.mcpResponse(ResponseTemplate.fieldCollectedNext, {
                message: 'Form data collected successfully!',
                rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.rules) }),
                requiredFields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { fields: fields.required }),
                progress: {
                    collected: Object.keys(updatedData).length,
                    total: fields.required.length + Object.keys(updatedData).length
                }
            });
        }
    });
};