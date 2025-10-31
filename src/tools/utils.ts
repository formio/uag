import { ZodRawShape } from "zod";
import { Form } from '@formio/core';
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

export function getParentLabel(parent?: ParentInfo, form?: Form): string {
    let parentLabel = form ? `the **${form.title} (${form.name})** form` : 'this form';
    if (parent?.isTable) {
        parentLabel = `this row within the **${parent.label}** component`;
    } else if (parent?.isForm) {
        parentLabel = `the **${parent.label}** nested form`;
    } else if (parent?.isContainer) {
        parentLabel = `the **${parent.label}** container component`;
    }
    return parentLabel;
}

export function getParentDataPath(parent?: ParentInfo, rowIndex: number = -1): string {
    let parentDataPath = parent?.data_path || '';
    if (parentDataPath && (rowIndex >= 0)) {
        parentDataPath += `[${rowIndex}]`;
    }
    if (parent?.isForm) {
        parentDataPath += '.data';
    }
    return parentDataPath;
}