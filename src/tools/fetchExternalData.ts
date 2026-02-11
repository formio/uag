import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./utils";
import { UAGFormInterface } from "../UAGFormInterface";
import { Component, SelectComponent, Evaluator } from "@formio/core";
import { SchemaBuilder } from './SchemaBuilder';
import { defaultsDeep, get } from "lodash";
const error = require('debug')('formio:uag:fetchExternalData:error');

/**
 * Strip HTML tags from a string.
 */
function stripHtml(str: string): string {
    return str.replace(/<[^>]*>/g, '').trim();
}

/**
 * Extract label from an item using the component's template.
 * For resource select items, the item is a full submission object with data nested under `item.data`.
 * The template may reference `item.propertyName` which could be at `item.data.propertyName`.
 */
function extractLabel(item: any, component: SelectComponent, evalContext: Record<string, any>): string {
    if (component.template) {
        evalContext.item = item; // Add the current item to the interpolation context for template evaluation
        const label = Evaluator.interpolateString(component.template, evalContext);
        if (label !== undefined && label !== null) {
            return stripHtml(String(label));
        }
    }
    // Fallback: try common label properties
    return item.label || item.name || item.title || String(item);
}

/**
 * Extract value from an item using the component's valueProperty.
 */
function extractValue(item: any, component: SelectComponent): any {
    if (component.valueProperty) {
        return get(item, component.valueProperty);
    }
    return item;
}

/**
 * Check if a component is a select-type component with external data (url or resource).
 */
function isExternalSelect(component: Component): boolean {
    if (component.type !== 'select' && component.type !== 'selectboxes') return false;
    const dataSrc = (component as SelectComponent).dataSrc;
    return dataSrc === 'url' || dataSrc === 'resource';
}

/**
 * Check if a component is a datasource component.
 */
function isDatasource(component: Component): boolean {
    return component.type === 'datasource';
}

/**
 * Interpolate header key/value pairs, filtering out empty ones.
 */
function interpolateHeaders(
    headers: Array<{ key: string; value: string }> | undefined,
    context: Record<string, any>
): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers || !Array.isArray(headers)) return result;
    for (const header of headers) {
        const key = header.key ? Evaluator.interpolateString(header.key, context) : '';
        const value = header.value ? Evaluator.interpolateString(header.value, context) : '';
        if (key && value) {
            result[key] = value;
        }
    }
    return result;
}

export const fetchExternalData = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.fetch_external_data || {}, {
        name: 'fetch_external_data',
        title: 'Fetch External Data',
        description: 'Fetch external data for a component that loads data from an external URL, a Form.io Resource, or a DataSource. Use this tool when `get_form_fields` indicates that a field requires calling `fetch_external_data` to retrieve its data. For select components, this returns the available options. For datasource components, this returns the fetched data. You can optionally provide a `search_value` to filter results server-side. If the component\'s URL or headers contain interpolation tokens (e.g. `{{ data.someField }}`), you MUST provide `form_data` with the current collected data so the tokens can be resolved.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .field_path()
            .form_data()
            .search_value().schema,
        execute: async ({ form_name, field_path, form_data, search_value }: {
            form_name: string;
            field_path: string;
            form_data?: Record<string, any>;
            search_value?: string;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            try {
                const component = form.getComponent(field_path) as Component | undefined;
                if (!component) {
                    return project.mcpResponse(ResponseTemplate.fetchExternalDataError, {
                        fieldPath: field_path,
                        error: `No component found at path "${field_path}".`
                    }, true);
                }

                // Build the interpolation context from the current form data.
                const submission = form_data ? form.convertToSubmission(form_data) : { data: {} };
                const evalContext: Record<string, any> = {
                    form: form.form,
                    component,
                    components: form.form.components,
                    data: submission.data || {},
                    row: submission.data || {},
                    submission
                };

                if (isDatasource(component)) {
                    const items = await fetchDatasourceData(component, extra.authInfo, evalContext);
                    return project.mcpResponse(ResponseTemplate.fetchExternalData, {
                        label: component.label || component.key,
                        fieldPath: field_path,
                        options: items.map((item: any) => ({
                            label: item.name || item.label || item.title || JSON.stringify(item),
                            value: item
                        }))
                    });
                }

                if (!isExternalSelect(component)) {
                    return project.mcpResponse(ResponseTemplate.fetchExternalDataError, {
                        fieldPath: field_path,
                        error: `Component at "${field_path}" is of type "${component.type}" and does not load external data. This tool only supports select/selectboxes components with dataSrc "url" or "resource", and datasource components.`
                    }, true);
                }

                const selectComponent = component as SelectComponent;
                const dataSrc = selectComponent.dataSrc;
                if (dataSrc !== 'url' && dataSrc !== 'resource') {
                    return project.mcpResponse(ResponseTemplate.fetchExternalDataError, {
                        fieldPath: field_path,
                        error: `Component at "${field_path}" has dataSrc "${dataSrc}". Only "url" and "resource" are supported by this tool.`
                    }, true);
                }

                let items: any[] = [];

                if (dataSrc === 'url') {
                    items = await fetchUrlData(selectComponent, search_value, extra.authInfo, evalContext);
                } else if (dataSrc === 'resource') {
                    items = await fetchResourceData(selectComponent, search_value, extra.authInfo, project, evalContext);
                }

                const options = items.map(item => ({
                    label: extractLabel(item, selectComponent, evalContext),
                    value: extractValue(item, selectComponent)
                }));

                return project.mcpResponse(ResponseTemplate.fetchExternalData, {
                    label: selectComponent.label || selectComponent.key,
                    fieldPath: field_path,
                    options
                });
            } catch (err) {
                error('Error fetching external data:', err);
                return project.mcpResponse(ResponseTemplate.fetchExternalDataError, {
                    fieldPath: field_path,
                    error: err instanceof Error ? err.message : 'Unknown error'
                }, true);
            }
        }
    });
};

