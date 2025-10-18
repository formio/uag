import z from "zod";
import { ResponseTemplate } from "../template";
import { Submission } from "@formio/core";
import { ToolInfo } from "./types";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
const debug = require('debug')('formio:uag:submitForm');
export const submitCompletedForm = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.submit_completed_form || {}, {
        name: 'submit_completed_form',
        title: 'Submit Completed Form',
        description: 'Submit the completed form data to Form.io API ONLY after the user has explicitly confirmed submission (said "yes", "confirm", etc.)',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form being submitted'),
            current_data: z.record(z.any()).describe('The completed collected form data as key-value pairs (using field paths as keys)')
        },
        execute: async ({ form_name, current_data }: any, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            try {
                const submission: Submission | null = await form.submit(form.convertToSubmission(current_data), extra.authInfo);
                if (!submission) {
                    return project.mcpResponse(ResponseTemplate.submitValidationError, {
                        validationErrors: ['Unknown error during submission']
                    }, true);
                }
                debug(`Form submitted: ${form_name} with submission ID: ${submission._id}`);
                return project.mcpResponse(ResponseTemplate.formSubmitted, {
                    form: form.form,
                    data: submission.data,
                    submissionId: submission._id || 'N/A',
                    submittedFieldsCount: Object.keys(current_data).length,
                    dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                        data: form.formatFormDataForDisplay(current_data)
                    })
                });
            } catch (err: any) {
                const errors = [];
                if (err && err.name === 'ValidationError' && err.details) {
                    for (const detail of err.details) {
                        if (detail.message) {
                            errors.push({
                                label: detail.context?.label || 'Field',
                                path: detail.context?.path,
                                message: detail.message
                            });
                        }
                    }
                }
                return project.mcpResponse(ResponseTemplate.submitValidationError, {
                    validationErrors: errors.length ? errors : [{message: err.message || 'Unknown error during submission'}]
                }, true);
            }
        }
    });
};