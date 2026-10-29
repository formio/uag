import z from "zod";
import { FormflowTool } from "../formflow";
import type { AuthRequest } from "@formio/appserver";
import type { UAGProjectInterface } from "../UAGProjectInterface";
import { getTools } from "../tools";
import { ToolInfo } from "../tools/utils";

/** Every tool the UAG serves, including custom tools from configuration. */
export async function allTools(project: UAGProjectInterface): Promise<ToolInfo[]> {
    return [...await getTools(project), ...(project.config?.tools || [])].filter((tool) => !!tool?.name);
}

/**
 * An MCP tool as an Agentic Formflow tool: its schema as JSON, its arguments
 * validated with its own schema, and read-only only when annotated so.
 */
export function formflowTool(tool: ToolInfo): FormflowTool {
    const schema = z.object(tool.inputSchema || {});
    const inputSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, any>;
    delete inputSchema.$schema;
    return {
        name: tool.name!,
        description: tool.description || tool.title || tool.name!,
        readOnly: tool.annotations?.readOnlyHint === true,
        inputSchema,
        parse: (args: unknown) => {
            const parsed = schema.safeParse(args || {});
            return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: parsed.error.message };
        },
        execute: async (args: any, auth: AuthRequest) => tool.execute(args, { authInfo: auth })
    };
}
