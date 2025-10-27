import z from "zod";
import { ResponseTemplate } from "../template";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { ToolInfo } from "./types";
import { isNumber, get, defaultsDeep } from "lodash";
import { Submission } from "@formio/core";
import { UAGFormInterface } from "../UAGFormInterface";
const error = require('debug')('formio:uag:findSubmission:error');
export const findSubmission = async (project: UAGProjectInterface): Promise<ToolInfo> => {
    return defaultsDeep(project.config?.toolOverrides?.find_submission_by_field || {}, {
        name: 'find_submission_by_field',
        title: 'Find Submission by Field Data',
        description: 'Find existing form submissions based on field values. Use this to search for people, records, or data by name, email, phone, position, company, or other field values. Examples: find a contact by name, find someone who works at a company, find records with specific criteria.',
        inputSchema: {
            form_name: z.enum((project?.formNames || []) as [string, ...string[]]).describe('The name/key of the form to search submissions for'),
            search_query: z.array(z.object({
                field_path: z.string().describe('The data path of the field used to search (e.g., "email", "customer.firstName", or "parent.email")'),
                operator: z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'nin', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal']).optional().default('contains').describe('The operator to use for matching. "equals" for exact match, "contains" for substring match, "starts_with" or "ends_with" for prefix/suffix match, "regex" for regular expression match, "greater_than" or "less_than" only for numeric values, "in" if searching for multiple values as comma-separated values, "nin" if excluding multiple values as comma-separated values.'),
                search_value: z.string().describe('The value of the field to use when searching.')
            }).describe('Object containing the field path and search value. Use `get_form_fields` to get all the field information to populate this search query object.')).describe('Array of search criteria to find matching submissions. All criteria must match (AND logic). Use `get_form_fields` to get field paths.'),
            fields_requested: z.array(z.string()).optional().describe('An array of "field_path"(s) for values you wish to include in the result. If not provided, only submission IDs and timestamps are returned. Use `get_form_fields` to get valid field paths. (e.g., ["email"] - "What is the email address for the employee Joe Smith?")'),
            limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
            submission_id: z.string().optional().describe('Optional: The full submission ID of a specific submission to retrieve.'),
            submission_id_partial: z.string().optional().describe('Optional: Last 4 characters of a specific submission ID. Should ONLY be used when multiple matches are found from a previous query and the user provides the last 4 characters of the Submission ID to disambiguate.')
        },
        execute: async ({ form_name, search_query, fields_requested, limit = 10, submission_id, submission_id_partial }: any, extra: any) => {
            const form = await project.getForm(form_name) as UAGFormInterface;
            if (!form) {
                return project.mcpResponse(ResponseTemplate.formNotFound, { formName: form_name }, true);
            }

            const query: any = {};
            if (!submission_id) {
                for (const criterion of search_query) {
                    if (!criterion.field_path || !criterion.search_value) {
                        return project.mcpResponse(ResponseTemplate.submissionSearchError, {
                            form: form.form,
                            searchQuery: search_query,
                            error: 'Each search criterion must include both field_path and search_value'
                        }, true);
                    }
                    if (criterion.operator === 'regex') {
                        query[`data.${criterion.field_path}__regex`] = `/${criterion.search_value}/i`;
                    }
                    else if (criterion.operator === 'equals') {
                        query[`data.${criterion.field_path}`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'contains') {
                        query[`data.${criterion.field_path}__regex`] = `/${criterion.search_value}/i`;
                    }
                    else if (criterion.operator === 'starts_with') {
                        query[`data.${criterion.field_path}__regex`] = `/^${criterion.search_value}/i`;
                    }
                    else if (criterion.operator === 'ends_with') {
                        query[`data.${criterion.field_path}__regex`] = `/${criterion.search_value}$/i`;
                    }
                    else if (criterion.operator === 'greater_than') {
                        query[`data.${criterion.field_path}__gt`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'greater_than_equal') {
                        query[`data.${criterion.field_path}__gte`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'less_than') {
                        query[`data.${criterion.field_path}__lt`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'less_than_equal') {
                        query[`data.${criterion.field_path}__lte`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'not_equals') {
                        query[`data.${criterion.field_path}__ne`] = criterion.search_value;
                    }
                    else if (criterion.operator === 'in') {
                        const values = criterion.search_value.split(',').map((v: string) => v.trim());
                        query[`data.${criterion.field_path}__in`] = values;
                    }
                    else if (criterion.operator === 'nin') {
                        const values = criterion.search_value.split(',').map((v: string) => v.trim());
                        query[`data.${criterion.field_path}__nin`] = values;
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