import { AuthRequest, FormInterface, InterpolatedError } from "@formio/appserver";
import {
    Component,
    TextFieldComponent,
    DateTimeComponent,
    DayComponent,
    SelectComponent,
    Utils,
    Submission,
    Processors,
    DataObject,
    componentHasValue,
    interpolateErrors,
    Form
} from "@formio/core";
import { set, get, isObjectLike } from "lodash";
import { UAGForm } from "./config";
import { ParentInfo } from "./tools";

export type UAGComponentInfo = {
    path: string;
    label: string;
    type: string;
    format: string;
    description: string;
    validation: any;
    options?: { label: string; value: string }[];
    prompt?: string;
    nested?: boolean;
};

export type UAGData = Array<{ label: string; value: any, path: string, prefix?: string }>;
export type UAGSubmission = {
    _id?: string;
    data: UAGData;
    created?: string | Date;
    modified?: string | Date;
}

export type FormFieldError = {
    label: string,
    path: string,
    error: string
};

export type FormFieldInfo = {
    rowIndex: number;
    total: number;
    totalRequired: number;
    totalRequiredCollected: number;
    errors: FormFieldError[];
    required: {
        rules: Record<string, string>,
        components: UAGComponentInfo[]
    },
    optional: {
        rules: Record<string, string>,
        components: UAGComponentInfo[]
    };
}

export class UAGFormInterface extends FormInterface {
    public uag: UAGForm | null = null;
    getComponentFormat(component: Component): string {
        switch (component.type) {
            case 'phoneNumber':
                return (component as TextFieldComponent).inputMask || '(999) 999-9999';
            case 'datetime':
                return (component as DateTimeComponent).widget?.format || 'yyyy-MM-dd hh:mm a';
            case 'day':
                return (component as DayComponent).dayFirst ? 'dd/MM/yyyy' : 'MM/dd/yyyy';
            case 'time':
                return (component as DateTimeComponent).format || 'HH:mm';
            default:
                return '';
        }
    }

    getComponentInfo(component: Component, path: string): UAGComponentInfo {
        const fieldInfo: UAGComponentInfo = {
            path,
            label: component.label || component.key,
            type: component.type,
            format: this.getComponentFormat(component),
            description: component.description || component.tooltip || '',
            validation: component.validate || {},
        };
        if (component.placeholder) {
            fieldInfo.prompt = component.placeholder;
        }
        if (component.type === 'select' || component.type === 'selectboxes') {
            if ((component as SelectComponent).dataSrc === 'url') {
                fieldInfo.options = [{ label: '** ANY VALUE IS ALLOWED **', value: 'Options are loaded from a URL.' }];
            } else if ((component as SelectComponent).dataSrc === 'resource') {
                fieldInfo.options = [{ label: '** ANY VALUE IS ALLOWED **', value: `Options are loaded from the Form.io resource (${((component as SelectComponent).data as any).resource}).` }];
            } else if ((component as SelectComponent).dataSrc === 'json') {
                fieldInfo.options = [{ label: '** ANY VALUE IS ALLOWED **', value: 'Options are not dynamically defined.' }];
            } else {
                const values = ((component as SelectComponent).data as any)?.values || (component as any).values;
                if (!values || !Array.isArray(values)) {
                    fieldInfo.options = [{ label: '', value: 'No options available' }];
                }
                else {
                    fieldInfo.options = values.reduce((acc: { label: string; value: string }[], v: any) => {
                        acc.push({ label: v.label, value: v.value });
                        return acc;
                    }, []);
                }
            }
        }
        fieldInfo.nested = this.isNestedComponent(component);
        return fieldInfo;
    }

    isMultiple(component: Component | undefined): boolean {
        if (!component) return false;
        return !!component.multiple || component.type === 'selectboxes' || component.type === 'tags';
    }

    getParentInfoFromComponent(parent: Component | undefined, parent_path?: string): ParentInfo | undefined {
        if (!parent || !parent_path) return undefined;
        const parentInfo: ParentInfo = {
            type: parent.type,
            label: parent.label || parent.key,
            data_path: parent_path
        };
        if (
            (parent as any).tree ||
            parent.type === 'datagrid' ||
            parent.type === 'editgrid'
        ) {
            parentInfo.isTable = true;
            return parentInfo;
        }
        if (parent.type === 'form') {
            parentInfo.isForm = true;
            return parentInfo;
        }
        if (parent.type === 'container') {
            parentInfo.isContainer = true;
            return parentInfo;
        }
        return parentInfo;
    }

