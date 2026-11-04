import { NodeHtmlMarkdown } from 'node-html-markdown';
import { Utils } from '@formio/core';
import type { AuthRequest, FormInterface } from '@formio/appserver';
import { callerKey, formflow, FormflowError } from '../formflow';
import { sanitizeMarkdown } from '../markdown';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import { identify } from '../documents/detect';
import { runRoute } from '../documents/convert';
import { documentsOf } from '../documents/plugins';
import { stepName } from '../documents/routes';
import type { Converter, Representation } from '../documents/types';
import type { FeatureApi, FeatureDefinition, GeneratingEngine } from './types';
import { streamAnswer } from './routes';

/** The component at a data path in a stored form, row indices removed (`rows[2].contract` is `rows.contract`). */
function componentAt(components: any[], dataPath: string): any {
    const path = String(dataPath || '').replace(/\[\d+\]/g, '');
    let found: any;
    // With every component included, the paths also name layout components (panels, columns).
    Utils.eachComponent(components, (component: any, componentPath: string, _components: any, _parent: any, paths: any) => {
        if (!found && (paths?.path ?? componentPath) === path) found = component;
    }, true);
    return found;
}

function componentByKey(components: any[], key: string): any {
    let found: any;
    Utils.eachComponent(components, (component: any) => {
        if (!found && component.key === key) found = component;
    }, true);
    return found;
}

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

/**
 * The feature API (version 1) a feature gets for a project: the UAG's checks,
 * file reading, converters, engines and helpers, behind stable names.
 */
export function createFeatureApi(project: UAGProjectInterface, definition: FeatureDefinition, settings: Record<string, any>): FeatureApi {
    const registry = () => {
        if (!project.plugins) throw new FormflowError(503, 'The server is still starting.', 'not_ready');
        return project.plugins;
    };
    const prefix = `[feature ${definition.name}]`;
    const requireLicense = () => formflow(project).requireLicense();
    const api: FeatureApi = {
        apiVersion: 1,
        name: definition.name,
        settings,
        log: {
            info: (message) => console.log(`${prefix} ${message}`),
            warn: (message) => console.warn(`${prefix} ${message}`),
            error: (message) => console.error(`${prefix} ${message}`)
        },
        plugins: {
            get: (type, name) => registry().get(type, name) as any,
            list: (type) => registry().list(type) as any,
            settings: (type, name) => registry().settings(type, name)
        },
        requireAccess: (auth, form, methods) => formflow(project).requireAccess(auth, form as any, methods),
        requireLicense,
        files: {
            read: (form: FormInterface, value: any, auth: AuthRequest | undefined, options) =>
                (form as any).readFile(value, auth, options)
        },
        converters: {
            list: () => registry().list<Converter>('converter'),
            identify: (buffer, hint) => identify(buffer, hint, registry().list<Converter>('converter')),
            route: (type, inputs, pins) => documentsOf(registry()).routes.route(type, inputs, pins || {}),
            accept: (inputs) => documentsOf(registry()).routes.accept(inputs),
            run: (steps, input, to, options) => runRoute(steps, input, to, {
                signal: options.signal,
                log: api.log,
                settingsOf: (converter: Converter) => registry().settings('converter', converter.name)
            }),
            stepName: (converter) => stepName(converter as any)
        },
        engines: {
            select({ name, needs = [] }) {
                const engines = project.formflowEngines();
                const capable = (engine: any) => engine?.kind === 'agent' && typeof engine.generate === 'function' && needs.every((kind) => readsOf(engine).includes(kind));
                const engine: any = name ? engines.get(name) : engines.agent.find(capable);
                if (!engine || !capable(engine)) {
                    const missing = needs.find((kind) => !engine || !readsOf(engine).includes(kind)) || needs[0] || 'text';
                    throw new FormflowError(503, name && !engine ? `The engine "${name}" is not enabled.` : `no enabled engine can read ${missing} documents`, 'no_engine');
                }
                return engine as GeneratingEngine;
            },
            async generate(engine, request) {
                await requireLicense();
                return engine.generate(request);
            }
        },
        markdown: {
            sanitize: (text) => sanitizeMarkdown(text),
            fromHtml: (html) => NodeHtmlMarkdown.translate(String(html || '')).trim()
        },
        pdf: { pageCount },
        forms: {
            componentAt: (form, path) => componentAt((form as any).form?.components || [], path),
            componentByKey: (form, key) => componentByKey((form as any).form?.components || [], key)
        },
        callerKey: (auth) => callerKey(auth as any),
        errors: {
            create: (status, message, code) => new FormflowError(status, message, code),
            is: (err) => err instanceof FormflowError
        },
        stream: (req, res, run, options) => streamAnswer(definition.name, req, res, run, options)
    };
    return api;
}
