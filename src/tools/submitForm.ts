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
                if (submitted) submission = submitted;
                if (!submission) {
                    return project.mcpResponse(ResponseTemplate.submitValidationError, {
                        validationErrors: ['Unknown error during submission']
                    }, true);
                }
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