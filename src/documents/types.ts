import type { Plugin, PluginContext } from '@formio/appserver';
import type { GenerateRequest, GenerateResponse } from '@formio/uag-sdk';

export type Representation = 'pdf' | 'text';
export type TextFormat = 'plain' | 'markdown' | 'csv';

/** Plugin type `converter` (apiVersion 1, experimental): a file into a PDF or text. */
export interface Converter extends Plugin {
    type: 'converter';
    /** MIME types (canonical) and extensions it reads. */
    accepts: Array<{ type: string; ext?: string[] }>;
    produces: Representation[];
    /** Default 0; the higher wins when several converters can do a step. */
    rank?: number;
    /** A canonical type for formats the shared detection does not know, or null. */
    detect?(head: Buffer, hint: { name: string; type: string }): string | null;
    /** Defaults: 25 MB, 120000 ms, 2 at a time. */
    limits?: { maxBytes?: number; timeoutMs?: number; concurrency?: number };
    convert(input: { buffer: Buffer; type: string; name: string },
            options: { to: Representation; settings: Record<string, any>; signal: AbortSignal; tmpdir: string; log: PluginContext['log'] }): Promise<ConverterOutput>;
}

export type ConverterOutput =
    | { pdf: Buffer; pages?: number; warnings?: string[] }
    | { text: string; textFormat: TextFormat; pages?: Array<{ page: number; text: string }>; warnings?: string[] };

export type DocumentFile = {
    name: string;
    type: string;
    size: number;
    sha256: string;
    document: { pdf?: Buffer; pages?: number; text?: string; textFormat?: string; textPages?: Array<{ page: number; text: string }> };
    /** The converters it went through, as name@version. */
    route: string[];
    original(): Promise<Buffer>;
};

export type DocumentContext = {
    files: DocumentFile[];
    /** Markdown. */
    instructions: string;
    /** This component's plugin settings, defaults applied. */
    settings: Record<string, any>;
    /** Operator settings. */
    config: Record<string, any>;
    form: { id: string; path: string; title: string };
    component: { key: string; path: string; label: string };
    /** Submission data sent with the request: context only, untrusted. */
    data: Record<string, any>;
    agent: { generate(request: Omit<GenerateRequest, 'signal'>): Promise<GenerateResponse> };
    progress(fraction: number, message?: string): void;
    signal: AbortSignal;
    log: PluginContext['log'];
};

export type Issue = { kind: string; message: string; output?: string; document?: string; page?: number; file?: string };

export type DocumentResult = {
    content: string;
    status: 'ok' | 'flagged';
    issues?: Issue[];
    summary?: string;
};

/** Plugin type `document` (apiVersion 1, experimental): files and instructions into content. */
export interface DocumentPlugin extends Plugin {
    type: 'document';
    /** Acceptable representation sets, in order of preference. */
    inputs: Representation[][];
    /** JSON only; keys are relative to the plugin's settings object. */
    editForm?: any[];
    defaults?: Record<string, any>;
    /** May people edit the content? Default false. */
    editable?: boolean;
    /** Default 'markdown'. */
    output?: 'markdown' | 'text';
    validateSettings?(settings: Record<string, any>): string[];
    process(ctx: DocumentContext): Promise<DocumentResult>;
}
