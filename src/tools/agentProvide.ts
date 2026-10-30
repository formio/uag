import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo } from "./utils";
import { UAGComponentInfo, UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
import { SchemaBuilder } from "./SchemaBuilder";
import { reads } from './annotations';
import { formflow } from "../formflow";

const DESCRIPTION = 'Provides a mechanism for agents to process existing submission data, understand it, and then to provide additional data values provided a criteria and form context.';

/**
 * Agentic workflow over MCP is Agentic Formflow: it needs a license or a project
 * on Form.io's hosted service, as the Agent API does. The stub engines do not
 * count, since this tool calls no engine. Answers the refusal, or null.
 */
async function refusal(project: UAGProjectInterface): Promise<{ error: string; code: string } | null> {
    const state = await formflow(project).state();
    if (state.allowed && (state.reason === 'licensed' || state.reason === 'hosted')) return null;
    return {
        error: 'Agentic workflows require a license (LICENSE_KEY) that includes the UAG (an online license with UAG servers, or an offline license ' +
            'with the "uag" option), or a project on Form.io\'s hosted service. ' +
            'MCP tools and conversation forms do not need either.',
        code: 'license_required',
    };
}

/**
 * `agent_provide`: a task's criteria, the submission's values and the task's
 * fields, as instructions for an agent to fill those fields. It reads only; the
 * agent writes its values with `submission_update`.
 */
export const agentProvide = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    // Merged into a new object: the overrides are shared config, and the tools are
    // built again for every request.
    return defaultsDeep({}, project.config?.toolOverrides?.agent_provide, provideTool(project));
};

function provideTool(project: UAGProjectInterface): ToolInfo {
    return {
        name: 'agent_provide',
        title: 'Agent Provide',
        description: DESCRIPTION,
        annotations: reads('Process submission data'),
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .submission_id()
            .task().schema,
        execute: async (args: {
            form_name: string;
            submission_id: string;
            task?: string;
        }, extra: any) => {
            const { form_name, submission_id } = args;
            const refused = await refusal(project);
            if (refused) return project.mcpJSONResponse(refused, true);
            const requested = args.task || undefined;
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            const task = requested || Object.keys(form.uagFields)[0] || 'default';
            const names = { task };
            const uag = form.uagFields[task];
            if (!uag) {
                return project.mcpResponse(ResponseTemplate.uagComponentNotFound, {
                    ...names,
                    error: 'no_uag'
                }, true);
            }

            const submission = await form.loadSubmission(submission_id, extra.authInfo);
            if (!submission) {
                return project.mcpResponse(ResponseTemplate.submissionNotFound, {
                    form: form.form,
                    submissionId: submission_id
                }, true);
            }

            if (!uag.criteria) {
                return project.mcpResponse(ResponseTemplate.uagComponentNotFound, {
                    ...names,
                    error: 'no_criteria'
                }, true);
            }

            const agentFields: UAGComponentInfo[] = Object.values<UAGComponentInfo>(uag.components);
            if (agentFields.length === 0) {
                return project.mcpResponse(ResponseTemplate.uagComponentNotFound, {
                    ...names,
                    error: 'no_fields'
                }, true);
            }

            // Collect more required fields.
            return project.mcpResponse(ResponseTemplate.agentProcessData, {
                ...names,
                criteria: uag.criteria,
                values: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldValues, {
                    data: form.formatData(submission.data)
                }),
                fields: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: agentFields })
            });
        }
    };
}
