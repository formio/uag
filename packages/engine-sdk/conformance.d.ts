import type { EngineTypeDefinition } from './index';
import type { DecisionQuestion, DecisionState, FieldSpec, ToolDefinition } from './contract';

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

/** The fixed inputs the check sends, for an engine's own tests and fakes. */
export declare const STATE: DecisionState;
export declare const FIELDS: FieldSpec[];
export declare const SCHEMA: Record<string, any>;
export declare const QUESTIONS: Record<string, DecisionQuestion>;
/** The research tool the check offers. */
export declare const LOOKUP: ToolDefinition;
