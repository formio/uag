import path from 'path';
import { engineInstances } from '@formio/uag-sdk';
import type { EngineTypeDefinition } from '@formio/uag-sdk';
import { enginePaths, planEngines } from '@formio/uag-sdk/loader';
import { Formflow } from '@formio/appserver';
import { EngineRegistry } from '../formflow';
import { RemoteEngine } from './remote';
import { StubAgentEngine, StubDecisionEngine } from './stubs';

/** The UAG's own installation, where engine packages are looked up first. */
export const UAG_ROOT = path.resolve(__dirname, '..', '..');

/** Engine types every UAG has, whatever is installed. */
export const BUILT_IN_ENGINES: Record<string, EngineTypeDefinition> = {
    remote: RemoteEngine,
    'stub-decision': StubDecisionEngine,
    'stub-agent': StubAgentEngine,
};

/** What is known of each loaded engine type, by type name: for listing it as a plugin. */
export type LoadedEngineType = { name: string; title: string; version?: string; kinds: ('decision' | 'agent')[]; instances: string[] };
const loadedTypes = new WeakMap<EngineRegistry, LoadedEngineType[]>();

/** The engine types a registry's instances were created from, in order of first use. */
export function engineTypesOf(registry: EngineRegistry | undefined): LoadedEngineType[] {
    return (registry && loadedTypes.get(registry)) || [];
}

export async function loadUAGEngines(
    config: Record<string, any> = {},
    env: Record<string, string | undefined> = process.env
): Promise<EngineRegistry> {
    const loaded = planEngines(engineInstances(config, env), {
        types: { ...BUILT_IN_ENGINES, ...(config.engineTypes || {}) },
        paths: enginePaths(UAG_ROOT, env),
        env,
        config,
        apiVersion: Formflow.ENGINE_API_VERSION,
    });
    // Agentic Formflow creates the engines from the plans.
    const registry = await Formflow.startEngines(loaded as any);
    const types = new Map<string, LoadedEngineType>();
    for (const entry of loaded as any[]) {
        const type = types.get(entry.type) || { name: entry.type, title: entry.title || entry.type, version: entry.typeVersion || entry.version, kinds: entry.kinds, instances: [] as string[] };
        type.instances.push(entry.name);
        types.set(entry.type, type);
    }
    loadedTypes.set(registry, [...types.values()]);
    return registry;
}
