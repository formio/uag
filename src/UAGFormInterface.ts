import { AppServerForm, AuthRequest, FormInterface, InterpolatedError } from "@formio/appserver";
import type { FormflowForm, FormflowTask } from "./formflow";
import {
    Component,
    TextFieldComponent,
    TextAreaComponent,
    DateTimeComponent,
    ContentComponent,
    DayComponent,
    SelectComponent,
    HasChildComponents,
    Utils,
    Submission,
    Processors,
    DataObject,
    componentHasValue,
    interpolateErrors,
    ComponentPaths
} from "@formio/core";
import { set, get, isObjectLike, isEqual, isString } from "lodash";
import { UAGForm } from "./config";
import { ParentInfo } from "./tools";
import { NodeHtmlMarkdown } from 'node-html-markdown'
import { Router } from "express";
import { agentCredentials, FormAgentRouter } from "./agent/router";
import type { UAGProjectInterface } from "./UAGProjectInterface";

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
    rule?: string;
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

export type UAGFields = {
    task: string;
    criteria: string;
    components: Record<string, UAGComponentInfo>;
    /** Data paths of the components flagged `uagField: "input"`: the source text for extraction and decisions. */
    inputs?: string[];
    /** Task-level settings, read from the custom properties of the task's criteria component (e.g. `uagEngine`, `uagTools`). */
    settings?: Record<string, string>;
}

export class UAGFormInterface extends FormInterface implements FormflowForm {
    // Declared rather than initialized: FormInterface's constructor calls setForm(), which sets
    // these, and an initializer would run after it and reset them.
    declare public uag: UAGForm | null;
    declare public uagFields: Record<string, UAGFields>;

    /**
     * The form's routes, with its agent operations (`agent/extract`, `agent/decide`,
     * `agent/generate`) beside its submissions: the project's authentication has
     * already run, and the form is the one of the URL.
     */
    async router(): Promise<Router> {
        const router = await super.router();
        const project = this.project as unknown as UAGProjectInterface;
        router.use(FormAgentRouter(project, agentCredentials(project)));
        return router;
    }

    /**
     * Sets the form, deriving its UAG registration and agent fields from it. The form is set again
     * whenever it loads, and whenever a TTL refresh or a deploy brings a new version, so both are
     * rebuilt from the form each time rather than added to what an earlier version left.
     */
    setForm(form: AppServerForm): AppServerForm {
        this.uagFields = {};
        const result = super.setForm(form);
        const machineName = result.machineName;
        this.uag = result.tags?.includes('uag') ? {
            machineName,
            name: result.name || result.path || machineName,
            title: result.title || result.name || machineName,
            description: result.properties?.description || `A form to submit new ${result.title} records.`
        } : null;
        return result;
    }