    getParentInfo(parent_path?: string): ParentInfo | undefined {
        if (!parent_path) return undefined;
        const parent = this.getComponent(parent_path);
        return this.getParentInfoFromComponent(parent, parent_path);
    }

    getParentLabel(parent?: ParentInfo): string {
        if (parent?.isTable) {
            return `this row within the **${parent.label}** component`;
        } else if (parent?.isForm) {
            return `the **${parent.label}** nested form`;
        } else if (parent?.isContainer) {
            return `the **${parent.label}** container component`;
        }
        return `the **${this.form.title} (${this.form.name})** form`;
    }

    getParentDataPath(parent: ParentInfo | undefined, rowIndex: number = -1): string {
        if (parent?.isTable && (rowIndex >= 0)) {
            return `${parent.data_path}[${rowIndex}]`;
        }
        if (parent?.isForm) {
            return `${parent.data_path}.data`;
        }
        return parent?.data_path || '';
    }

    getParentToolDescription(parent: ParentInfo | undefined): string {
        if (!parent) return '';
        return `To determine what fields are within this component, use the \`get_form_fields\` tool with \`parent_path\`="<data_path>" (e.g. \`parent_path\`="${parent.data_path}"). To collect data for this component, use the \`collect_field_data\` tool with the \`parent_path\` set for the parent's data_path.`;
    }

    getComponentValueRule(component: Component, data_path?: string) {
        let rule = '';
        const parent = this.getParentInfoFromComponent(component, data_path);
        if (parent?.isTable) {
            rule += 'The value is a table of rows (array of objects), where each row is a new instance of data values for the child components. ' + this.getParentToolDescription(parent) + 'All `data_path`(s) for the components within this table should contain the current row index (e.g. `dataGrid[0].a`, `dataGrid[0].b`, `dataGrid[1].b`, etc.).';
            return rule;
        }
        if (parent?.isForm) {
            rule += 'The value is a nested form submission in the format `{data: {...}}` where `{...}` is the values for the child components. ' + this.getParentToolDescription(parent) + 'All `data_path`(s) for the components within this nested form should be prefixed with `data` (e.g. `nestedForm.data.exampleField`).';
            return rule;
        }
        if (parent?.isContainer) {
            rule += 'The value is an object/map of nested component values in the format `{...}`. ' + this.getParentToolDescription(parent) + 'All `data_path`(s) for the components within this container should be prefixed with the container\'s `data_path` (e.g. `container.exampleField`).';
            return rule;
        }
        switch (component.type) {
            case 'tags':
                rule += 'The value can be any alphanumeric string, containing letters, numbers, but no white space characters or symbols. Multiple tags should be comma-separated.';
                break;
            case 'signature':
                rule += 'Have the user draw their signature. The value will be a base64-encoded PNG image string of that signature.';
                break;
            case 'textfield':
            case 'textarea':
            case 'hidden':
                rule += 'The value can be any alphanumeric string, containing letters, numbers, white space characters, and common symbols.';
                break;
            case 'checkbox':
                rule += 'The value must be either boolean true (checked) or false (unchecked). A checkbox is checked if the user confirms the value. (e.g. "I agree to the terms and conditions" -> true)';
                break;
            case 'number':
                rule += 'The value must be a valid number.';
                break;
            case 'currency':
                rule += 'The value must be a valid currency amount (a number with up to two decimal places).';
                break;
            case 'password':
                rule += 'Do not allow the user to submit passwords.';
                break;
            case 'phoneNumber':
                rule += 'The value must be a valid phone number, containing only numbers, spaces, parentheses, dashes, and must follow the format defined in the "**Format**" section of that component.';
                break;
            case 'selectboxes':
            case 'select':
            case 'radio':
                rule += `The value must be ${this.isMultiple(component) ? 'one or more (as comma separated values)' : 'one'} of the following options provided in the "**Options**" section of that component, formatted as " - Label (value)":`;
                break;
            case 'datetime':
                rule += 'The value must be a valid date and time string in the format provided by the **Format** section of that component.';
                break;
            case 'day':
                rule += 'The value must be a valid day string in the format provided by the **Format** section of that component.';
                break;
            case 'time':
                rule += 'The value must be a valid time string in the format provided by the **Format** section of that component.';
                break;
            case 'url':
                rule += 'The value must be a valid URL, starting with http:// or https://';
                break;
            case 'email':
                rule += 'The value must be a valid email address.';
                break;
            default:
                rule += '';
        }
        return rule;
    }

