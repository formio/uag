import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { defaultsDeep, get, set } from "lodash";
import { DataUpdate, ToolInfo } from "./utils";
import { UAGFormInterface } from "../UAGFormInterface";
import { SchemaBuilder } from './SchemaBuilder';
const error = require('debug')('formio:uag:submissionUpdate:error');
export const submissionUpdate = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.submission_update || {}, {
        name: 'submission_update',
        title: 'Submission Update',
        description: 'Apply multiple planned field updates to a selected submission after the user confirmed they wish to update the record.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .submission_id()
            .updates().schema,
        execute: async ({ form_name, submission_id, updates }: {
            form_name: string;
            submission_id: string;
            updates: DataUpdate[];
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            try {
                // Get the current submission
                const currentSubmission = await form.loadSubmission(submission_id, extra.authInfo);
                if (!currentSubmission) {
                    return project.mcpResponse(ResponseTemplate.submissionNotFound, {
                        form: form.form,
                        submissionId: submission_id
                    }, true);
                }

                // Apply all field updates and track changes
                const updatedData = { ...currentSubmission.data };
                const updateSummary = [];
                for (const update of updates) {
                    const previousValue = get(updatedData, update.data_path);
                    set(updatedData, update.data_path, update.new_value);
                    updateSummary.push({
                        data_path: update.data_path,
                        new_value: update.new_value,
                        previous_value: previousValue || ''
                    });
                }

                // Update the submission via API with all changes
                const submission = await form.submit({
                    ...currentSubmission,
                    data: updatedData
                }, extra.authInfo);
                if (!submission) {
                    return project.mcpResponse(ResponseTemplate.submissionUpdateError, {
                        form: form.form,
                        submissionId: submission_id,
                        error: 'Unknown error during update'
                    }, true);
                }

                // Format the updated submission for display
                return project.mcpResponse(ResponseTemplate.submissionUpdated, {
                    form: form.form,
                    submissionId: submission_id,
                    created: submission.created,
                    modified: submission.modified,
                    updateSummary: updateSummary,
                    totalFieldsUpdated: updateSummary.length,
                    dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                        data: form.formatData(submission.data)
                    }),
                });

            } catch (err: any) {
                if (err && err.name === 'ValidationError' && err.details) {
                    const errors = [];
                    for (const detail of err.details) {
                        if (detail.message) {
                            errors.push({
                                label: detail.context?.label || 'Field',
                                path: detail.context?.path,
                                message: detail.message
                            });
                        }
                    }
                    return project.mcpResponse(ResponseTemplate.submitValidationError, {
                        validationErrors: errors.length ? errors : [{ message: err.message || 'Unknown error during submission' }]
                    }, true);
                }
                error('Error updating submission:', err);
                return project.mcpResponse(ResponseTemplate.submissionUpdateError, {
                    form: form.form,
                    submissionId: submission_id,
                    error: err instanceof Error ? err.message : 'Unknown error'
                }, true);
            }
        }
    });
};