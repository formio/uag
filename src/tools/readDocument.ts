import z from 'zod';
import { defaultsDeep, get } from 'lodash';
import { Utils } from '@formio/core';
import { ResponseTemplate } from '../template';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import { ToolInfo } from './utils';
import { reads } from './annotations';
import { readAsText } from '../documents/readers';

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** The component at a data path, row indices removed (`rows[2].contract` is `rows.contract`). */
function componentAt(components: any[], dataPath: string): any {
    const path = dataPath.replace(/\[\d+\]/g, '');
    let found: any;
    // The data path: with every component included, the second argument also names layout components (panels, columns).
    Utils.eachComponent(components, (component: any, componentPath: string, _components: any, _parent: any, paths: any) => {
        if (!found && (paths?.path ?? componentPath) === path) found = component;
    }, true);
    return found;
}

/**
 * read_document: the text of an uploaded document in a submission (a file in a
 * file component, or in an AI Document's files), read through the installed
 * converters with the caller's identity. Read-only.
 */
export const readDocument = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep({}, project.config?.toolOverrides?.read_document, {
        name: 'read_document',
        title: 'Read Uploaded Document',
        description: 'Read the text of a document uploaded to a submission: a file in a file field, or in an AI Document field. ' +
            'Give the form, the submission id (from `find_submissions`) and the data path of the field (such as "contract" or "rows[0].attachment"; ' +
            'add an index, such as "contract[1]", for another file than the first). Returns the file name, its type, its page count when known, and its text.',
        annotations: reads('Read an uploaded document'),
        inputSchema: {
            form_name: z.string().describe('The name of the form, as `get_forms` lists it.'),
            submission_id: z.string().describe('The full ID of the submission, as `find_submissions` gives it.'),
            data_path: z.string().describe('The data path of the file field or AI Document field.')
        },
        execute: async ({ form_name, submission_id, data_path }: { form_name: string; submission_id: string; data_path: string }, extra: any) => {
            const form: any = await project.getForm(form_name);
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }
            const submission = await form.loadSubmission(submission_id, extra.authInfo);
            if (!submission) {
                return project.mcpResponse(ResponseTemplate.submissionNotFound, { submissionId: submission_id, form: form.form }, true);
            }
            // An index on the last segment picks a file of a multiple field: contract[1].
            const index = /\[(\d+)\]$/.exec(data_path);
            const fieldPath = index ? data_path.slice(0, index.index) : data_path;
            const value = get(submission.data, fieldPath);
            const isDocument = value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.files);
            const files = isDocument ? value.files : Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);
            const file = files[index ? Number(index[1]) : 0];
            const component = componentAt(form.form?.components || [], isDocument ? `${fieldPath}.files` : fieldPath);
            if (!file || !component || component.type !== 'file') {
                return project.mcpJSONResponse({ error: `No uploaded file at "${data_path}" in that submission. Give the data path of a file field or an AI Document field.` }, true);
            }
            if (!project.plugins) {
                return project.mcpJSONResponse({ error: 'Documents cannot be read until the server has started.' }, true);
            }
            try {
                const loaded = await form.readFile(file, extra.authInfo, { maxBytes: project.config?.documents?.maxFileBytes || DEFAULT_MAX_FILE_BYTES, component });
                if (!loaded) {
                    return project.mcpJSONResponse({ error: `The file is stored as ${file.storage || 'unknown'}, which cannot be read here.` }, true);
                }
                const read = await readAsText(project.plugins, loaded.buffer, { name: loaded.name, type: loaded.type });
                return project.mcpJSONResponse({ file_name: loaded.name, type: read.type, pages: read.pages ?? null, text: read.text });
            }
            catch (err: any) {
                // The message names the file and the reason, never its content.
                return project.mcpJSONResponse({ error: err?.message || 'The file could not be read.' }, true);
            }
        }
    });
};
