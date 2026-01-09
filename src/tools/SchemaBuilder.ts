import z from "zod";
import { UAGProjectInterface } from "../UAGProjectInterface";

/**
 * Schema builder for tool input schemas.
 */
export class SchemaBuilder {
    public schema: Record<string, z.ZodTypeAny> = {};
    constructor(private project: UAGProjectInterface) { }
    get valueRules(): string {
        return 'The rules for the value is determined using the `get_form_fields` tool within the **Field Rules** section for this component type, and formatted according the the **Format** section of that component (if applicable). If a value already exists, and it is a string, then you can append/prepend to it to the existing value in the proper order (append/prepend) determined by the user response. If the value is not a string, then replace the value entirely.';
    }

    /**
     * Provide the form name.
     */
    form_name() {
        this.schema.form_name = z.enum((this.project?.formNames || []) as [string, ...string[]]).describe('The name of the form being filled out');
        return this;
    }

    /**
     * The current form data being collected. 
     * This is a flat key/value pair object where the key is the `data_path` of the field and 
     * the value is the collected value for that field.
     * 
     * ```json
     * {
     *   "firstName": "Joe",
     *   "lastName": "Smith",
     *   "company.name": "Acme Corp",
     *   "company.address.street": "123 Main St",
     *   "children[0].name": "Tom",
     *   "children[0].age": 5,
     *   "children[1].name": "Sally",
     *   "children[1].age": 3
     * }
     * ```
     */
    form_data() {
        this.schema.form_data = z.record(
            z.string().describe('The `data_path` of collected field.'),
            z.any().describe(`The value collected for the field. ${this.valueRules}`),
        ).optional().default({}).describe('The current data collected so far for the whole form without any updates applied. Include ALL previously collected field data to maintain session state.');
        return this;
    }

    /**
     * An array of `data_path`s to get detailed information for specific fields.
     * Each `data_path` within the array should correlate to the fields the user has provided values for.
     * 
     * ```json
     * [
     *   "firstName",
     *   "lastName",
     *   "company.name",
     *   "company.address.street",
     *   "children[0].name",
     *   "children[0].age",
     *   "children[1].name",
     *   "children[1].age"
     * ]
     * ```
     */
    field_paths() {
        this.schema.field_paths = z.array(z.string()).describe('An array of `data_path`s to get detailed information for specific fields. Each `data_path` within the array should correlate to the fields the user has provided values for. The `data_path`s can be found using the `get_form_fields` tool.');
        return this;
    }

    /**
     * The field "criteria" which for the UAG is the "requiredness" of the field.
     * 
     * ["all", "required", "optional"]
     * 
     */
    criteria() {
        this.schema.criteria = z.enum(['all', 'required', 'optional']).default('required').describe('Returns only the fields of the specified criteria. "all" returns all fields, "required" returns only the required fields, and "optional" returns only optional fields. To start a new form collection flow, you typically want to get only the "required" fields first.');
        return this;
    }

    as_json() {
        this.schema.as_json = z.boolean().optional().default(false).describe('If true, the submission data will be returned as a JSON object result instead of formatted text. Any errors will also be returned as a structured JSON array. Set this property to `true` ONLY if the prompt indicates that JSON output of the submission data is required.');
        return this;
    }

    /**
     * An array of search criteria to find matching submissions.
     * All criteria must match (AND logic).
     * 
     * ```json
     * [
     *  {
     *     "data_path": "customer.email",
     *     "operator": "equals",
     *     "search_value": "<email>"
     *  },
     *  {
     *     "data_path": "customer.name",
     *     "operator": "equals",
     *     "search_value": "<name>"
     *  }
     * ]
     * ```
     */
    search_query() {
        this.schema.search_query = z.array(
            z.object({
                data_path: z.string().describe('The data path of the field used to search (e.g., "email", "customer.firstName", or "parent.email")'),
                operator: z.enum(['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'regex', 'in', 'nin', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal']).optional().default('contains').describe('The operator to use for matching. "equals" for exact match, "contains" for substring match, "starts_with" or "ends_with" for prefix/suffix match, "regex" for regular expression match, "greater_than" or "less_than" only for numeric values, "in" if searching for multiple values as comma-separated values, "nin" if excluding multiple values as comma-separated values.'),
                search_value: z.string().describe('The value of the field to use when searching.')
            }).describe('Object containing the `data_path` and search value. Use `get_form_fields` to get all the field information to populate this search query object.')
        ).describe('Array of search criteria to find matching submissions. All criteria must match (AND logic). Use `get_form_fields` to get `data_path`s.');
        return this;
    }

    /**
     * An array of "data_path"(s) for values you wish to include in the result.
     * If not provided, only submission IDs and timestamps are returned.
     * 
     * ```json
     * [
     *   "email",
     *   "firstName",
     *   "lastName"
     * ]
     */
    fields_requested() {
        this.schema.fields_requested = z.array(z.string()).optional().describe('An array of "data_path"(s) for values you wish to include in the result. If not provided, only submission IDs and timestamps are returned. Use `get_form_fields` to get valid `data_path`s. (e.g., ["email"] - "What is the email address for the employee Joe Smith?")');
        return this;
    }

    /**
     * The maximum number of results to return. Defaults to 5.
     */
    limit() {
        this.schema.limit = z.number().optional().default(5).describe('The maximum number of results to return. Defaults to 5.');
        return this;
    }

    /**
     * The full ID of the submission to retrieve details for. This value is provided using the `find_submissions` tool.
     */
    submission_id() {
        this.schema.submission_id = z.string().optional().describe('The full ID of the submission to retrieve details for. This value is provided using the `find_submissions` tool.');
        return this;
    }

    /**
     * The last 4 characters of a specific submission ID.
     * Should ONLY be used when multiple matches are found from a previous query
     * and the user provides the last 4 characters of the Submission ID to disambiguate.
     */
    submission_id_partial() {
        this.schema.submission_id_partial = z.string().optional().describe('Last 4 characters of a specific submission ID. Should ONLY be used when multiple matches are found from a previous query and the user provides the last 4 characters of the Submission ID to disambiguate.');
        return this;
    }

    /**
     * The path of the parent component that contains nested components to collect spcific data for.
     * @returns 
     */
    parent_path() {
        this.schema.parent_path = z.string().optional().describe('The `data_path` of the parent component that contains nested components. Use this parameter if collecting data for fields within a specific nested component within a form. To find the `parent_path`, you can use the `get_field_info` tool, and use the `data_path` of any component that ****Has Nested Components**** = ✅ Yes. If not provided, the tool assumes data is being collected for the root form.');
        return this;
    }

    /**
     * An array of field updates to apply to the `form_data`.
     * Each update specifies the `data_path` and the complete new value.
     * 
     * ```json
     * [
     *   {
     *     "data_path": "firstName",
     *     "new_value": "John"
     *   },
     *   {
     *     "data_path": "lastName",
     *     "new_value": "Doe"
     *   }
     * ]
     * ```
     */
    updates() {
        this.schema.updates = z.array(
            z.object({
                data_path: z.string().describe('The `data_path` of the field to update. To find the data_path, you can use the `get_form_fields` tool.'),
                new_value: z.any().describe(`The complete new value for the field. ${this.valueRules}`)
            }).describe('A single field update including the `data_path` and new value.')
        ).describe('An array of field updates to apply to the `form_data`. Each update specifies the `data_path` and the complete new value.');
        return this;
    }
}