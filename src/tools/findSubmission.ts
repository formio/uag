import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo, SearchQuery } from "./utils";
import { isNumber, get, defaultsDeep } from "lodash";
import { Submission } from "@formio/core";
import { UAGFormInterface } from "../UAGFormInterface";
import { SchemaBuilder } from './SchemaBuilder';
const error = require('debug')('formio:uag:findSubmission:error');
export const findSubmission = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.find_submissions || {}, {
        name: 'find_submissions',
        title: 'Find submissions within a form',
        description: 'Find existing form submissions based on field values (search query). Use this to search for people, records, or data by name, email, phone, position, company, or other field values. Examples: find a contact by name, find someone who works at a company, find records with specific criteria.',
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .search_query()
            .fields_requested()
            .limit()
            .submission_id()
            .submission_id_partial().schema,
        execute: async ({ form_name, search_query, fields_requested, limit, submission_id, submission_id_partial }: {
            form_name: string;
            search_query: SearchQuery[];
            fields_requested?: string[];
            limit?: number;
            submission_id?: string;
            submission_id_partial?: string;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            const query: any = {};
            if (!submission_id) {
                for (const criterion of search_query) {
                    if (!criterion.data_path || !criterion.search_value) {
                        return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                            form: form.form,
                            searchQuery: search_query,
                            error: 'Each search criterion must include both data_path and search_value'
                        }, true);
                    }
                    if (criterion.operator === 'regex') {
                        query[`data.${criterion.data_path}__regex`] = `/${criterion.search_value}/i`;
                    }
                    else if (criterion.operator === 'equals') {
                        query[`data.${criterion.data_path}`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'contains') {
                        query[`data.${criterion.data_path}__regex`] = `/${criterion.search_value}/i`;
                    }
                    else if (criterion.operator === 'starts_with') {
                        query[`data.${criterion.data_path}__regex`] = `/^${criterion.search_value}/i`;
                    }
                    else if (criterion.operator === 'ends_with') {
                        query[`data.${criterion.data_path}__regex`] = `/${criterion.search_value}$/i`;
                    }
                    else if (criterion.operator === 'greater_than') {
                        query[`data.${criterion.data_path}__gt`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'greater_than_equal') {
                        query[`data.${criterion.data_path}__gte`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'less_than') {
                        query[`data.${criterion.data_path}__lt`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'less_than_equal') {
                        query[`data.${criterion.data_path}__lte`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'not_equals') {
                        query[`data.${criterion.data_path}__ne`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'in') {
                        const values = criterion.search_value.split(',').map((v: string) => v.trim());
                        query[`data.${criterion.data_path}__in`] = values;
                    }
                    else if (criterion.operator === 'nin') {
                        const values = criterion.search_value.split(',').map((v: string) => v.trim());
                        query[`data.${criterion.data_path}__nin`] = values;
                    }
                    else {
                        return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                            form: form.form,
                            searchQuery: search_query,
                            error: `Unsupported operator "${criterion.operator}"`
                        }, true);
                    }
                }
            }

            try {
                let submissions: Submission[] = [];
                if (submission_id) {
                    const result = await form.loadSubmission(submission_id, extra.authInfo);
                    if (result) {
                        submissions = [result];
                    }
                }
                else {
                    query.limit = (isNumber(limit) && limit > 0) ? limit : 10;
                    const result = await form.find(query, extra.authInfo);
                    submissions = result.items;
                }

                if (!submissions || submissions.length === 0) {
                    return project.mcpResponse(ResponseTemplate.noSubmissionsFound, {
                        form: form.form,
                        searchQuery: search_query,
                        formName: form_name
                    });
                }

                if (submission_id_partial && submissions.length > 1) {
                    const matchingSubmissions = submissions.filter(sub =>
                        sub._id && sub._id.toString().toLowerCase().includes(submission_id_partial.toLowerCase())
                    );

                    if (matchingSubmissions.length === 0) {
                        return project.mcpResponse(ResponseTemplate.submissionPartialIdNotFound, {
                            form: form.form,
                            searchQuery: search_query,
                            partialId: submission_id_partial,
                            availableSubmissions: submissions.map(sub => ({
                                ...form.formatSubmission(sub),
                                partialId: sub._id ? sub._id.toString().slice(-4) : 'N/A'
                            }))
                        }, true);
                    }

                    if (matchingSubmissions.length > 1) {
                        return project.mcpResponse(ResponseTemplate.submissionPartialIdAmbiguous, {
                            form: form.form,
                            searchQuery: search_query,
                            partialId: submission_id_partial,
                            matchingSubmissions: matchingSubmissions.map(sub => ({
                                ...form.formatSubmission(sub),
                                fullId: sub._id,
                                partialId: sub._id ? sub._id.toString().slice(-4) : 'N/A'
                            }))
                        }, true);
                    }

                    submissions = matchingSubmissions;
                }

                function getFieldValues(submission: Submission) {
                    if (!fields_requested || fields_requested.length === 0) {
                        return [];
                    }
                    const data: any = [];
                    for (const fieldPath of fields_requested) {
                        data.push({ path: fieldPath, value: get(submission.data, fieldPath, null) });
                    }
                    return data;
                }

                return project.mcpResponse(ResponseTemplate.submissionsFound, {
                    form: form.form,
                    searchQuery: JSON.stringify(search_query),
                    submissions: submissions.map(sub => {
                        return {
                            _id: sub._id,
                            created: sub.created,
                            modified: sub.modified,
                            data: getFieldValues(sub),
                            partialId: sub._id ? sub._id.toString().slice(-4) : 'N/A'
                        };
                    }),
                    resultCount: submissions.length
                });
            } catch (err) {
                error('Error searching submissions:', err);
                return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                    form: form.form,
                    searchQuery: JSON.stringify(search_query),
                    error: err instanceof Error ? err.message : 'Unknown error'
                }, true);
            }
        }
    });
};