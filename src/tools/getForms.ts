import { defaultsDeep } from "lodash";
import { UAGFormInterface } from "../UAGFormInterface";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ResponseTemplate } from "../template";
import { ToolInfo } from "./types";
export const getForms = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.get_forms || {}, {
        name: 'get_forms',
        title: 'Get Available Forms',
        description: 'Get a list of all available forms with their descriptions. Use this tool when a user expresses intent to add, create, submit, fill out, register for something (e.g., "I want to add a new Contact", "I need to submit a User Registration", "I met a contact who was the CMO", "What was the email of the contact"). This tool can also be used when they ask what forms are available.',
        inputSchema: {},
        execute: async ({}, extra: any) => {
            const forms = Object.values(project.forms).filter(form => (form as UAGFormInterface).uag);
            if (forms.length === 0) {
                return project.mcpResponse(ResponseTemplate.noFormsAvailable, {
                    message: 'No forms are currently available in this project.'
                });
            }

            // Check the forms to ensure the user can submit them.
            return project.mcpResponse(ResponseTemplate.getAvailableForms, {
                forms: forms.map(form => {
                    const perms = extra.authInfo.formPermissions(form);
                    const hasAccess = perms.create || perms.update || perms.read;
                    const uagForm = (form as UAGFormInterface).uag;
                    return {
                        name: uagForm?.name,
                        title: uagForm?.title,
                        description: uagForm?.description || `Form for ${uagForm?.title} data entry`,
                        permissions: perms,
                        hasAccess
                    };
                }),
                totalForms: forms.length
            });
        }
    });
}