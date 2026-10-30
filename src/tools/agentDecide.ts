import { defaultsDeep } from "lodash";
import z from "zod";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { UAGFormInterface } from "../UAGFormInterface";
import { ResponseTemplate } from "../template";
import { formflow, FormflowError } from "../formflow";
import { SchemaBuilder } from "./SchemaBuilder";
import { ToolInfo } from "./utils";
import { reads } from './annotations';

/**
 * Returns a task's decision questions as structured JSON, so any decision
 * model — an enabled engine, or one the MCP client calls itself — can answer
 * them. No model is called here.
 */
export const agentDecide = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep({}, project.config?.toolOverrides?.agent_decide, {
        name: 'agent_decide',
        title: 'Agent Decide',
        description: 'Return the decision questions for a task\'s closed-set fields (radio, select, checkbox, select boxes, survey and small resource selects) as structured JSON: the state to decide on, every question, and how each answer maps back to a field value. Answer the questions with a decision model, then write the values with `submission_update`. Provide either `submission_id` or `form_data`.',
        annotations: reads('Get decision questions'),
        inputSchema: {
            ...(new SchemaBuilder(project)).form_name().submission_id().task().schema,
            form_data: z.record(z.string(), z.any()).optional().describe('The current form data as a submission data object (nested by data path). Used when `submission_id` is not given.')
        },
        execute: async (args: {
            form_name: string;
            submission_id?: string;
            task?: string;
            form_data?: Record<string, any>;
        }, extra: any) => {
            const { form_name, submission_id, form_data } = args;
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            let data = form_data || {};
            if (submission_id) {
                const submission = await form.loadSubmission(submission_id, extra.authInfo);
                if (!submission) {
                    return project.mcpResponse(ResponseTemplate.submissionNotFound, { form: form.form, submissionId: submission_id }, true);
                }
                data = submission.data || {};
            }
            try {
                const task = args.task || undefined;
                const out = await formflow(project).questions(form, { task, data, submissionId: submission_id }, extra.authInfo);
                return project.mcpJSONResponse({ form: form_name, ...out });
            }
            catch (err: any) {
                // A request that cannot be planned, or Agentic Formflow without its license.
                if (err instanceof FormflowError) {
                    return project.mcpJSONResponse({ error: err.message, ...(err.code && { code: err.code }) }, true);
                }
                throw err;
            }
        }
    });
};
