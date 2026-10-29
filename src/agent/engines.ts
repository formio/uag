import path from 'path';
import { engineInstances } from '@formio/uag-sdk';
import type { EngineTypeDefinition } from '@formio/uag-sdk';
import { enginePaths, loadEngines } from '@formio/uag-sdk/loader';
import { Formflow } from '@formio/appserver-core';
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

/**
 * Enable the engines the configuration names (`engines`), or else
 * `UAG_ENGINES`. Each type is resolved from the configuration's `engineTypes`,
 * then the built-in types, then installed packages; nothing named means no
 * engines. Any problem stops startup with the instance named.
 */
export async function loadUAGEngines(
    config: Record<string, any> = {},
    env: Record<string, string | undefined> = process.env
): Promise<EngineRegistry> {
    const loaded = await loadEngines(engineInstances(config, env), {
        types: { ...BUILT_IN_ENGINES, ...(config.engineTypes || {}) },
        paths: enginePaths(UAG_ROOT, env),
        env,
        config,
        apiVersion: Formflow.ENGINE_API_VERSION,
    });
    return Formflow.engineRegistry(loaded);
}
