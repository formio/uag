import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./utils";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
import { SchemaBuilder } from "./SchemaBuilder";
export const confirmSubmission = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.confirm_form_submission || {}, {
        name: 'confirm_form_submission',
        title: 'Confirm Form Submission',
        description: 'Show a summary of the collected form data and ask the user for confirmation before submitting',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .form_data().schema,
        execute: async ({ form_name, form_data }: {
            form_name: string;
            form_data: Record<string, any>;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            // Perform a validation check.
            const submission = form.convertToSubmission(form_data);

            // See which fields need to be filled out.
            const fields = await form.getFields(submission, extra.authInfo);
            if (fields.errors.length > 0) {
                return project.mcpResponse(ResponseTemplate.fieldValidationErrors, { invalidFields: fields.errors });
            }

            // See if there are still required fields to fill out...
            if (fields.required.components.length) {
                return project.mcpResponse(ResponseTemplate.fieldCollectedNext, {
                    parent: undefined,
                    parentLabel: form.getParentLabel(),
                    message: 'There is additional data that needs to be collected before submission.',
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.required.rules) }),
                    fields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { fields: fields.required.components }),
                    dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                        data: form.formatData(submission.data)
                    }),
                    progress: {
                        collected: Object.keys(form_data).length,
                        total: fields.required.components.length + Object.keys(form_data).length
                    }
                });
            }

            // Confirm the submission.
            return project.mcpResponse(ResponseTemplate.confirmFormSubmission, {
                form,
                dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                    data: form.formatData(submission.data)
                }),
                currentData: form_data
            });
        }
    });
};