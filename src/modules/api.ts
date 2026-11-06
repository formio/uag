import { NodeHtmlMarkdown } from 'node-html-markdown';
import type { ModuleApi } from '@formio/appserver';
import { callerKey, formflow, FormflowError } from '../formflow';
import { sanitizeMarkdown } from '../markdown';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import type { PluginRegistry } from '@formio/appserver';
import { identify } from '../documents/detect';
import { runRoute } from '../documents/convert';
import { documentsOf } from '../documents/plugins';
import { stepName } from '../documents/routes';
import type { Converter, Representation } from '../documents/types';
import type { UAGModuleApi } from './types';

async function pageCount(pdf: Buffer): Promise<number | undefined> {
    try {
        const { PDFDocument } = require('pdf-lib');
        return (await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
    }
    catch {
        return undefined;
    }
}

const readsOf = (engine: any): Representation[] => (Array.isArray(engine?.accepts) ? engine.accepts : ['text']);

/** What the UAG's members of the module API run on: the server's, or a test kit's. */
export type UAGModuleApiDeps = {
    registry(): PluginRegistry;
    /** The enabled engines: by name, and the agent engines in preference order. */
    engines(): { get(name: string): any; agent: any[] } | undefined;
    /** Generate with an engine from the registry. */
    generate(engine: any, request: any): Promise<any>;
    /** Throw 403 license_required unless Agentic Formflow is allowed. */
    requireLicense(): Promise<void>;
    requireAccess?: ModuleApi['requireAccess'];
};

/** The server's: its one project, looked up when a member is called. */
export function serverDeps(projectOf: () => UAGProjectInterface | undefined): UAGModuleApiDeps {
    const project = () => {
        const found = projectOf();
        if (!found) throw new FormflowError(503, 'The server is still starting.', 'not_ready');
        return found;
    };
    return {
        registry: () => {
            const plugins = project().plugins;
            if (!plugins) throw new FormflowError(503, 'The server is still starting.', 'not_ready');
            return plugins;
        },
        engines: () => project().formflowEngines(),
        generate: (engine, request) => formflow(project()).engineGenerate(engine, request),
        requireLicense: () => formflow(project()).requireLicense(),
        // The Agent API's own check, so a module's refusals read as the agent operations' do.
        requireAccess: (auth, form, methods) => formflow(project()).requireAccess(auth, form as any, methods)
    };
}

/**
 * The UAG's module API (version 1): appserver's, with the Agent API's access
 * check, the license check, converters, engines and helpers, behind stable names.
 */
export function uagModuleApi(base: ModuleApi, deps: UAGModuleApiDeps): UAGModuleApi {
    const registry = deps.registry;
    const generate = deps.generate;
    const api: UAGModuleApi = {
        ...base,
        ...(deps.requireAccess && { requireAccess: deps.requireAccess }),
        requireLicense: deps.requireLicense,
        converters: {
            list: () => registry().list<Converter>('converter'),
            identify: (buffer, hint) => identify(buffer, hint, registry().list<Converter>('converter')),
            route: (type, inputs, pins) => documentsOf(registry()).routes.route(type, inputs, pins || {}),
            accept: (inputs) => documentsOf(registry()).routes.accept(inputs),
            run: (steps, input, to, options) => runRoute(steps, input, to, {
                signal: options.signal,
                log: base.log,
                settingsOf: (converter: Converter) => registry().settings('converter', converter.name)
            }),
            stepName: (converter) => stepName(converter as any)
        },
        engines: {
            select({ name, needs = [] }) {
                const engines = deps.engines();
                if (!engines) throw new FormflowError(503, 'The engines are not loaded yet.', 'not_ready');
                const capable = (engine: any) => engine?.kind === 'agent' && typeof engine.generate === 'function' && needs.every((kind) => readsOf(engine).includes(kind));
                const engine: any = name ? engines.get(name) : engines.agent.find(capable);
                if (!engine || !capable(engine)) {
                    const missing = needs.find((kind) => !engine || !readsOf(engine).includes(kind)) || needs[0] || 'text';
                    throw new FormflowError(503, name && !engine ? `The engine "${name}" is not enabled.` : `no enabled engine can read ${missing} documents`, 'no_engine');
                }
                // A handle, not the engine.
                return {
                    name: engine.name,
                    model: engine.model,
                    accepts: readsOf(engine),
                    generate: (request: any) => generate(engine, request)
                };
            }
        },
        markdown: {
            sanitize: (text) => sanitizeMarkdown(text),
            fromHtml: (html) => NodeHtmlMarkdown.translate(String(html || '')).trim()
        },
        pdf: { pageCount },
        callerKey: (req) => {
            const key = callerKey((req as any).auth);
            return key === 'anonymous' ? `anonymous:${req.ip || req.socket?.remoteAddress || ''}` : key;
        }
    };
    return api;
}
