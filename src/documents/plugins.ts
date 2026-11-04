import type { Plugin, PluginRegistry, PluginType } from '@formio/appserver';
import { BUILT_IN_CONVERTERS } from './converters';
import { AcceptEntry, ConverterRoutes } from './routes';
import type { Converter } from './types';

const REPRESENTATIONS = ['pdf', 'text'];
const isObject = (value: any) => !!value && typeof value === 'object' && !Array.isArray(value);

/** Per registry: the converter routes (with `documents.prefer`), once the converters are set up. */
type DocumentsState = { routes: ConverterRoutes; accept: Map<string, AcceptEntry[]> };
const states = new WeakMap<PluginRegistry, DocumentsState>();

/** The routes over the enabled converters, and each document plugin's `accept`, once the registry has started. */
export function documentsOf(registry: PluginRegistry): DocumentsState {
    let state = states.get(registry);
    if (!state) {
        state = { routes: new ConverterRoutes(registry.list<Converter>('converter')), accept: new Map() };
        states.set(registry, state);
    }
    return state;
}

/** Plugin type `converter`: a file into a PDF or text. Chosen automatically by file type. Experimental in 2.0. */
export const converterPluginType: PluginType = {
    type: 'converter',
    title: 'Converter',
    apiVersions: [1],
    editForm: 'none',
    unavailable: 'disable',
    stability: 'experimental',
    validate(plugin: Plugin) {
        const problems: string[] = [];
        if (!Array.isArray(plugin.accepts) || !plugin.accepts.length || !plugin.accepts.every((accept: any) =>
            isObject(accept) && typeof accept.type === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(accept.type) &&
            (accept.ext === undefined || (Array.isArray(accept.ext) && accept.ext.every((ext: any) => typeof ext === 'string' && /^\.[a-z0-9]+$/i.test(ext)))))) {
            problems.push('"accepts" must list { type, ext? } entries: MIME types, and extensions such as ".docx"');
        }
        if (!Array.isArray(plugin.produces) || !plugin.produces.length || !plugin.produces.every((kind: any) => REPRESENTATIONS.includes(kind))) {
            problems.push('"produces" must list "pdf", "text" or both');
        }
        if (typeof plugin.convert !== 'function') problems.push('"convert" must be a function');
        if (plugin.detect !== undefined && typeof plugin.detect !== 'function') problems.push('"detect" must be a function');
        if (plugin.rank !== undefined && !Number.isFinite(plugin.rank)) problems.push('"rank" must be a number');
        if (plugin.limits !== undefined) {
            if (!isObject(plugin.limits) || !Object.entries(plugin.limits).every(([key, value]) =>
                ['maxBytes', 'timeoutMs', 'concurrency'].includes(key) && Number.isFinite(value) && (value as number) > 0)) {
                problems.push('"limits" may hold positive maxBytes, timeoutMs and concurrency');
            }
        }
        return problems;
    },
    /** Once every converter is set up: the routes between file types, with `documents.prefer`. */
    initialize(registry, context) {
        const prefer = (context.server?.config as any)?.documents?.prefer || {};
        states.set(registry, { routes: new ConverterRoutes(registry.list<Converter>('converter'), prefer), accept: new Map() });
    },
    manifest: (plugin: Plugin) => ({ accepts: plugin.accepts, produces: plugin.produces })
};

/**
 * Register the converter type and the built-in converters, as the server's
 * own. The `document` type comes with the AI Document feature
 * (@formio/uag-extras/features/ai-document).
 */
export function registerDocuments(registry: PluginRegistry) {
    registry.addType(converterPluginType, '@formio/uag');
    registry.add(BUILT_IN_CONVERTERS, '@formio/uag', { server: true });
}
