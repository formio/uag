/**
 * The engine contract for the Form.io Universal Agent Gateway (UAG): what a
 * decision engine or an agent engine receives and returns. Engine types
 * declare `apiVersion: ENGINE_API_VERSION`; the UAG refuses a type built for
 * another version at startup. It matches what @formio/appserver-core accepts.
 */
/**
 * Engine contracts for the generic Agent API.
 *
 * Two kinds of model plug into the UAG. A decision engine answers closed-set
 * questions — pick one option, place the input on an ordered scale, yes or no —
 * and returns a probability for each answer. An agent engine produces open
 * values, researching with read-only tools when a task allows. The two take different inputs and return
 * different outputs, so they get separate contracts instead of one generic call.
 */
/** Pick one option from a set with no order between options. */
export type ChoiceQuestion = {
    type: 'choice';
    instructions: string;
    /** Option label → optional description. The labels are what the model chooses between. */
    options: Record<string, string | null>;
};
/** Place the state at a position on an ordered list of levels. */
export type ScoreQuestion = {
    type: 'score';
    instructions: string;
    /** Levels in order, lowest first. */
    levels: string[];
};
/** A yes/no question where the probability of "yes" is the useful signal. */
export type NoulQuestion = {
    type: 'noul';
    instructions: string;
    criteria?: {
        true?: string;
        false?: string;
    };
};
export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type ChoiceAnswer = {
    type: 'choice';
    choice: string;
    /** Option label → probability. */
    probabilities: Record<string, number>;
    /** Normalized for the number of options: (p_max − 1/n) / (1 − 1/n). */
    confidence: number;
};
export type ScoreAnswer = {
    type: 'score';
    /** Position along the levels; may fall between two of them. */
    score: number;
    /** Level index (as a string) → probability. */
    probabilities: Record<string, number>;
    confidence: number;
};
export type NoulAnswer = {
    type: 'noul';
    /** Probability of "yes", from 0 to 1. */
    probability: number;
};
export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;
/**
 * What every engine reads, as a structured object with named fields that
 * questions refer to by name ("Based on `input`, …").
 */
export type DecisionState = {
    /** The task's criteria. */
    instructions?: string;
    /** The task's input values keyed by field label (the whole submission when it has no input). */
    input: Record<string, any>;
    /** Values at the paths the task lists in `uagContext`, keyed by field label. */
    context?: Record<string, any>;
    /** Today's date, e.g. "Tuesday, October 20, 2026 (2026-10-20)". */
    today: string;
};
export type DecisionRequest = {
    state: DecisionState;
    questions: Record<string, DecisionQuestion>;
    signal?: AbortSignal;
};
export type EngineUsage = {
    inputTokens?: number | null;
    outputTokens?: number | null;
};
export type DecisionResponse = {
    model: string;
    answers: Record<string, DecisionAnswer>;
    usage?: EngineUsage;
};
/**
 * The version of this engine contract. An engine may declare the version it was
 * built for as `apiVersion`; one built for another version is refused at startup.
 */
export declare const ENGINE_API_VERSION: 1;
export interface DecisionEngine {
    name: string;
    kind: 'decision';
    /** The engine contract version the engine was built for. */
    apiVersion?: number;
    model: string;
    /** The most options a single Choice or Score question may carry. */
    maxOptions: number;
    decide(request: DecisionRequest): Promise<DecisionResponse>;
}
/** One field an agent engine is asked to produce a value for. */
export type FieldSpec = {
    path: string;
    label: string;
    type: string;
    description: string;
    /** How the value must be written, from the same rules `get_field_info` gives agents. */
    rule: string;
    format?: string;
    /** For closed-set fields routed to an agent engine: the allowed values. */
    options?: {
        label: string;
        value: any;
    }[];
    multiple?: boolean;
};
export type ExtractRequest = {
    instructions: string;
    state: DecisionState;
    fields: FieldSpec[];
    /** JSON schema of the object to return, keyed by field path. */
    schema: Record<string, any>;
    signal?: AbortSignal;
    /**
     * Read-only tools the engine may call before answering, when the task enables
     * research (`uagTools`). Only engines that declare `toolUse` receive them. The
     * answer is still structured values for `fields`; tools never write.
     */
    tools?: ToolDefinition[];
    /**
     * Call one of `tools`. Runs in process with the caller's identity, so Form.io
     * permissions apply; names outside `tools` are refused. Set with `tools`.
     */
    callTool?(name: string, args: Record<string, any>): Promise<ToolCallResult>;
    /** The most tool-use round trips before the engine must answer. Set with `tools`. */
    maxIterations?: number;
    /**
     * A scoped token carrying the caller's identity and exactly `tools`, all
     * read-only, for engines that run the model outside the UAG and call the
     * tools back over `/mcp`. In-process engines use `callTool` and ignore it.
     */
    scopedToken?: string;
};
export type ExtractResponse = {
    model: string;
    /** Field path → value. Paths that were not asked for are discarded by the caller. */
    values: Record<string, any>;
    /** Tools the engine called while researching, in order. */
    toolCalls?: {
        name: string;
        isError: boolean;
    }[];
    usage?: EngineUsage;
};
/** A tool as an agent engine sees it: plain JSON, ready for any model API. */
export type ToolDefinition = {
    name: string;
    description: string;
    /** JSON schema of the tool's arguments. */
    inputSchema: Record<string, any>;
};
/** A tool call's outcome, in MCP content form. */
export type ToolCallResult = {
    content: {
        type: string;
        text?: string;
        [key: string]: any;
    }[];
    isError?: boolean;
};
export interface AgentEngine {
    name: string;
    kind: 'agent';
    /** The engine contract version the engine was built for. */
    apiVersion?: number;
    model: string;
    /**
     * Whether `extract` accepts read-only tools for research. Engines without it
     * are passed over for field groups whose task enables tools.
     */
    toolUse?: boolean;
    /** Structured extraction that returns values for the requested fields only. */
    extract(request: ExtractRequest): Promise<ExtractResponse>;
}
export type Engine = DecisionEngine | AgentEngine;
