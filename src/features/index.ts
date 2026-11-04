import fs from 'fs';
import { fileURLToPath } from 'url';
import type { RequestHandler } from 'express';
import type { Plugin, PluginRegistry, PluginType } from '@formio/appserver';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import { UAG_VERSION } from '../version';
import { createFeatureApi } from './api';
import { resolveFeatureSettings } from './settings';
import { featureFormRouter, projectOf, ROUTE } from './routes';
import { FEATURE_API_VERSIONS } from './types';
import type { FeatureApi, FeatureComponent, FeatureDefinition } from './types';

export * from './types';
export { createFeatureApi } from './api';
export { resolveFeatureSettings } from './settings';

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COMPONENT_TYPE = /^[a-z][a-z0-9]*$/;

/** A feature as the UAG holds it. */
export type Feature = {
    definition: FeatureDefinition;
    source: string;
    settings: Record<string, any>;
    apis: WeakMap<object, FeatureApi>;
};

/** A component's files, as paths. */
const pathOf = (file: string | URL) => (file instanceof URL || /^file:/.test(String(file)) ? fileURLToPath(file) : String(file));

/** The problems with a module's `uag` key, as messages. */
function problemsOf(definition: any, source: string): string[] {
    const problems: string[] = [];
    if (!definition || typeof definition !== 'object') return [`The "uag" key of ${source} must be an object declaring a feature`];
    const name = String(definition.name || '');
    const label = name ? `Feature ${name} (${source})` : `The feature of ${source}`;
    if (!NAME.test(name)) problems.push(`${label}: "name" must be lowercase letters and digits, words joined by "-"`);
    if (!FEATURE_API_VERSIONS.includes(definition.apiVersion)) {
        problems.push(`${label} needs feature API ${definition.apiVersion ?? '(none given)'}; this UAG provides ${FEATURE_API_VERSIONS.join(', ')}`);
    }
    const settings = definition.settings;
    if (settings !== undefined && (typeof settings !== 'object' || typeof settings.key !== 'string' || !settings.key || typeof settings.defaults !== 'object')) {
        problems.push(`${label}: "settings" must give a "key" and "defaults"`);
    }
    for (const [key, endpoint] of Object.entries<any>(definition.routes?.form || {})) {
        if (!ROUTE.test(key)) problems.push(`${label}: route "${key}" must be "<METHOD> /<path>"`);
        if (!endpoint || typeof endpoint.handler !== 'function' || typeof endpoint.name !== 'string' || !endpoint.name) {
            problems.push(`${label}: route "${key}" must have a "name" and a "handler"`);
        }
    }
    for (const component of definition.components || []) {
        if (!component || !COMPONENT_TYPE.test(String(component.type || ''))) {
            problems.push(`${label}: each component needs a "type" of lowercase letters and digits`);
            continue;
        }
        for (const file of [component.script, component.style].filter(Boolean)) {
            if (!fs.existsSync(pathOf(file))) problems.push(`${label}: the file of component "${component.type}" is missing: ${pathOf(file)}`);
        }
        if (!component.script) problems.push(`${label}: component "${component.type}" needs a "script"`);
    }
    if (definition.initialize !== undefined && typeof definition.initialize !== 'function') problems.push(`${label}: "initialize" must be a function`);
    return problems;
}

/** Plugin type `feature`: the features in use, listed by the UAG itself. */
export const featurePluginType: PluginType = {
    type: 'feature',
    title: 'Feature',
    apiVersions: FEATURE_API_VERSIONS,
    editForm: 'none',
    unavailable: 'error',
    registration: 'internal',
    stability: 'experimental',
    validate: () => [],
    manifest: (plugin: Plugin) => ({ apiVersion: plugin.apiVersion, components: plugin.components, routes: plugin.routes })
};

/**
 * The features the server uses: added as modules are used (a feature used
 * twice, by name, is set up once), checked for conflicts, and set up once the
 * project has loaded.
 */
export class Features {
    readonly list: Feature[] = [];