    setComponent(
        form: AppServerForm,
        component: Component,
        path: string,
        components: Component[] | undefined,
        parent: Component | undefined,
        paths: ComponentPaths | undefined
    ): void {
        if (form.tags?.includes('uag') && component.properties?.uag) {
            const task = component.properties?.uag;
            if (!this.uagFields) {
                this.uagFields = {};
            }
            let uagFields: any = this.uagFields[task];
            if (!uagFields) {
                uagFields = { task, components: {} };
            }
            if (component.properties?.uagField) {
                const property = component.properties?.uagField;
                if (property === 'input') {
                    // An input can be a single field or a nested component; for a
                    // nested one, every child value under this path is input.
                    const inputPath = paths?.dataPath || component.key;
                    uagFields.inputs = [...(uagFields.inputs || []), inputPath];
                }
                else if ((component as ContentComponent)?.html) {
                    uagFields[property] = this.htmlToMarkdown((component as ContentComponent).html);
                }
                if (property === 'criteria') {
                    const { uag, uagField, ...settings } = component.properties || {};
                    uagFields.settings = { ...(uagFields.settings || {}), ...settings };
                }
            }
            else {
                if ((component as HasChildComponents).components) {
                    Utils.eachComponent((component as HasChildComponents).components, (subComp, subPath) => {
                        subPath = paths?.dataPath ? `${paths.dataPath}.${subPath}` : subPath;
                        const compInfo = this.getComponentInfo(subComp, subPath);
                        compInfo.rule = this.getComponentValueRule(subComp);
                        uagFields.components[compInfo.path] = compInfo;
                    });
                }
                else {
                    const compInfo = this.getComponentInfo(component, paths?.dataPath || '');
                    compInfo.rule = this.getComponentValueRule(component);
                    uagFields.components[compInfo.path] = compInfo;
                }
            }
            this.uagFields[task] = uagFields;
        }
        return super.setComponent(form, component, path, components, parent, paths);
    }

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
        // A radio's options are what its rule tells the agent to choose from.
        if (component.type === 'select' || component.type === 'selectboxes' || component.type === 'radio') {
            if ((component as SelectComponent).dataSrc === 'url') {
                fieldInfo.options = [{ label: '** USE fetch_external_data TOOL **', value: `Call the \`fetch_external_data\` tool with \`field_path\`="${path}" to retrieve available options from the external URL.` }];
            } else if ((component as SelectComponent).dataSrc === 'resource') {
                fieldInfo.options = [{ label: '** USE fetch_external_data TOOL **', value: `Call the \`fetch_external_data\` tool with \`field_path\`="${path}" to retrieve available options from the Form.io resource (${((component as SelectComponent).data as any).resource}).` }];
            } else if ((component as SelectComponent).dataSrc === 'json') {
                fieldInfo.options = [{ label: '** ANY VALUE IS ALLOWED **', value: 'Options are not dynamically defined.' }];
            } else {
                const values = ((component as SelectComponent).data as any)?.values || (component as any).values;
                if (!values || !Array.isArray(values)) {
                    fieldInfo.options = [{ label: '', value: 'No options available' }];
                }
                else {
                    fieldInfo.options = values.map((v: any) => ({ label: v.label, value: v.value }));
                }
            }
        }
        if (component.type === 'datasource') {
            fieldInfo.options = [{ label: '** USE fetch_external_data TOOL **', value: `Call the \`fetch_external_data\` tool with \`field_path\`="${path}" to retrieve data from the external datasource.` }];
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
        // The type comes first: the builder saves containers with `tree: true`
        // too, and a container holds one object, not rows.
        if (parent.type === 'form') {
            parentInfo.isForm = true;
        }
        else if (parent.type === 'container') {
            parentInfo.isContainer = true;
        }
        else if (
            (parent as any).tree ||
            parent.type === 'datagrid' ||
            parent.type === 'editgrid'
        ) {
            parentInfo.isTable = true;
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
        if (parent?.isTable) {
            return (rowIndex >= 0) ? `${parent.data_path}[${rowIndex}]` : `${parent.data_path}[0]`;
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
        const parent = this.getParentInfoFromComponent(component, data_path);
        if (parent?.isTable) {
            return 'The value is a table of rows (array of objects), where each row is a new instance of data values for the child components. ' + this.getParentToolDescription(parent) + ' All `data_path`(s) for the components within this table should contain the current row index (e.g. `dataGrid[0].a`, `dataGrid[0].b`, `dataGrid[1].b`, etc.).';
        }
        if (parent?.isForm) {
            return 'The value is a nested form submission in the format `{data: {...}}` where `{...}` is the values for the child components. ' + this.getParentToolDescription(parent) + ' All `data_path`(s) for the components within this nested form should be prefixed with `data` (e.g. `nestedForm.data.exampleField`).';
        }
        if (parent?.isContainer) {
            return 'The value is an object/map of nested component values in the format `{...}`. ' + this.getParentToolDescription(parent) + ' All `data_path`(s) for the components within this container should be prefixed with the container\'s `data_path` (e.g. `container.exampleField`).';
        }
        let rule = '';
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
                if ((component as SelectComponent).dataSrc === 'url' || (component as SelectComponent).dataSrc === 'resource') {
                    rule += `You MUST first call the \`fetch_external_data\` tool with the \`field_path\` set to this component's \`data_path\` to retrieve the available options, then select ${this.isMultiple(component) ? 'one or more (as comma separated values)' : 'one'} of the returned options. Use the **value** (not the label) when setting this field's data.`;
                } else {
                    rule += `The value must be ${this.isMultiple(component) ? 'one or more (as comma separated values)' : 'one'} of the following options provided in the "**Options**" section of that component, formatted as " - Label (value)":`;
                }
                break;
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
            case 'datasource':
                rule += 'You MUST first call the `fetch_external_data` tool with the `field_path` set to this component\'s `data_path` to retrieve the external data. The value will be set automatically from the fetched data.';
                break;
            case 'survey':
                rule += 'The value is an object of question/value pairs based on the following survey configuration.\n';
                rule += '    **Keys**: The value `keys` will be the "value" property for each question in the survey configuration.';
                (component as any).questions.forEach((question: any, index: number) => {
                    rule += `\n      - **${question.label}** (${question.value}): ${question.tooltip || ''}`;
                });
                rule += '\n\n    **Values**: Only ONE of the the following values are allowed for each question.';
                (component as any).values.forEach((value: any) => {
                    rule += `\n      - **${value.label}** (${value.value})`;
                });
                break;
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
        return !!(component as any).tree ||
            component.type === 'datagrid' ||
            component.type === 'editgrid' ||
            component.type === 'form';
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

    getEmptyValue(component: Component) {
        const modelType = Utils.getModelType(component);
        switch (modelType) {
            case 'nestedArray':
                return [{}];
            case 'nestedDataArray':
                return [{ data: {} }];
            case 'dataObject':
                return { data: {} };
            case 'object':
            case 'map':
                return {};
            default:
                return null;
        }
    }

    /**
     * Override the process methods for the UAG.
     */
    override async process(
        submission: Submission,
        auth: AuthRequest,
        headers: any = {},
        findQuery: any = {},
        additional: any[] = []
    ) {
        const processors = [...Processors, ...additional];

        // Remove the 'fetch' processor since UAG handles this with the fetch_external_data tool.
        const fetchIndex = processors.findIndex((p) => p.name === 'fetch');
        if (fetchIndex !== -1) {
            processors.splice(fetchIndex, 1);
        }

        // Return the processed submission data.
        const context = await super.process(submission, auth, headers, findQuery, processors);

        // Filter the "required" validation since the UAG retrieves required fields separately.
        context.scope.errors = context.scope.errors.filter((error: any) => (error.ruleName !== 'required'));
        return context;
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
        const context = await this.process(submission, authInfo, null, null, [
            {
                name: 'getFields',
                shouldProcess: () => true,
                process: async (context: any) => {
                    const { component, path, value, data } = context;
                    if (this.isNestedComponent(component)) {
                        // For nested components, we need to always have a value so that the child components
                        // are added to the list of fields needing data.
                        if (Utils.isComponentDataEmpty(component, data, path)) {
                            const emptyValue = this.getEmptyValue(component);
                            if (emptyValue !== null) {
                                set(data, path, emptyValue);
                            }
                        }
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
                            // Only paths below `within`: "customerNotes" is not within "customer".
                            const rest = path.slice(within.length);
                            if (path.startsWith(within) && (rest.startsWith('.') || rest.startsWith('['))) {
                                // The row of `within` itself, not of a table it sits in
                                // ("outer[0].inner[3].x" is row 3 of "outer[0].inner").
                                const indexMatch = rest.match(/^\[(\d+)\]/);
                                fieldInfo.rowIndex = indexMatch ? parseInt(indexMatch[1], 10) : 0;
                            }
                            else {
                                // If within is a string, then it is a single path to limit components within (non-inclusive).
                                return;
                            }
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

                    // If the value is not empty, then we can skip this field.
                    const emptyValue = this.getEmptyValue(component);
                    const hasValue = emptyValue === null ? componentHasValue(component, value) : !isEqual(value, emptyValue);
                    if (hasValue) {
                        if (component.validate?.required) {
                            fieldInfo.totalRequiredCollected++;
                        }
                        return;
                    }

                    // Add the component info to the appropriate list.
                    const criteria = component.validate?.required ? 'required' : 'optional';
                    // Rules are listed by type, but some depend on the component (its
                    // options source, multiple values, a survey's questions, a nested
                    // component's path): one that differs gets an entry of its own.
                    const rules = fieldInfo[criteria].rules;
                    const rule = this.getComponentValueRule(component, path);
                    const known = rules[component.type];
                    rules[(known === undefined || known === rule) ? component.type : `${component.type} (${path})`] = rule;
                    fieldInfo[criteria].components.push(this.getComponentInfo(component, path));
                }
            }
        ]);
        if (context.scope?.errors?.length) {
            fieldInfo.errors = this.convertToFormFieldErrors(interpolateErrors(context.scope.errors));
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
        let withinUAG = false;
        Utils.eachComponentData(this.form?.components || [], data, (component, data, row, path) => {
            let value = get(data, path);
            if (component.key === 'uag' || withinUAG) {
                withinUAG = true;
                return true;
            }
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
                const modelType = Utils.getModelType(component);
                if (isObjectLike(value)) {
                    value = JSON.stringify(value);
                }
                else if (modelType === 'string' && isString(value)) {
                    const editor = (component as TextAreaComponent).editor;
                    if (editor === 'ckeditor' || editor === 'quill') {
                        value = this.htmlToMarkdown(value);
                    }
                    else {
                        value = `"${value.trim()}"`;
                    }
                }
                uagData.push({
                    prefix,
                    path,
                    label: component.label || component.key || path,
                    value
                });
            }
        }, false, false, undefined, undefined, undefined, (component, data) => {
            if (this.isNestedComponent(component)) {
                prefix = prefix.slice(0, -2);
            }
            if (component.key === 'uag' || withinUAG) {
                withinUAG = false;
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

    /** The form's name in Agentic Formflow responses and messages. */
    get formflowName(): string {
        return this.uag?.name || this.form?.name || '';
    }

    /** The form's tasks, for Agentic Formflow. */
    formflowTasks(): Record<string, FormflowTask> {
        return this.uagFields || {};
    }

    /** The submission's values in form order with their labels, for Agentic Formflow. */
    formflowLabeledData(data: DataObject = {}): { path: string; label: string }[] {
        return this.formatData(data).map(({ path, label }) => ({ path, label }));
    }

    htmlToMarkdown(html: string): string {
        return NodeHtmlMarkdown.translate(html, {
            bulletMarker: '-',
            emDelimiter: '*',
            strongDelimiter: '**',
            indent: '  '
        });
    }
}