// Types for @formio/uag-js.

/** One field's result from the form's agent operations. */
export interface FieldResult {
    path: string;
    status: 'confident' | 'uncertain' | 'suggested' | 'missing' | string;
    confidence?: number;
    alternatives?: { label: string; value: unknown; confidence: number }[];
    [key: string]: unknown;
}

/** A `result` event: one engine group's fields, and the values to apply. */
export interface ResultEvent {
    kind: 'decision' | 'value' | string;
    task?: string;
    engine?: string;
    fields: Record<string, FieldResult>;
    patch: Record<string, unknown>;
    error?: string;
    [key: string]: unknown;
}

/** An error reported while filling in; `event` is the stream's `error` event, when it came from one. */
export interface AgentInputError extends Error {
    event?: { kind?: string; task?: string; error?: string; attempts?: number; requestId?: string };
}

export interface AttachOptions {
    /** The task to run (the `uag` value). Default: the task of the input that triggered it. */
    task?: string;
    /** When to extract. Default `blur`; `next` for wizards. */
    trigger?: 'blur' | 'pause' | 'next' | 'button';
    /** The UAG's URL, when not the one given to `UAG()`. */
    uagUrl?: string;
    /** Where the form's agent operations are, such as a relay of your own (`{formUrl}/agent/extract`). */
    formUrl?: string;
    pauseMs?: number;
    nextTimeoutMs?: number;
    fetch?: typeof fetch;
    onStart?: (info: { followUp: boolean }) => void;
    onResult?: (event: ResultEvent) => void;
    onError?: (error: AgentInputError) => void;
    onDone?: (summary: Record<string, any> | null, info: { followUp: boolean }) => void;
}

export interface ExtractionRun {
    /** Resolves when the first decision results are applied, or the request ends. */
    decided: Promise<void>;
    /** Resolves when the request, and any follow-up, is done. Failures are reported, never rejected. */
    done: Promise<void>;
}

export declare class ExtractionState {
    agentValues: Record<string, unknown>;
    userEdited: Record<string, boolean>;
    canApply(path: string, currentValue: unknown): boolean;
    recordAgent(path: string, value: unknown): void;
    recordUser(path: string): void;
    source(path: string): 'user' | 'agent' | 'none';
}

export declare class SSEParser {
    constructor(onEvent: (name: string, data: any) => void);
    push(chunk: string): void;
}

export interface AgentInput {
    extract(): ExtractionRun;
    state: ExtractionState;
    detach(): void;
}

export interface UAGOptions extends Omit<AttachOptions, 'uagUrl' | 'formUrl'> {
    /** `false` attaches no Agent Input anywhere; submissions of `uag` forms still go to the UAG. */
    agentInput?: boolean;
}

/** The formio.js module: `Formio.use(UAG('https://uag.example.com'))`. */
export declare function UAG(uagUrl: string, options?: UAGOptions): (Formio: any) => { fetch: Record<string, any>; displays?: Record<string, any> };
export declare namespace UAG {
    /** The same as `attach`. */
    function attach(form: any, options?: AttachOptions): AgentInput;
}

/** Attach Agent Input to a rendered form (a formio.js Webform or Wizard). */
export declare function attach(form: any, options?: AttachOptions): AgentInput;
/** A form's URL on the UAG, by id; empty when the definition has no `_id`. */
export declare function uagFormUrl(uagUrl: string, definition: { _id?: string; project?: string } | null | undefined): string;
/** The formio.js fetch plugin that sends the submission requests of `uag` forms to the UAG. */
export declare function routingPlugin(uagUrl: string): { priority: number; preRequest(args: any): void; wrapRequestPromise(promise: any, args: any): any };
export declare function isEmpty(value: unknown): boolean;

declare const uag: {
    UAG: typeof UAG;
    attach: typeof attach;
    uagFormUrl: typeof uagFormUrl;
    routingPlugin: typeof routingPlugin;
    ExtractionState: typeof ExtractionState;
    SSEParser: typeof SSEParser;
    isEmpty: typeof isEmpty;
};
export default uag;