async function fetchDatasourceData(
    component: Component,
    authInfo: any,
    context: Record<string, any>
): Promise<any[]> {
    const fetchConfig = (component as any).fetch;
    if (!fetchConfig?.url) {
        throw new Error('No URL configured for this datasource component.');
    }

    // Interpolate the URL
    const interpolatedUrl = Evaluator.interpolateString(fetchConfig.url, context);
    const url = new URL(interpolatedUrl);

    // Build and interpolate headers
    const headers = interpolateHeaders(fetchConfig.headers, context);

    // Add auth token if forwardHeaders or authenticate is enabled
    if ((fetchConfig.forwardHeaders || fetchConfig.authenticate) && authInfo?.token) {
        headers['x-jwt-token'] = authInfo.token;
    }

    const response = await fetch(url.toString(), {
        method: (fetchConfig.method || 'get').toUpperCase(),
        headers
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let result = await response.json();

    if (!Array.isArray(result)) {
        // If the result has a 'results' property that is an array, use that
        if (result.results && Array.isArray(result.results)) {
            result = result.results;
        } else {
            // Wrap single objects in an array
            result = [result];
        }
    }

    return result;
}

async function fetchUrlData(
    component: SelectComponent,
    search_value: string | undefined,
    authInfo: any,
    context: Record<string, any>
): Promise<any[]> {
    const data = component.data as any;
    const baseUrl = data?.url;
    if (!baseUrl) {
        throw new Error('No URL configured for this component.');
    }

    // Interpolate the URL
    const interpolatedUrl = Evaluator.interpolateString(baseUrl, context);
    const url = new URL(interpolatedUrl);

    // Add filter query string if configured (interpolate the filter string)
    if (component.filter) {
        const interpolatedFilter = Evaluator.interpolateString(component.filter, context);
        const filterParams = new URLSearchParams(interpolatedFilter);
        filterParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
    }

    // Add search parameter if provided
    if (search_value && component.searchField) {
        url.searchParams.set(component.searchField, search_value);
    }

    // Add limit
    const limit = component.limit || 100;
    url.searchParams.set('limit', String(limit));

    // Build and interpolate headers
    const headers = interpolateHeaders(data.headers, context);

    // Add auth token if authenticate is enabled
    if (component.authenticate && authInfo?.token) {
        headers['x-jwt-token'] = authInfo.token;
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let result = await response.json();

    // Navigate to selectValues path if configured
    if ((component as any).selectValues) {
        result = get(result, (component as any).selectValues, result);
    }

    if (!Array.isArray(result)) {
        throw new Error('Response is not an array. Check the URL and selectValues configuration.');
    }

    return result;
}

async function fetchResourceData(
    component: SelectComponent,
    search_value: string | undefined,
    authInfo: any,
    project: UAGProjectInterface,
    context: Record<string, any>
): Promise<any[]> {
    const data = component.data as any;
    const resourceId = data?.resource;
    if (!resourceId) {
        throw new Error('No resource ID configured for this component.');
    }

    const resourceForm = await project.getFormById(resourceId) as UAGFormInterface;
    if (!resourceForm) {
        throw new Error(`Resource form with ID "${resourceId}" not found.`);
    }

    const query: Record<string, any> = {};

    // Add search filter if provided
    if (search_value && component.searchField) {
        query[`data.${component.searchField}__regex`] = `/${search_value}/i`;
    }

    // Add component filter if configured (interpolate the filter string)
    if (component.filter) {
        const interpolatedFilter = Evaluator.interpolateString(component.filter, context);
        const filterParams = new URLSearchParams(interpolatedFilter);
        filterParams.forEach((value, key) => {
            query[key] = value;
        });
    }

    // Add limit
    query.limit = component.limit || 100;

    const result = await resourceForm.find(query, authInfo);
    return result.items || [];
}
