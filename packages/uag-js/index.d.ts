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
    /**
     * Require the user to check every uncertain value before the wizard moves
     * on or the form submits: they change it, or tick "Yes, this looks right"
     * on its note, which then turns `uag-reviewed`. Default `false`.
     */
    requireReview?: boolean;
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

/** One message of a chat's conversation. */
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

/** A field the chat could not collect yet; the person finishes it in the form. */
export interface ChatUnsupportedField {
    path: string;
    label: string;
    required: boolean;
    empty: boolean;
}

/** The UAG's answer to one turn of a form's chat (`POST {form}/agent/chat`). */
export interface ChatTurnResponse {
    requestId?: string;
    /** The assistant's next message. */
    reply: string;
    /** The values accepted this turn, by data path. */
    patch: Record<string, unknown>;
    /** The form's data with `patch` applied. */
    data: Record<string, unknown>;
    /** Each value the engine gave this turn: `suggested` (accepted) or `invalid` (with `error`). */
    fields: Record<string, { path: string; label: string; status: 'suggested' | 'invalid'; value: unknown; error?: string }>;
    errors: { path: string; label?: string; error: string }[];
    remaining: {
        required: { path: string; label: string }[];
        optional: { path: string; label: string }[];
        unsupported: ChatUnsupportedField[];
    };
    /** Every required field is filled and valid: the form can be submitted. */
    complete: boolean;
    /** The person confirmed the summary they were shown, and nothing changed. */
    confirmed: boolean;
    engine: {
        name: string;
        model: string;
        latencyMs: number;
        toolCalls: { name: string; isError: boolean }[];
        usage?: { inputTokens?: number | null; outputTokens?: number | null };
    };
}

/** A template: an HTML string interpolated by formio.js, or a function of its context. */
export type ChatTemplate = { form: string | ((ctx: any) => string) };

/** The chat's template names, and the context each is rendered with (plus formio.js's own: `t`, `options`, …). */
export interface ChatTemplateContexts {
    uagChat: { title: string; view: 'chat' | 'form'; labels: { open: string; close: string; reset: string; log: string }; log: string; composer: string; form: string };
    uagChatMessage: { role: 'user' | 'assistant'; text: string; html: string };
    uagChatTyping: { ariaLabel: string };
    uagChatSuggestions: { suggestions: string[] };
    uagChatComposer: { inputId: string; inputLabel: string; placeholder: string; sendLabel: string; maxLength: number; inactive: boolean; busy: boolean };
    uagChatSummary: { title: string; rows: { label: string; value: string }[]; submitLabel: string; editLabel: string; busy: boolean };
    uagChatNotice: { kind: 'info' | 'error' | 'success'; text: string };
}

/** Options of `createChat`, on top of every formio.js form option (`templates`, `i18n`, `language`, `readOnly`, `hooks`, …). */
export interface ChatOptions {
    /** The UAG's URL, when not the one given to `UAG()`. */
    uagUrl?: string;
    /** Where to send turns instead of the form's chat on the UAG, such as a relay of your own. */
    chatUrl?: string;
    /** The title in the chat's header. Default: the form's title. */
    title?: string;
    /** The first message, shown and never sent. `{{title}}` is the form's title; `''` shows none. */
    greeting?: string;
    /** Messages the person can send with one click, until they send their first. */
    suggestions?: string[];
    placeholder?: string;
    /** The summary's submit button. Default: "Submit". */
    submitLabel?: string;
    /** The message after a successful submission. */
    submitted?: string;
    /** Render a reply as HTML (for example with marked). The output is always sanitized. */
    markdown?: (text: string) => string;
    /** Keep the conversation and data across reloads, per form. Default: not kept. */
    storage?: 'session' | 'local';
    /** The most messages sent with a turn (newest first). Default: 40, the UAG's default limit. */
    maxMessages?: number;
    /** The composer's character limit. Default: 2000, the UAG's default limit. */
    maxMessageLength?: number;
    fetch?: typeof fetch;
    templates?: Partial<Record<keyof ChatTemplateContexts, ChatTemplate>> & Record<string, ChatTemplate>;
    [option: string]: any;
}

/** The chat: a formio.js form (a Webform) rendered as a conversation. */
export interface ChatForm {
    /** The conversation so far (not the greeting or notices). */
    readonly messages: ChatMessage[];
    /** Send a message. Resolves with the turn's response, or null when it failed or was dropped. */
    send(text: string): Promise<ChatTurnResponse | null>;
    /** Start over: clear the conversation and the values the chat wrote. */
    reset(): void;
    /** Show the form itself, to review or edit. */
    openForm(): void;
    /** Return from the form to the chat. */
    closeForm(): void;
    /** Submit the form (through the UAG), as the summary's Submit button does. */
    submitChat(): Promise<any>;
    on(event: 'chatMessage', handler: (message: ChatMessage) => void): void;
    on(event: 'chatReply' | 'chatComplete', handler: (response: ChatTurnResponse) => void): void;
    on(event: 'chatError', handler: (error: Error & { status?: number; response?: any }) => void): void;
    on(event: 'chatReset', handler: () => void): void;
    on(event: string, handler: (...args: any[]) => void): void;
    [member: string]: any;
}

