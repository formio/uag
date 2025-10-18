import z from "zod";
import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { defaultsDeep, get, set } from "lodash";
import { ToolInfo } from "./types";
import { UAGFormInterface } from "../UAGFormInterface";
const error = require('debug')('formio:uag:submissionUpdate:error');
export const submissionUpdate = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.submission_update || {}, {
        name: 'submission_update',
        title: 'Submission Update',
        description: 'Apply multiple planned field updates to a selected submission after the user confirmed they wish to update the record.',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form'),
            submission_id: z.string().describe('The ID of the submission to update'),
            update_plan: z.array(z.object({
                field_path: z.string().describe('The data path (field_path) of the field to update. The field_path can be found using the `get_form_fields` tool.'),
                field_label: z.string().describe('The human-readable label of the field'),
                new_value: z.string().describe('The complete new value for the field. If the user wishes to add to an existing value (e.g. append, prepend, etc), then you can fetch the existing value using the `find_submission_by_field` tool and perform the appropriate string manipulation before passing the final value here.'),
            })).describe('Array of field updates to apply')
        },
        execute: async ({ form_name, submission_id, update_plan }: any, extra: any) => {
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
                for (const update of update_plan) {
                    const previousValue = get(updatedData, update.field_path);
                    set(updatedData, update.field_path, update.new_value);
                    updateSummary.push({
                        field_path: update.field_path,
                        field_label: update.field_label,
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
                    dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.submittedData, {
                        data: form.formatSubmission(submission).data
                    }),
                });

            } catch (err) {
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