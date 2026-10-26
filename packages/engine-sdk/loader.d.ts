import type { Engine } from './contract';
import type { EngineInstanceSpec, EngineTypeDefinition } from './index';

export type LoadOptions = {
    /** Types resolved before any package: the built-in ones, and ones the embedding application passes. */
    types?: Record<string, EngineTypeDefinition>;
    /** Where packages are looked up, from `enginePaths`. */
    paths?: string[];
    env?: Record<string, string | undefined>;
    config?: Record<string, any>;
    /** The engine contract version the host supports. Default: this SDK's. */
    apiVersion?: number;
};

/** An enabled engine and where it came from, ready for `Formflow.engineRegistry`. */
export type LoadedEngine = {
    engine: Engine;
    type: string;
    package?: string;
    version?: string;
};

/** The host's own installation, then each absolute directory in `UAG_ENGINE_PATH`. */
export declare function enginePaths(root: string | undefined, env?: Record<string, string | undefined>): string[];

/** The packages a type name may come from, in order. */
export declare function packageCandidates(type: string): string[];

export declare function resolveType(type: string | EngineTypeDefinition, options?: LoadOptions): {
    definition: EngineTypeDefinition;
    package?: string;
    version?: string;
};

/** Create one engine for an instance, resolving its settings. */
export declare function createEngine(definition: EngineTypeDefinition, options: {
    name: string;
    options?: Record<string, any>;
    env?: Record<string, string | undefined>;
    config?: Record<string, any>;
}): Promise<Engine>;

/** Resolve, configure and create each instance. Any problem stops loading, with the instance named. */
export declare function loadEngines(instances: EngineInstanceSpec[], options?: LoadOptions): Promise<LoadedEngine[]>;
