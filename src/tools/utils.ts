import { ZodRawShape } from "zod";
export type ToolInfo = {
    name?: string;
    title?: string;
    description?: string;
    inputSchema?: ZodRawShape | undefined;
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
