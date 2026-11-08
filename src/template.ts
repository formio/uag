import * as fs from 'fs';
import * as path from 'path';
import { template, TemplateExecutor } from 'lodash';
import { UAGTemplateConfig } from './config';

/**
 * Template names enum for type safety
 */
export enum ResponseTemplate {
    collectedData = 'collectedData',
    fieldRules = 'fieldRules',
    allFieldsCollected = 'allFieldsCollected',
    getFormFieldsEmpty = 'getFormFieldsEmpty',
    getFormFieldsInfo = 'getFormFieldsInfo',
    fieldCollectedNext = 'fieldCollectedNext',
    submitValidationError = 'submitValidationError',
    formSubmitted = 'formSubmitted',
    listAvailableForms = 'listAvailableForms',
    confirmFormSubmission = 'confirmFormSubmission',
    getOptionalFields = 'getOptionalFields',
    formNotFound = 'formNotFound',
    noSubmissionsFound = 'noSubmissionsFound',
    submissionsFound = 'submissionsFound',
    submissionCount = 'submissionCount',
    submissionSearchError = 'submissionSearchError',
    submissionNotFound = 'submissionNotFound',
    updateNotConfirmed = 'updateNotConfirmed',
    submissionUpdateError = 'submissionUpdateError',
    submissionUpdated = 'submissionUpdated',
    submissionPartialIdAmbiguous = 'submissionPartialIdAmbiguous',
    submissionPartialIdNotFound = 'submissionPartialIdNotFound',
    getFormFields = 'getFormFields',
    getFormFieldsError = 'getFormFieldsError',
    fieldValidationErrors = 'fieldValidationErrors',
    fields = 'fields',
    fieldList = 'fieldList',
    fieldValues = 'fieldValues',
    formData = 'formData',
    getAvailableForms = 'getAvailableForms',
    noFormsAvailable = 'noFormsAvailable',
    uagComponentNotFound = 'uagComponentNotFound',
    agentProcessData = 'agentProcessData',
    fetchExternalData = 'fetchExternalData',
    fetchExternalDataError = 'fetchExternalDataError'
}

export class UAGTemplate {
    public templateCache = new Map<string, TemplateExecutor>();
    constructor(public config: UAGTemplateConfig = {}) {}

    /**
     * Get a template by name
     * @param templateName The name of the template
     * @returns The compiled template function
     */
    getTemplate(templateName: ResponseTemplate): TemplateExecutor {
        const cached = this.templateCache.get(templateName);
        if (cached) {
            return cached;
        }
        let templateContent = this.config[templateName];
        if (!templateContent) {
            const templatePath = path.join(__dirname, 'templates', `${templateName}.md`);
            if (!fs.existsSync(templatePath)) throw new Error(`Template '${templateName}' not found at ${templatePath}`);
            templateContent = fs.readFileSync(templatePath, 'utf-8');
        }
        const compiled = template(templateContent);
        this.templateCache.set(templateName, compiled);
        return compiled;
    }

    /**
     * Render a template with data
     * @param templateName The name of the template
     * @param data The data to render the template with
     * @returns The rendered template
     */
    renderTemplate(templateName: ResponseTemplate, data: object = {}): string {
        try {
            const template = this.getTemplate(templateName);
            return template(data);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to render template '${templateName}': ${errorMessage}`);
        }
    }
}

