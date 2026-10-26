import type { EngineTypeDefinition } from './index';

export type ConformanceResult = { check: string; ok: boolean; skipped?: boolean; message?: string };

export type ConformanceReport = {
    ok: boolean;
    /** "<check>: <why>" for each failed check. */
    failures: string[];
    results: ConformanceResult[];
};

/** Check an engine type against the engine contract, from any test runner. */
export declare function checkEngine(definition: EngineTypeDefinition, options?: {
    /** The instance name to create. Default: "conformance". */
    name?: string;
    /** The instance's options, such as a fake client. */
    options?: Record<string, any>;
    env?: Record<string, string | undefined>;
    config?: Record<string, any>;
    /** How long each call may take, in milliseconds. Default: 10000. */
    timeout?: number;
}): Promise<ConformanceReport>;
