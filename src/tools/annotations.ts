/**
 * MCP tool annotations, as presets rather than per-tool literals.
 *
 * Annotations are how a client knows whether a call is safe to make speculatively,
 * safe to retry, and whether it can change data — the difference between an agent
 * that asks before overwriting someone's submission and one that just does it.
 * Spelling the four hints out in ten tool files would guarantee drift, so each tool
 * picks the preset matching its verb and supplies only a human-readable title.
 *
 * `openWorldHint` is true throughout: every tool here resolves forms or submissions
 * against a Form.io deployment, so results depend on a system outside this process.
 */

export interface ToolAnnotations {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
}

/**
 * Reads, or shapes data in the response without persisting it. Repeatable, and
 * nothing on the server changes — which covers the conversational tools too:
 * `collect_field_data` and `confirm_form_submission` validate and echo back the
 * caller's `form_data`, they do not save it.
 */
export function reads(title: string): ToolAnnotations {
    return {
        title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
    };
}

/** Creates a record. Calling it twice creates two, so not idempotent. */
export function creates(title: string): ToolAnnotations {
    return {
        title,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
    };
}

/**
 * Overwrites an existing record. Destructive because the previous values are gone
 * once it returns; idempotent because applying the same updates again lands the
 * same result.
 */
export function overwrites(title: string): ToolAnnotations {
    return {
        title,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
    };
}
