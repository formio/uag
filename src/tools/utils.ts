import { ZodRawShape } from "zod";
import { escapeRegExp } from "lodash";
import { ToolAnnotations } from "./annotations";

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

export type ToolInfo = {
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: ZodRawShape | undefined;
    // Whether calling this tool reads or writes. Not optional in practice: the
    // annotations test fails a tool that ships without them.
    annotations?: ToolAnnotations;
    execute?: any;
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
