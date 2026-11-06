import type { Request } from 'express';
import type { ModuleApi, ModuleRequest, ModuleRoute } from '@formio/appserver';
import type { Converter, ConverterOutput, Representation } from '../documents/types';
import type { FileRoute, Pins, AcceptEntry } from '../documents/routes';

/** A module route's request in the UAG: also its request id. */
export type UAGModuleRequest = ModuleRequest & { requestId: string };

/** The names of the UAG's own rate-limited operations, which module routes may not take. */
export const UAG_OPERATIONS = ['extract', 'decide', 'generate', 'chat', 'capabilities'];

/** An agent engine a module may use: its name and model, and generate, which checks the license first. */
export type GeneratingEngine = { name: string; model: string; accepts: Representation[]; generate(request: any): Promise<any> };

/**
 * The module API the UAG gives a module (version 1): appserver's, with the
 * license check, engines, converters and the UAG's helpers. The project and
 * the engines themselves are never handed out.
 */
export type UAGModuleApi<Settings extends Record<string, any> = Record<string, any>> = ModuleApi<Settings> & {
    /** Throws 403 license_required unless Agentic Formflow is allowed. */
    requireLicense(): Promise<void>;
    converters: {
        list(): Converter[];
        identify(buffer: Buffer, hint: { name: string; type?: string }): string;
        route(type: string, inputs: Representation[][], pins?: Pins): FileRoute | null;
        accept(inputs: Representation[][]): AcceptEntry[];
        run(steps: Converter[], input: { buffer: Buffer; type: string; name: string }, to: Representation, options: { signal: AbortSignal }): Promise<ConverterOutput>;
        stepName(converter: { name: string; version?: string }): string;
    };
    engines: {
        /**
         * The named engine, or the first agent engine that generates and reads every
         * representation in `needs`; throws 503 no_engine. Its `generate` checks the
         * license first, so no module calls a model outside it.
         */
        select(options: { name?: string; needs?: Representation[] }): GeneratingEngine;
    };
    markdown: {
        sanitize(text: string): string;
        fromHtml(html: string): string;
    };
    pdf: { pageCount(pdf: Buffer): Promise<number | undefined> };
    /** Who the request is from, for limits: the user or token, or, for an anonymous caller, `anonymous:<ip>`. */
    callerKey(req: Request): string;
};

/** A form route of a UAG module. */
export type UAGModuleRoute = ModuleRoute<UAGModuleApi>;
