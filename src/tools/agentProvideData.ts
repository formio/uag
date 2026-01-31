import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo } from "./utils";
import { UAGComponentInfo, UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
import { SchemaBuilder } from "./SchemaBuilder";
import { Utils } from '@formio/core';
export const agentProvideData = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.agent_provide_data || {}, {
        name: 'agent_provide_data',
        title: 'Agent Provide Data',
        description: 'Provides a mechanism for agents to process existing submission data, understand it, and then to provide additional data values provided a criteria and form context.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .submission_id()
            .persona().schema,
        execute: async ({ form_name, submission_id, persona }: {
            form_name: string;
            submission_id: string;
            persona?: string;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            const uag = persona ? form.uagFields[persona] : Object.values(form.uagFields)[0];
            if (!uag) {
                return project.mcpResponse(ResponseTemplate.uagComponentNotFound, {
                    form: form.form,
                    persona: persona || 'default'
                }, true);
            }

            const submission = await form.loadSubmission(submission_id, extra.authInfo);
            if (!submission) {
                return project.mcpResponse(ResponseTemplate.submissionNotFound, {
                    form: form.form,
                    submissionId: submission_id
                }, true);
            }

            let agentFields: UAGComponentInfo[] = [];
            Utils.eachComponent(uag.components, (component, path) => {
                const compInfo = form.getComponentInfo(component, `uag.${path}`);
                compInfo.rule = form.getComponentValueRule(component);
                agentFields.push(compInfo);
            });

            // We must have agent fields, persona, and criteria to proceed.
            if (!uag.persona || !uag.criteria || agentFields.length === 0) {
                return project.mcpResponse(ResponseTemplate.uagComponentNotFound, { form: form.form }, true);
            }

            // Collect more required fields.
            return project.mcpResponse(ResponseTemplate.agentProcessData, {
                persona: uag.persona,
                criteria: uag.criteria,
                values: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldValues, {
                    data: form.formatData(submission.data)
                }),
                fields: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: agentFields })
            });
        }
    });
};