import { ZodRawShape } from "zod";
export type ToolInfo = {
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: ZodRawShape | undefined;
    execute?: any;
}