export interface UAGOptions extends Omit<AttachOptions, 'uagUrl' | 'formUrl'> {
    /** `false` attaches no Agent Input anywhere; submissions of `uag` forms still go to the UAG. */
    agentInput?: boolean;
    /** AI Document options. `auto`: process files on upload unless a component turns it off (default true). */
    documents?: { auto?: boolean };
    /**
     * Portal mode (the UAG's portal script): register only the AI Document
     * component and the manifest. Saves are not routed and Agent Input is not run.
     */
    portal?: boolean;
    /** The installed plugins, as `GET {project}/plugins` describes them. Fetched at registration when not given. */
    manifest?: PluginManifestEntry[];
}

/** One installed plugin, as the UAG's manifest describes it. */
export interface PluginManifestEntry {
    type: string;
    name: string;
    title: string;
    description?: string;
    version: string;
    stability: 'stable' | 'experimental';
    editForm?: any[];
    /** Document plugins: the file types the installed converters can bring to it. */
    accept?: Array<{ type: string; ext: string[]; routes: Record<string, any>; converters: string[] }>;
    inputs?: Array<Array<'pdf' | 'text'>>;
    editable?: boolean;
    output?: 'markdown' | 'text';
    defaults?: Record<string, any>;
    [field: string]: any;
}

/** An AI Document's stored `result`. */
export interface AIDocumentResult {
    content: string;
    format: 'markdown' | 'text';
    status: 'ok' | 'flagged';
    issues: Array<{ kind: string; message: string; output?: string; document?: string; page?: number; file?: string }>;
    summary: string;
    edited: boolean;
    meta: { plugin: string; engine: string; model: string; files: Array<{ name: string; route: string[]; pages?: number }> };
}

/**
 * Events an AI Document emits on its form: `uagDocumentStart` ({ component, path, files }),
 * `uagDocumentProgress` ({ component, path, progress, message? }), `uagDocumentResult`
 * ({ component, path, result }), `uagDocumentError` ({ component, path, error }).
 */
export type AIDocumentEvent = 'uagDocumentStart' | 'uagDocumentProgress' | 'uagDocumentResult' | 'uagDocumentError';

/** Render Markdown as the AI Document does: headings, paragraphs, lists, tables, emphasis, code and safe links, all text escaped. */
export declare function renderMarkdown(markdown: string): string;

/** Options for `client.stream`. */
export interface ClientStreamOptions {
    /** Called with every server-sent event, by name. */
    onEvent?(name: string, data: any): void;
    signal?: AbortSignal;
    /** The rendered form, whose Form.io token identifies the user. */
    form?: any;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
}

/** An error the UAG answered with. */
export interface UAGClientError extends Error {
    status?: number;
    code?: string;
}

/**
 * The public browser API that components of UAG features build on, once
 * `Formio.use(UAG(url))` has run. Stable within a major version.
 */
export interface UAGClient {
    /** The UAG's URL. */
    url(): string;
    /** The user's Form.io token, from the form's own formio or the SDK. */
    token(form?: any): string | null;
    /** The headers that identify the user to the UAG. */
    headers(form?: any): Record<string, string>;
    /** A form's URL on the UAG, from its definition (or a rendered form). */
    formUrl(definition: any): string;
    /** Resolves once the installed plugins are known. */
    ready: Promise<void>;
    /** Whether the installed plugins are known yet. */
    readonly loaded: boolean;
    /** The installed plugins, of one type or all. */
    plugins(type?: string): PluginManifestEntry[];
    plugin(type: string, name: string): PluginManifestEntry | null;
    /** POST JSON, accepting server-sent events: resolves with the `done` event's data, or the JSON answer. */
    stream(url: string, body: any, options?: ClientStreamOptions): Promise<any>;
    renderMarkdown(markdown: string): string;
    escapeHtml(value: unknown): string;
    /** The formio.js the UAG was registered with. */
    readonly Formio: any;
}

export declare const client: UAGClient;

/** The formio.js module: `Formio.use(UAG('https://uag.example.com'))`. It also registers the `chat` display and `Formio.createChat`. */
export declare function UAG(uagUrl: string, options?: UAGOptions): (Formio: any) => { fetch: Record<string, any>; displays?: Record<string, any> };
export declare namespace UAG {
    /** Resolves once the installed document plugins are known (embedded by the UAG's scripts, or fetched at registration). */
    const ready: Promise<void>;
    /** The same as `renderMarkdown`. */
    function renderMarkdown(markdown: string): string;
    /** The same as `client`. */
    const client: UAGClient;
    /** The same as `attach`. */
    function attach(form: any, options?: AttachOptions): AgentInput;
    /** The same as `createChat`. */
    function createChat(element: HTMLElement, src: string | Record<string, any>, options?: ChatOptions): Promise<ChatForm>;
}

/**
 * Render a form as a chat, as `Formio.createForm` renders it as a form. `src` is
 * the form's Form.io URL, or a definition with its `_id`. After `UAG()` is
 * registered, `Formio.createChat` is the same function.
 */
export declare function createChat(element: HTMLElement, src: string | Record<string, any>, options?: ChatOptions): Promise<ChatForm>;
/** The built-in chat templates, by name. */
export declare const CHAT_TEMPLATES: Record<keyof ChatTemplateContexts, ChatTemplate>;

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
    createChat: typeof createChat;
    uagFormUrl: typeof uagFormUrl;
    routingPlugin: typeof routingPlugin;
    ExtractionState: typeof ExtractionState;
    SSEParser: typeof SSEParser;
    isEmpty: typeof isEmpty;
    CHAT_TEMPLATES: typeof CHAT_TEMPLATES;
};
export default uag;
