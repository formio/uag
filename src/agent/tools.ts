import z from "zod";
import { FormflowTool } from "../formflow";
import type { AuthRequest } from "@formio/appserver";
import type { UAGProjectInterface } from "../UAGProjectInterface";
import { getTools } from "../tools";
import { ToolEntry, ToolExtra, ToolInfo, assertToolEntries } from "../tools/utils";

/**
 * A `config.tools` entry as a tool for the project: a bound tool's static
 * fields, overlaid with what its `bind(project)` returns. A tool without
 * `bind` (the 1.x shape) is used as it is.
 */
export async function resolveTool(project: UAGProjectInterface, entry: ToolEntry): Promise<ToolInfo | undefined> {
    if (!entry || typeof entry.bind !== 'function') return entry;
    const { bind, ...fixed } = entry;
    return { ...fixed, ...((await bind(project)) || {}) };
}

/**
 * Every tool the UAG serves, including custom tools from configuration, each
 * entry of which is a tool, optionally bound to the project.
 */
export async function allTools(project: UAGProjectInterface): Promise<ToolInfo[]> {
    assertToolEntries(project.config?.tools);
    const custom = await Promise.all((project.config?.tools || []).map((entry) => resolveTool(project, entry)));
    return [...await getTools(project), ...custom].filter((tool): tool is ToolInfo => !!tool?.name);
}

/**
 * Run a tool with its arguments and the `ToolExtra` for the project: the same
 * call on `/mcp` and for Agent API research. `context` is whatever else the
 * caller has (on `/mcp`, the MCP SDK's request context, with `authInfo`).
 */
export function runTool(tool: ToolInfo, project: UAGProjectInterface, args: any, context: { authInfo: AuthRequest; [key: string]: any }) {
    if (!tool.execute) {
        return { content: [{ type: 'text' as const, text: `The tool "${tool.name}" has no implementation.` }], isError: true };
    }
    const extra: ToolExtra = { ...context, authInfo: context.authInfo, project };
    return tool.execute(args ?? {}, extra);
}

/**
 * An MCP tool as an Agentic Formflow tool: its schema as JSON, its arguments
 * validated with its own schema, and read-only only when annotated so.
 */
export function formflowTool(tool: ToolInfo, project: UAGProjectInterface): FormflowTool {
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
        execute: async (args: any, auth: AuthRequest) => runTool(tool, project, args, { authInfo: auth })
    };
}
