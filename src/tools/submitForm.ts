import { ResponseTemplate } from "../template";
import { Submission } from "@formio/core";
import { ToolInfo } from "./utils";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { FormFieldError, UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
import { SchemaBuilder } from "./SchemaBuilder";
const debug = require('debug')('formio:uag:submitForm');
export const submitCompletedForm = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.submit_completed_form || {}, {
        name: 'submit_completed_form',
        title: 'Submit Completed Form',
        description: 'Submit the completed form data. Should only be used once all the required fields have been collected, and the user has explicitly confirmed submission (e.g. has said "submit", "send", "done", etc)',
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
            try {
                let submission = form.convertToSubmission(form_data);
                const submitted: Submission | null = await form.submit(submission, extra.authInfo);
                if (submitted) {
                    // The submission save proxies to the Form.io server, and a rejection
                    // (e.g. failed validation) can come back through the save pipeline as
                    // the error response body instead of a saved submission. A result
                    // without an _id was not persisted — report the failure to the agent
                    // instead of a false success.
                    const result: any = submitted;
                    if (!result._id) {
                        const errors: FormFieldError[] = (result.name === 'ValidationError' && result.details)
                            ? form.convertToFormFieldErrors(result.details)
                            : [];
                        return project.mcpResponse(ResponseTemplate.submitValidationError, {
                            validationErrors: errors.length ? errors : [{
                                message: result.message || 'The submission was not saved by the server. Verify that all required fields have been collected and that every value conforms to its field rules, then try again.'
                            }]
                        }, true);
                    }
                    submission = submitted;
                }
                // A null result is still a valid outcome for "action" forms that have no
                // Save Submission action (e.g. email or webhook only) — the data was
                // processed but intentionally not persisted, so no submission ID exists.
                debug(`Form submitted: ${form_name} with submission ID: ${submission._id}`);
                return project.mcpResponse(ResponseTemplate.formSubmitted, {
                    form: form.form,
                    data: submission.data,
                    submissionId: submission._id,
                    submittedFieldsCount: Object.keys(form_data).length,
                    dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                        data: form.formatData(submission.data)
                    }),
                });
            } catch (err: any) {
                let errors: FormFieldError[] = [];
                if (err && err.name === 'ValidationError' && err.details) {
                    errors = form.convertToFormFieldErrors(err.details);
                }
                return project.mcpResponse(ResponseTemplate.submitValidationError, {
                    validationErrors: errors.length ? errors : [{message: err.message || err.toString()}]
                }, true);
            }
        }
    });
};