import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo } from "./utils";
import { UAGComponentInfo, UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep, omit } from "lodash";
import { SchemaBuilder } from "./SchemaBuilder";
import { reads } from './annotations';
import { formflow, FormflowError, resolveTaskName, warnLegacy } from "../formflow";

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
    // Overrides written for the tool's earlier name still apply, except a rename,
    // which belongs to the deprecated tool and would clash with it.
    const overrides = project.config?.toolOverrides;
    const own = overrides?.agent_provide || (overrides?.agent_provide_data ? omit(overrides.agent_provide_data, 'name') : {});
    return defaultsDeep(own, provideTool(project, 'agent_provide'));
};

/**
 * `agent_provide_data`: the earlier name of `agent_provide`, kept so MCP clients
 * and integrations that call it keep working. Removed in a future major release.
 */
export const agentProvideData = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    const tool = provideTool(project, 'agent_provide_data');
    const execute = tool.execute;
    return defaultsDeep(project.config?.toolOverrides?.agent_provide_data || {}, {
        ...tool,
        title: 'Agent Provide Data (deprecated)',
        description: `Deprecated: use \`agent_provide\`, which takes the same arguments. ${DESCRIPTION}`,
        execute: (args: any, extra: any) => {
            warnLegacy('agent_provide_data', 'the agent_provide_data MCP tool; use agent_provide.');
            return execute(args, extra);
        }
    });
};

function provideTool(project: UAGProjectInterface, name: string): ToolInfo {
    return {
        name,
        title: 'Agent Provide',
        description: DESCRIPTION,
        annotations: reads('Process submission data'),
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .submission_id()
            .task()
            .persona().schema,
        execute: async (args: {
            form_name: string;
            submission_id: string;
            task?: string;
            persona?: string;
        }, extra: any) => {
            const { form_name, submission_id } = args;
            const refused = await refusal(project);
            if (refused) return project.mcpJSONResponse(refused, true);
            let requested: string | undefined;
            try {
                requested = resolveTaskName(args, name);
            }
            catch (err: any) {
                if (err instanceof FormflowError) return project.mcpJSONResponse({ error: err.message }, true);
                throw err;
            }
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            const task = requested || Object.keys(form.uagFields)[0] || 'default';
            // Templates get the task under both names: deployments may have
            // customized a template that still renders `persona`.
            const names = { task, persona: task };
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
