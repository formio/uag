import z from "zod";
import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./types";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
export const confirmSubmission = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.confirm_form_submission || {}, {
        name: 'confirm_form_submission',
        title: 'Confirm Form Submission',
        description: 'Show a summary of the collected form data and ask the user for confirmation before submitting',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form to confirm'),
            current_data: z.record(z.any()).describe('The completed collected form data (using field paths as keys)')
        },
        execute: async ({ form_name, current_data }: any, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            // Perform a validation check.
            const submission = form.convertToSubmission(current_data);
            const invalidFields = await form.validateData(submission, extra.authInfo);
            if (invalidFields.length > 0) {
                return project.mcpResponse(ResponseTemplate.fieldValidationErrors, { invalidFields });
            }

            // See which fields need to be filled out.
            const fields = await form.getFields(submission, extra.authInfo);

            // See if there are still required fields to fill out...
            if (fields.required.length) {
                return project.mcpResponse(ResponseTemplate.fieldCollectedNext, {
                    message: 'There is additional data that needs to be collected before submission.',
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.rules) }),
                    requiredFields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { fields: fields.required }),
                    progress: {
                        collected: Object.keys(current_data).length,
                        total: fields.required.length + Object.keys(current_data).length
                    }
                });
            }

            // Confirm the submission.
            return project.mcpResponse(ResponseTemplate.confirmFormSubmission, {
                form,
                dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                    data: form.formatSubmission(submission).data
                }),
                currentData: current_data
            });
        }
    });
};