    /**
     * Determine if the component is a nested data components. For these components, the UAG treats them as 
     * separate data collection units where the agent will explicitely call out to collect data for these components.
     * 
     * @import { Component } from "@formio/core";
     * @param component { Component } - The component to check.
     * @returns { boolean } - True if the component is a nested data component, false otherwise.
     */
    isNestedComponent(component: Component): boolean {
        if (
            (component as any).tree ||
            component.type === 'datagrid' ||
            component.type === 'editgrid' ||
            component.type === 'form'
        ) {
            return true;
        }
        return false;
    }

    /**
     * Determine if the component is a non-input component that should be skipped when collecting fields.
     * 
     * @import { Component } from "@formio/core";
     * @param component { Component } - The component to check.
     * @returns { boolean } - True if the component is an input component, false otherwise.
     */
    inputComponent(component: Component): boolean {
        const modelType = Utils.getModelType(component);
        if (component.input === false || component.type === 'button') {
            return false;
        }
        if (!component.type || modelType === 'none' || modelType === 'content') {
            return false;
        }
        return true;
    }

    /**
     * Get the relevant fields from the current form. This will return any non-nested input components whose
     * values have not already been set within the data model. This allows the agent to know what fields still need to be 
     * collected from the user, as well as provides a mechanism to break up large forms into smaller chunks of data collection
     * using the 'nested' components (datagrid, editgrid, nested form, etc.).
     * 
     * @import { Submission } from "@formio/core";
     * @import { AuthRequest } from "@formio/appserver";
     * @param submission { Submission } - The current submission data model.
     * @param authInfo { AuthRequest } - The current authentication information.
     * @param within { string | string[] } - Optional data path or array of data paths to limit the field extraction within.
     *  - If within is an array, then it works like "includes". 
     *  - If within is a string, then it is a single path to limit components within (non-inclusive).
     * @returns { Promise<FormFieldInfo> } - The extracted form field information.
     */
    async getFields(
        submission: Submission,
        authInfo: AuthRequest,
        within: string | string[] = ''
    ): Promise<FormFieldInfo> {
        const fieldInfo: FormFieldInfo = {
            rowIndex: -1,
            total: 0,
            totalRequired: 0,
            totalRequiredCollected: 0,
            errors: [],
            required: { components: [], rules: {} },
            optional: { components: [], rules: {} }
        };
        const nestedPaths: string[] = [];
        const context = await this.process(submission, authInfo, null, null, null, [
            ...Processors,
            {
                name: 'getFields',
                shouldProcess: () => true,
                process: async (context) => {
                    const { component, path, value } = context;
                    if (this.isNestedComponent(component)) {
                        nestedPaths.push(path);
                    }
                },
                postProcess: async (context: any) => {
                    const { component, path, value } = context;

                    // Get the current nested path (if any).
                    const nestedPath = nestedPaths?.length ? nestedPaths[nestedPaths.length - 1] : null;

                    // If the nested path IS the nested component, then pop it off the stack and skip it.
                    if (nestedPath === path) {
                        nestedPaths.pop();
                    }

                    if (within) {
                        // If within is an array, then this works like "includes".
                        if (Array.isArray(within) && !within.includes(path)) {
                            return;
                        }
                        if (typeof within === 'string') {
                            if (path.startsWith(within) && (path !== within)) {
                                // Make sure to set the largest index for the nested component.
                                const indexMatch = path.match(/\[(\d+)\]/);
                                fieldInfo.rowIndex = indexMatch?.length ? parseInt(indexMatch[indexMatch.length - 1], 10) : 0;
                            }
                            else {
                                return;
                            }
                        }

                        // If within is a string, then it is a single path to limit components within (non-inclusive).
                        if ((typeof within === 'string') && (!path.startsWith(within) || (path === within))) {
                            return;
                        }
                    }
                    // If this is a component within the nested path, then skip it...
                    else if (nestedPath && path.startsWith(nestedPath) && (path !== nestedPath)) {
                        return;
                    }

                    // Skip non-input components and conditionally hidden components.
                    if (!this.inputComponent(component) || component.scope?.conditionallyHidden) {
                        return;
                    }

                    // Increment the total field count regardless of whether it has a value or not.
                    fieldInfo.total++;
                    if (component.validate?.required) {
                        fieldInfo.totalRequired++;
                    }

                    // If the component hass a value, then skip it.
                    if (componentHasValue(component, value)) {
                        if (component.validate?.required) {
                            fieldInfo.totalRequiredCollected++;
                        }
                        return;
                    }

                    // Add the component info to the appropriate list.
                    const criteria = component.validate?.required ? 'required' : 'optional';
                    fieldInfo[criteria].rules[component.type] = this.getComponentValueRule(component, path);
                    fieldInfo[criteria].components.push(this.getComponentInfo(component, path));
                }
            }
        ]);
        if (context.scope?.errors?.length) {
            // Filter the "required" validation since those are added to the fieldInfo separately.
            context.scope.errors = context.scope.errors.filter((error: any) => (error.ruleName !== 'required'));
            if (context.scope.errors?.length) {
                fieldInfo.errors = this.convertToFormFieldErrors(interpolateErrors(context.scope.errors));
            }
        }
        return fieldInfo;
    }

