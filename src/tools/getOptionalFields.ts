import z from "zod";
import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./types";
import { UAGFormInterface } from "../UAGFormInterface";
import { defaultsDeep } from "lodash";
export const getOptionalFields = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.get_optional_fields || {}, {
        name: 'get_optional_fields',
        title: 'Get Optional Fields',
        description: 'Show available optional fields and ask if the user wants to fill any of them after required fields are complete',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form'),
            current_data: z.record(z.any()).describe('The current collected form data as key-value pairs (using field paths as keys)')
        },
        execute: async ({ form_name, current_data }: any, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            const submission = form.convertToSubmission(current_data);
            const fields = await form.getFields(submission, extra.authInfo);

            // See if there are still required fields to fill out...
            if (fields.required.length) {
                return project.mcpResponse(ResponseTemplate.fieldCollectedNext, {
                    message: 'There are more "required" fields that still need to be submitted.',
                    rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.rules) }),
                    requiredFields: project.uagTemplate?.renderTemplate(ResponseTemplate.fields, { fields: fields.required }),
                    progress: {
                        collected: Object.keys(current_data).length,
                        total: fields.required.length + Object.keys(current_data).length
                    }
                });
            }


            return project.mcpResponse(ResponseTemplate.getOptionalFields, {
                form: form.form,
                rules: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldRules, { rules: Object.entries(fields.rules) }),
                totalOptionalFields: fields.optional.length,
                optionalFields: project.uagTemplate?.renderTemplate(ResponseTemplate.fieldList, { fields: fields.optional }),
                dataSummary: project.uagTemplate?.renderTemplate(ResponseTemplate.collectedData, {
                    data: form.formatSubmission(submission).data
                })
            });
        }
    });
};