    has(name: string): boolean {
        return this.list.some((feature) => feature.definition.name === name);
    }

    /**
     * Add a module's feature. Returns false for a feature already added (the
     * module is then not used again); throws for an invalid feature, or one that
     * claims a component type or a route another feature has.
     */
    add(definition: FeatureDefinition, source: string): boolean {
        const problems = problemsOf(definition, source);
        if (problems.length) throw new Error(problems.join('\n'));
        if (this.has(definition.name)) return false;
        for (const other of this.list) {
            const otherRoutes = Object.keys(other.definition.routes?.form || {});
            for (const route of Object.keys(definition.routes?.form || {})) {
                if (otherRoutes.includes(route)) throw new Error(`The form route "${route}" is claimed by two features: ${other.definition.name} (${other.source}) and ${definition.name} (${source})`);
            }
            const otherTypes = (other.definition.components || []).map((component) => component.type);
            for (const component of definition.components || []) {
                if (otherTypes.includes(component.type)) throw new Error(`The component type "${component.type}" is claimed by two features: ${other.definition.name} (${other.source}) and ${definition.name} (${source})`);
            }
        }
        this.list.push({ definition, source, settings: {}, apis: new WeakMap() });
        return true;
    }

    /** The feature's API for a project, made once per project. */
    apiFor(feature: Feature, project: UAGProjectInterface): FeatureApi {
        let api = feature.apis.get(project);
        if (!api) {
            api = createFeatureApi(project, feature.definition, feature.settings);
            feature.apis.set(project, api);
        }
        return api;
    }

    /**
     * The router appserver mounts on every form for a feature's routes: it
     * finds the form's project on each request, and keeps one router per
     * project, built with the feature's API for that project.
     */
    formRoutes(definition: FeatureDefinition): RequestHandler {
        const routers = new WeakMap<object, RequestHandler>();
        return (req, res, next) => {
            const feature = this.list.find((candidate) => candidate.definition === definition);
            const routes = definition.routes?.form;
            const project = (req as any).form && projectOf((req as any).form);
            if (!feature || !routes || !Object.keys(routes).length || !project) return next();
            let router = routers.get(project);
            if (!router) {
                router = featureFormRouter(project, this.apiFor(feature, project), routes);
                routers.set(project, router);
            }
            router(req, res, next);
        };
    }

    /**
     * Set up every feature for the project: resolve and check its settings,
     * list it, and call its initialize. A problem stops startup, naming the
     * feature.
     */
    async start(project: UAGProjectInterface, registry: PluginRegistry, config: Record<string, any>, env: Record<string, string | undefined> = process.env): Promise<void> {
        for (const feature of this.list) {
            const { settings, problems } = resolveFeatureSettings(feature.definition.settings, config, env);
            if (problems.length) {
                throw new Error(`Feature ${feature.definition.name} (${feature.source}) has invalid settings: ${problems.join('; ')}`);
            }
            Object.assign(feature.settings, settings);
        }
        registry.addType(featurePluginType, '@formio/uag');
        registry.add(this.list.map((feature) => ({
            type: 'feature',
            name: feature.definition.name,
            title: feature.definition.title || feature.definition.name,
            version: /^\d+\.\d+\.\d+/.test(String(feature.definition.version || '')) ? String(feature.definition.version) : UAG_VERSION,
            apiVersion: feature.definition.apiVersion,
            components: (feature.definition.components || []).map((component) => component.type),
            routes: Object.keys(feature.definition.routes?.form || {})
        })), 'features', { server: true });
        for (const feature of this.list) {
            await feature.definition.initialize?.(this.apiFor(feature, project));
        }
    }

    /** Every component the features bring, in the order the features were used. */
    components(): Array<FeatureComponent & { feature: string; scriptPath: string; stylePath?: string }> {
        return this.list.flatMap((feature) => (feature.definition.components || []).map((component) => ({
            ...component,
            feature: feature.definition.name,
            scriptPath: pathOf(component.script),
            ...(component.style && { stylePath: pathOf(component.style) })
        })));
    }
}
