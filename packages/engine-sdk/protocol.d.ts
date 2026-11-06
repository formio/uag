import type { Attachment, DecisionQuestion, DecisionResponse, DecisionState, ExtractResponse, FieldSpec, GenerateRequest, GenerateResponse, ToolDefinition } from './contract';

/** The remote engine protocol version this SDK speaks. */
export declare const PROTOCOL_VERSION: 1;

/** The header that carries a scoped token, on research extracts only. */
export declare const SCOPED_TOKEN_HEADER: 'x-uag-scoped-token';

/** The optional header that carries the Agent API request id, on decide and extract. */
export declare const REQUEST_ID_HEADER: 'x-request-id';

/** A request id that is safe to send and log (up to 128 of `[A-Za-z0-9._:-]`), or undefined. */
export declare function safeRequestId(value: unknown): string | undefined;

/** A message in another protocol version, or of the wrong shape. */
export declare class ProtocolError extends Error {
    status: number;
    constructor(message: string, status?: number);
}

/** One engine an engine server hosts, as `GET /v1/engines` describes it. */
export type RemoteEngineDescription = {
    name: string;
    kind: 'decision' | 'agent';
    model: string;
    maxOptions?: number;
    toolUse?: boolean;
    /** Agent engines: the document kinds generate reads. Default ['text']. */
    accepts?: Array<'text' | 'pdf'>;
    /** Agent engines: whether the engine generates free text. */
    generate?: boolean;
};

/** The most PDF bytes one generate request carries (32 MB). */
export declare const MAX_DOCUMENT_BYTES: number;

/** A generate request on the wire: PDFs as base64. */
export type WireAttachment =
    | { kind: 'pdf'; data: string; label: string; pages?: number }
    | { kind: 'text'; text: string; label: string; textFormat?: 'plain' | 'markdown' | 'csv' };

export type RemoteExtractRequest = {
    instructions: string;
    state: DecisionState;
    fields: FieldSpec[];
    schema: Record<string, any>;
    tools?: ToolDefinition[];
    maxIterations?: number;
};

export declare function checkVersion(body: unknown, side?: 'request' | 'response'): void;
export declare function checkDecideRequest(body: unknown): { state: DecisionState; questions: Record<string, DecisionQuestion> };
export declare function checkExtractRequest(body: unknown): RemoteExtractRequest;
export declare function checkDescription(body: unknown): RemoteEngineDescription[];
export declare function checkDecisionResponse(body: unknown): DecisionResponse;
export declare function checkExtractResponse(body: unknown): ExtractResponse;
export declare function checkGenerateRequest(body: unknown, maxBytes?: number): Omit<GenerateRequest, 'signal' | 'onProgress'>;
export declare function checkGenerateResponse(body: unknown): GenerateResponse;
export declare function encodeAttachments(attachments?: Attachment[]): WireAttachment[];
export declare function pdfByteLength(attachments?: Attachment[]): number;
export declare function errorBody(message: string, expose?: boolean): { protocol: 1; error: string; expose: boolean };
