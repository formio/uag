import type { Request, Response } from 'express';
import type { AuthRequest, FormInterface } from '@formio/appserver';
import type { Converter, ConverterOutput, Representation } from '../documents/types';
import type { FileRoute, Pins, AcceptEntry } from '../documents/routes';

/** The feature API versions this UAG provides. */
export const FEATURE_API_VERSIONS = [1];

/**
 * A feature's settings: a function of the server's configuration and the
 * environment, returning the settings the feature reads as `api.settings`.
 * It throws to stop startup, with a message naming the setting.
 */
export type FeatureSettings = (config: Record<string, any>, env: Record<string, string | undefined>) => Record<string, any>;

/** Reports progress of a streamed endpoint: a fraction from 0 to 1, and an optional message. */
export type FeatureProgress = (fraction: number, message?: string) => void;

/** What a streamed endpoint's run receives. */
export type FeatureRunContext = { signal: AbortSignal; progress: FeatureProgress };

/**
 * A form route of a feature. Its handler answers, or returns the JSON to
 * answer with; it throws `api.errors.create(status, message, code)` to refuse.
 * To stream progress, it returns `api.stream(req, res, run)`.
 */
export type FeatureEndpoint = {
    /** The operation's name, for rate limits, such as "document". */
    name: string;
    handler(req: FeatureRequest, res: Response, api: FeatureApi): any;
};

export type FeatureRequest = Request & { form: FormInterface; auth: AuthRequest; requestId: string };

/** A formio.js component a feature brings to browsers. */
export type FeatureComponent = {
    /** The component type, such as "uagdocument". */
    type: string;
    /** A script that registers the component with Formio.use: a file path or file URL. */
    script: string | URL;
    /** Its stylesheet, a file path or file URL. */
    style?: string | URL;
};

/** A module's `uag` key: the feature it brings. */
export type FeatureDefinition = {
    name: string;
    title?: string;
    version?: string;
    apiVersion: number;
    settings?: FeatureSettings;
    routes?: { form?: Record<string, FeatureEndpoint> };
    components?: FeatureComponent[];
    /** Called once at startup, after the settings are resolved, before any request. */
    initialize?(api: FeatureApi): void | Promise<void>;
};

export type FeatureLog = { info(message: string): void; warn(message: string): void; error(message: string): void };

/** An agent engine that can generate. */
export type GeneratingEngine = { name: string; kind: 'agent'; model: string; accepts?: Representation[]; generate(request: any): Promise<any> };

/**
 * The feature API, version 1: what the UAG gives a feature, behind stable
 * names. The project itself is never handed out.
 */
export type FeatureApi = {
    apiVersion: 1;
    name: string;
    settings: Record<string, any>;
    log: FeatureLog;
    plugins: {
        get<T = any>(type: string, name: string): T | undefined;
        list<T = any>(type: string): T[];
        settings(type: string, name: string): Record<string, any> | undefined;
    };
    /** Throws 401 or 403, as the Agent API does, unless the caller may use the form with one of `methods`. */
    requireAccess(auth: AuthRequest | undefined, form: FormInterface, methods: string[]): void;
    /** Throws 403 license_required unless Agentic Formflow is allowed. */
    requireLicense(): Promise<void>;
    files: {
        /** A stored file value's bytes, read with the caller's credentials and the file component's storage check; null when it cannot be read here. */
        read(form: FormInterface, value: any, auth: AuthRequest | undefined, options: { maxBytes?: number; component?: any }): Promise<Buffer | null>;
    };
    converters: {
        list(): Converter[];
        identify(buffer: Buffer, hint: { name: string; type?: string }): string;
        route(type: string, inputs: Representation[][], pins?: Pins): FileRoute | null;
        accept(inputs: Representation[][]): AcceptEntry[];
        run(steps: Converter[], input: { buffer: Buffer; type: string; name: string }, to: Representation, options: { signal: AbortSignal }): Promise<ConverterOutput>;
        stepName(converter: { name: string; version?: string }): string;
    };
    engines: {
        /** The named engine, or the first agent engine that generates and reads every representation in `needs`; throws 503 no_engine. */
        select(options: { name?: string; needs?: Representation[] }): GeneratingEngine;
        /** Checks the license, then calls the engine. */
        generate(engine: GeneratingEngine, request: any): Promise<any>;
    };
    markdown: {
        sanitize(text: string): string;
        fromHtml(html: string): string;
    };
    pdf: { pageCount(pdf: Buffer): Promise<number | undefined> };
    forms: {
        /** The component at a data path of the stored form (row indices ignored), or undefined. */
        componentAt(form: FormInterface, path: string): any;
        /** A component anywhere in the stored form, by key, or undefined. */
        componentByKey(form: FormInterface, key: string): any;
    };
    callerKey(auth: AuthRequest | undefined): string;
    errors: {
        /** An error the UAG answers with this status and code, and this message. */
        create(status: number, message: string, code?: string): Error;
        is(err: unknown): boolean;
    };
    /**
     * Answer with what `run` returns: `{ result }` as JSON, or, to a client that
     * accepts text/event-stream, `progress` events and then `done` (`{ result }`)
     * or `failed` (the error shape). `run` gets `{ signal, progress }`; `signal`
     * aborts when the client goes away.
     */
    stream(req: FeatureRequest, res: Response, run: (context: FeatureRunContext) => any, options?: { heartbeatMs?: number }): Promise<void>;
};
