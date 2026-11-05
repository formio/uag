import { ZodRawShape } from "zod";
import { escapeRegExp } from "lodash";
import { ToolAnnotations } from "./annotations";
import type { AuthRequest } from "@formio/appserver";
import type { UAGProjectInterface } from "../UAGProjectInterface";

/**
 * Escape a literal value so it can be carried in a `__regex` query parameter.
 *
 * Operators like "contains" promise a literal match, so every regular expression
 * metacharacter in the value has to be neutered first. Left raw, a search for
 * "joe.thompson@example.com" becomes a pattern whose dots match any character,
 * and a value such as "[" is not a valid pattern at all — the server compiles
 * these with a try/catch and silently drops the filter when compilation fails,
 * which turns a narrow search into one that matches everything.
 *
 * Forward slashes get a further step. The server reads the parameter as
 * `/pattern/flags` and takes the pattern with `[^/]+`, so an embedded slash
 * truncates the pattern and the remainder is parsed as flags — again dropping
 * the filter. Writing it as the equivalent `\x2f` escape keeps the character
 * out of the transport while still matching a literal slash.
 *
 * @param value - The literal text to search for.
 * @returns The value as a regular expression pattern that matches it literally.
 */
export const escapeSearchPattern = (value: string): string =>
    escapeRegExp(value).replace(/\//g, '\\x2f');

/**
 * What a tool's `execute` receives besides its arguments, on every path that
 * runs it: MCP clients on `/mcp`, and Agent API research in process.
 */
export type ToolExtra = {
    /** The caller's identity: who the work runs as. Pass it to form methods so Form.io applies its permissions. */
    authInfo: AuthRequest;
    /** The project serving the request. */
    project: UAGProjectInterface;
    /** On `/mcp`, the rest of the MCP SDK's request context (signal, request id, ...). */
    [key: string]: any;
};

export type ToolInfo = {
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: ZodRawShape | undefined;
    // Whether calling this tool reads or writes. Not optional in practice: the
    // annotations test fails a tool that ships without them.
    annotations?: ToolAnnotations;
    /**
     * Runs the tool: always called with its arguments (an empty object when it
     * takes none), then a `ToolExtra`. Typed loosely so existing tools and their
     * callers keep compiling; annotate `extra` as `ToolExtra` in your own tools.
     */
    execute?: any;
    /**
     * Builds the project-specific part of the tool (`inputSchema`, `annotations`,
     * `execute`, ...) for a project, as the built-in tools are built. The static
     * `name`, `title` and `description` are used unless `bind` returns its own,
     * so the tool's name is known without a project. Called whenever the tool
     * list is built (every `/mcp` request and every research plan): keep it
     * cheap, and load libraries and other slow state once, outside it.
     */
    bind?: (project: UAGProjectInterface) => Partial<ToolInfo> | Promise<Partial<ToolInfo>>;
}

/** An entry of `config.tools`: a tool, optionally bound to the project with `bind`. */
export type ToolEntry = ToolInfo;

/** The shape a `config.tools` entry takes, shown when one is a bare function. */
export const BOUND_TOOL_SHAPE = "{ name: 'my_tool', title: 'My Tool', description: '...', bind(project) { return { inputSchema, annotations, execute }; } }";

/**
 * Refuse `config.tools` entries that are bare functions (the unreleased factory
 * form): a tool is an object, whose `bind(project)` builds its project-specific
 * part. Throws naming the entry and showing the shape.
 */
export function assertToolEntries(entries: unknown[] | undefined): void {
    (entries || []).forEach((entry, index) => {
        if (typeof entry === 'function') {
            throw new Error(`config.tools[${index}] is a function. A custom tool is an object; build its project-specific part with bind(project): ${BOUND_TOOL_SHAPE}`);
        }
    });
}

export type ParentInfo = {
    type: string;
    label?: string;
    data_path?: string;
    isForm?: boolean;
    isTable?: boolean;
    isContainer?: boolean;
}

export type DataUpdate = {
    data_path: string;
    new_value: any;
}

export type SearchQuery = {
    data_path: string;
    search_value: string;
    operator: string;
}
