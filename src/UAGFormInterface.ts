import { AuthRequest, FormInterface, InterpolatedError } from "@formio/appserver";
import {
    Component,
    TextFieldComponent,
    DateTimeComponent,
    DayComponent,
    SelectComponent,
    Utils,
    Submission,
    Processors
} from "@formio/core";
import { set, get } from "lodash";
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

export type UAGData = Array<{ label: string; value: any, path: string }>;
export type UAGSubmission = {
    _id?: string;
    data: UAGData;
    created?: string | Date;
    modified?: string | Date;
}

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
        return fieldInfo;
    }

    isMultiple(component: Component | undefined): boolean {
        if (!component) return false;
        return !!component.multiple || component.type === 'selectboxes' || component.type === 'tags';
    }

    getComponentValueRule(component: Component) {
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
            case 'radio':
                rule += `The value must be ${this.isMultiple(component) ? 'one or more (as comma separated values)' : 'one'} of the following options provided in the "**Options**" section of that component, formatted as " - Label (value)":`;
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

    async getFields(submission: Submission, authInfo: AuthRequest): Promise<FormFieldInfo> {
        const fieldInfo: FormFieldInfo = {
            rules: {},
            required: [],
            optional: []
        };
        const context = await this.process(submission, authInfo, null, null, null, [
            ...Processors,
            {
                name: 'getFields',
                shouldProcess: () => true,
                postProcess: async (context: any) => {
                    const { component, path, value } = context;
                    if (
                        component.type !== 'button' &&
                        !component.scope?.conditionallyHidden
                    ) {
                        fieldInfo.rules[component.type] = this.getComponentValueRule(component);
                        if (component.validate?.required && (!value || Array.isArray(value) && value.length === 0)) {
                            fieldInfo.required.push(this.getComponentInfo(component, path));
                        }
                        else {
                            fieldInfo.optional.push(this.getComponentInfo(component, path));
                        }
                    }
                }
            }
        ]);
        return fieldInfo;
    }

    getComponent(path: string): Component | undefined {
        return Utils.getComponent(this.form.components, path);
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
    ): Promise<{ label: string, path: string, error: string }[]> {
        const invalidFields: { label: string, path: string, error: string }[] = [];
        const validation = await this.validate(submission, auth);
        if (validation.length > 0) {
            validation.forEach((error: InterpolatedError) => {
                invalidFields.push({
                    label: error.context?.label || 'Field',
                    path: error.context?.path,
                    error: error.message || 'Unknown validation error'
                });
            });
        }
        return invalidFields;
    }

    convertToSubmission(data: Record<string, any>): Submission {
        const submission: any = { data: {} };
        for (let [path, value] of Object.entries(data)) {
            const comp = this.getComponent(path);
            if (comp?.type === 'selectboxes') {
                value = value.split(',').reduce((obj: any, v: string) => {
                    obj[v.trim()] = true;
                    return obj;
                }, {});
            }
            else if (this.isMultiple(comp)) {
                value = value.split(',').map((v: string) => v.trim());
            }
            set(submission.data, path, value);
        }
        return submission as Submission;
    }

    formatSubmission(submission: Submission): UAGSubmission {
        const uagSubmission = {
            _id: submission._id,
            data: [] as UAGData,
            created: submission.created,
            modified: submission.modified
        };
        Utils.eachComponentData(this.form?.components || [], submission.data || {}, (component, data, row, path) => {
            const value = get(data, path);
            if (component.input !== false && value !== undefined && value !== null && value !== '') {
                uagSubmission.data.push({
                    path,
                    label: component.label || component.key || path,
                    value
                });
            }
        });
        return uagSubmission;
    }
}