    /**
     * Return the component at the specified data path.
     * @param path { string } - The data path of the component to retrieve.
     * @returns { Component | undefined } - The component at the specified path, or undefined if not found.
     */
    getComponent(path: string): Component | undefined {
        return Utils.getComponent(this.form.components, path);
    }

    /**
     * Convert a list of InterpolatedErrors into FormFieldErrors.
     * @param errors 
     * @returns 
     */
    convertToFormFieldErrors(errors: InterpolatedError[]): FormFieldError[] {
        return errors.map((error) => {
            return {
                label: error.context?.label || 'Field',
                path: error.context?.path,
                error: error.message || 'Unknown validation error'
            };
        });
    }

    /**
     * Perform a validation process on the collected form data.
     * @param data 
     * @param auth 
     * @returns 
     */
    async validateData(
        submission: Submission,
        auth: AuthRequest
    ): Promise<FormFieldError[]> {
        return this.convertToFormFieldErrors(await this.validate(submission, auth));
    }

    convertToSubmission(data?: Record<string, any>): Submission {
        const submission: any = { data: {} };
        for (let [path, value] of Object.entries(data || {})) {
            const comp = this.getComponent(path);
            if (value && comp?.type === 'selectboxes' && typeof value === 'string') {
                value = value.split(',').reduce((obj: any, v: string) => {
                    obj[v.trim()] = true;
                    return obj;
                }, {});
            }
            else if (value && this.isMultiple(comp) && typeof value === 'string') {
                value = value.split(',').map((v: string) => v.trim());
            }
            set(submission.data, path, value);
        }
        return submission as Submission;
    }

    formatData(data: DataObject = {}): UAGData {
        const uagData: UAGData = [];
        let prefix = '';
        Utils.eachComponentData(this.form?.components || [], data, (component, data, row, path) => {
            let value = get(data, path);
            if (this.isNestedComponent(component)) {
                uagData.push({
                    prefix,
                    path,
                    label: component.label || component.key || path,
                    value: ''
                });
                prefix += '  ';
            }
            else if (this.inputComponent(component) && componentHasValue(component, value)) {
                uagData.push({
                    prefix,
                    path,
                    label: component.label || component.key || path,
                    value: isObjectLike(value) ? JSON.stringify(value) : value
                });
            }
        }, false, false, undefined, undefined, undefined, (component, data) => {
            if (this.isNestedComponent(component)) {
                prefix = prefix.slice(0, -3) + "\n";
            }
        });
        return uagData;
    }

    formatSubmission(submission: Submission): UAGSubmission {
        return {
            _id: submission._id,
            data: this.formatData(submission.data),
            created: submission.created,
            modified: submission.modified
        };
    }
}