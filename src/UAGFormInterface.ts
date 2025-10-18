import { FormInterface } from "@formio/appserver";
import {
    Component,
    TextFieldComponent,
    DateTimeComponent,
    DayComponent,
    SelectComponent,
    Utils,
    Submission
} from "@formio/core";
import { set } from "lodash";
import { UAGForm } from "./config";

export type UAGComponentInfo = {
    path: string;
    label: string;
    type: string;
    format: string;
    description: string;
    validation: any;
    options?: { label: string; value: string }[];
    prompt?: string;
};

export type FormFieldInfo = {
    rules: Record<string, string>;
    required: UAGComponentInfo[];
    optional: UAGComponentInfo[];
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
                const values = ((component as SelectComponent).data as any)?.values;
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
        return fieldInfo;
    }

    getComponentValueRule(component: Component) {
        let rule = `${component.type} -`;
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
                const selectValues = ((component as SelectComponent).data as any)?.values;
                if (!selectValues || !Array.isArray(selectValues) || selectValues.length === 0) {
                    rule += 'No options are available for this select field.';
                    break;
                }
                const multiple = (component as SelectComponent).multiple || component.type === 'selectboxes';
                rule += `The value must be ${multiple ? 'one or more (as comma separated values)' : 'one'} of the following options provided in the "**Options**" section of that component, formatted as " - Label (value)":`;
                break;
            case 'datetime':
                rule += 'The value must be a valid date and time and in the format provided by the **Format** section of that component.';
                break;
            case 'day':
                rule += 'The value must be a valid day string in the format provided by the **Format** section of that component.';
                break;
            case 'time':
                rule += 'The value must be a valid time in the format provided by the **Format** section of that component.';
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

    supportsComponent(component: Component): boolean {
        const supportedComponents = [
            'textfield', 'textarea', 'number', 'currency', 'email', 'phoneNumber', 'date', 'time', 'datetime',
            'select', 'selectboxes', 'radio', 'checkbox', 'tags', 'signature', 'url', 'password', 'hidden'
        ];
        return supportedComponents.includes(component.type);
    }

    getFields(currentData: Record<string, any> = {}): FormFieldInfo {
        const fieldInfo: FormFieldInfo = {
            rules: {},
            required: [],
            optional: []
        };
        Utils.eachComponent(this.form.components, (component, path) => {
            if (!component.hasOwnProperty('input') || component.input && this.supportsComponent(component)) {
                fieldInfo.rules[component.type] = this.getComponentValueRule(component);
                if (component.validate?.required && !currentData[path]) {
                    fieldInfo.required.push(this.getComponentInfo(component, path));
                }
                else {
                    fieldInfo.optional.push(this.getComponentInfo(component, path));
                }
            }
        });
        return fieldInfo;
    }

    getComponent(path: string): Component | undefined {
        return Utils.getComponent(this.form.components, path);
    }

    validateComponent(component: Component, value: any): { isValid: boolean; error?: string } {
        if (component.validate?.required && (!value || value.trim() === '')) {
            return { isValid: false, error: 'This field is required' };
        }
        // TO-DO: Add Form.io validation engine here...
        return { isValid: true };
    }

    formatFormDataForDisplay(formData: Record<string, any>): any[] {
        const formattedData: any[] = [];
        Utils.eachComponent(this.form.components, (component, path) => {
            if (formData.hasOwnProperty(path)) {
                formattedData.push({
                    path,
                    label: component.label || component.key || path,
                    value: formData[path]
                });
            }
        });
        return formattedData;
    }

    convertToSubmission(data: Record<string, any>): Submission {
        const submission: any = { data: {} };
        for (const [path, value] of Object.entries(data)) {
            set(submission.data, path, value);
        }
        return submission as Submission;
    }

    formatSubmission(submission: Submission): any {
        const formattedSubmission = {
            _id: submission._id,
            data: [] as Array<{ label: string; value: any, path: string }>,
            created: submission.created,
            modified: submission.modified
        };
        Utils.eachComponentData(this.form?.components || [], submission.data || {}, (component, data, row, path) => {
            if (
                component.input !== false &&
                row[component.key] !== undefined &&
                row[component.key] !== null &&
                row[component.key] !== ''
            ) {
                formattedSubmission.data.push({
                    path,
                    label: component.label || component.key || path,
                    value: row[component.key]
                });
            }
        });
        return formattedSubmission;
    }
}