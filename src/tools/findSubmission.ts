import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo, SearchQuery, escapeSearchPattern } from "./utils";
import { isNumber, get, defaultsDeep } from "lodash";
import { Submission } from "@formio/core";
import { UAGFormInterface } from "../UAGFormInterface";
import { SchemaBuilder } from './SchemaBuilder';
import { reads } from './annotations';
const error = require('debug')('formio:uag:findSubmission:error');

/** The query parameter suffix for each operator that compares the value as given. */
const COMPARISON_SUFFIXES = new Map<string, string>([
    ['equals', ''],
    ['greater_than', '__gt'],
    ['greater_than_equal', '__gte'],
    ['less_than', '__lt'],
    ['less_than_equal', '__lte'],
    ['not_equals', '__ne'],
]);

/** The query parameter suffix for each operator that takes comma-separated values. */
const LIST_SUFFIXES = new Map<string, string>([
    ['in', '__in'],
    ['nin', '__nin'],
]);

/** The `__regex` pattern for each operator that matches the value literally. */
const LITERAL_PATTERNS = new Map<string, (value: string) => string>([
    ['contains', (value) => `/${escapeSearchPattern(value)}/i`],
    ['starts_with', (value) => `/^${escapeSearchPattern(value)}/i`],
    ['ends_with', (value) => `/${escapeSearchPattern(value)}$/i`],
]);

/**
 * A regex operator's pattern with every "/" in it, bare or escaped, written as
 * the `\x2f` escape, which matches the same character. See escapeSearchPattern()
 * for why the query parameter cannot carry a slash.
 */
const withoutSlashes = (pattern: string): string =>
    pattern.replace(/\\.|\//g, (match) => (match === '/' || match === '\\/') ? '\\x2f' : match);

/** The last 4 characters of a submission's id, which users disambiguate with. */
const partialIdOf = (submission: Submission): string => submission._id ? submission._id.toString().slice(-4) : 'N/A';

export const findSubmission = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep({}, project.config?.toolOverrides?.find_submissions, {
        name: 'find_submissions',
        title: 'Find submissions within a form',
        description: 'Find existing form submissions based on field values (search query). Use this to search for people, records, or data by name, email, phone, position, company, or other field values. Examples: find a contact by name, find someone who works at a company, find records with specific criteria. To retrieve the total count of records within a form, use this tool without providing a `search_query`.',
        annotations: reads('Find submissions'),
        inputSchema: (new SchemaBuilder(project))
            .form_name()
            .search_query()
            .fields_requested()
            .limit()
            .submission_id()
            .submission_id_partial().schema,
        execute: async ({ form_name, search_query, fields_requested, limit, submission_id, submission_id_partial }: {
            form_name: string;
            search_query?: SearchQuery[];
            fields_requested?: string[];
            limit?: number;
            submission_id?: string;
            submission_id_partial?: string;
        }, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            search_query = search_query || [];
            const query: any = {};
            if (!submission_id && search_query.length > 0) {
                for (const criterion of search_query) {
                    if (!criterion.data_path || !criterion.search_value) {
                        return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                            form: form.form,
                            searchQuery: search_query,
                            error: 'Each search criterion must include both data_path and search_value'
                        }, true);
                    }
                    let key: string;
                    let value: any;
                    if (criterion.operator === 'regex') {
                        // The value is a pattern by request here, so it is passed through
                        // unescaped. It is still compiled first: the server drops a filter
                        // it cannot compile, which would widen the search instead of
                        // failing it, so a bad pattern is better reported back.
                        try {
                            new RegExp(criterion.search_value);
                        }
                        catch (err) {
                            return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                                form: form.form,
                                searchQuery: search_query,
                                error: `"${criterion.search_value}" is not a valid regular expression for "${criterion.data_path}". Use the "contains" operator to search for it literally.`
                            }, true);
                        }
                        key = `data.${criterion.data_path}__regex`;
                        value = `/${withoutSlashes(criterion.search_value)}/i`;
                    }
                    else if (LITERAL_PATTERNS.has(criterion.operator)) {
                        key = `data.${criterion.data_path}__regex`;
                        value = LITERAL_PATTERNS.get(criterion.operator)!(criterion.search_value);
                    }
                    else if (COMPARISON_SUFFIXES.has(criterion.operator)) {
                        key = `data.${criterion.data_path}${COMPARISON_SUFFIXES.get(criterion.operator)}`;
                        value = criterion.search_value;
                    }
                    else if (LIST_SUFFIXES.has(criterion.operator)) {
                        key = `data.${criterion.data_path}${LIST_SUFFIXES.get(criterion.operator)}`;
                        value = criterion.search_value.split(',').map((v: string) => v.trim());
                    }
                    else {
                        return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                            form: form.form,
                            searchQuery: search_query,
                            error: `Unsupported operator "${criterion.operator}"`
                        }, true);
                    }
                    // Criteria are ANDed, but each query parameter holds one value: a
                    // second one would replace the first and widen the search.
                    if (key in query) {
                        return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                            form: form.form,
                            searchQuery: search_query,
                            error: `"${criterion.data_path}" has two criteria that cannot be combined (contains, starts_with, ends_with and regex count as one kind). Use a single "regex" criterion that matches both, or "in"/"nin" for several values.`
                        }, true);
                    }
                    query[key] = value;
                }
            }

            try {
                let submissionCount = 0;
                let submissions: Submission[] = [];
                if (submission_id) {
                    const result = await form.loadSubmission(submission_id, extra.authInfo);
                    if (result) {
                        submissions = [result];
                        submissionCount = 1;
                    }
                }
                else {
                    query.limit = (isNumber(limit) && limit > 0) ? limit : 10;
                    if (search_query.length > 0) {
                        const result = await form.find(query, extra.authInfo);
                        submissions = result.items;
                        submissionCount = result.count;
                    }
                    else {
                        submissionCount = await form.count({}, extra.authInfo);
                        return project.mcpResponse(ResponseTemplate.submissionCount, {
                            form: form.form,
                            submissionCount
                        });
                    }
                }

                if (!submissions || submissions.length === 0) {
                    return project.mcpResponse(ResponseTemplate.noSubmissionsFound, {
                        form: form.form,
                        searchQuery: search_query,
                        formName: form_name
                    });
                }

                if (submission_id_partial) {
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
                                partialId: partialIdOf(sub)
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
                                partialId: partialIdOf(sub)
                            }))
                        }, true);
                    }

                    submissions = matchingSubmissions;
                }

                return project.mcpResponse(ResponseTemplate.submissionsFound, {
                    form: form.form,
                    searchQuery: JSON.stringify(search_query),
                    submissionCount,
                    submissions: submissions.map(sub => ({
                        _id: sub._id,
                        created: sub.created,
                        modified: sub.modified,
                        data: (fields_requested || []).map((path) => ({ path, value: get(sub.data, path, null) })),
                        partialId: partialIdOf(sub)
                    }))
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