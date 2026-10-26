import type { Engine } from './contract';

export * from './contract';

/** Engine type and instance names: lowercase letters, digits and "-", starting with a letter. */
export declare const ENGINE_NAME: RegExp;

/** One setting an engine type reads. */
export type SettingSpec = {
    /** The type's own environment variables for the setting, read after `UAG_ENGINE_<NAME>_<SETTING>`. */
    env?: string | readonly string[];
    /** Startup fails, naming the instance and the variables, when no value is set. */
    required?: boolean;
    /** Kept out of logs, error messages and capability discovery. */
    secret?: boolean;
    default?: string | number | boolean;
    /** Values from the environment are converted to this type. Default: "string". */
    type?: 'string' | 'number' | 'boolean';
    description?: string;
};

/** What an engine type's `create` receives for one instance. */
export type EngineCreateContext<Settings = Record<string, any>> = {
    /** The instance name. The engine must use it as its `name`. */
    name: string;
    /** The instance's value for each declared setting that has one. */
    settings: Settings;
    /** The instance's options as given in configuration, including ones that are not settings (such as a test client). */
    options: Record<string, any>;
    /** The host's configuration, read-only (for example routing timeouts). */
    config: Record<string, any>;
    /** A setting's value, or the standard "needs its setting" error, for settings required only in some cases. */
    requireSetting(key: string): any;
};

/** What an engine package exports. */
export interface EngineTypeDefinition<Settings = Record<string, any>> {
    /** The type name, as in `UAG_ENGINES=<type>` and `<name>:<type>`. */
    type: string;
    kinds: readonly ('decision' | 'agent')[];
    /** The engine contract version the type was built for: `ENGINE_API_VERSION`. */
    apiVersion: number;
    description?: string;
    settings?: Record<string, SettingSpec>;
    create(context: EngineCreateContext<Settings>): Engine | Promise<Engine>;
}

/** Validate an engine type definition and return it frozen. Throws a TypeError naming every problem. */
export declare function defineEngine<T extends EngineTypeDefinition<any>>(definition: T): Readonly<T>;

/** Whether a value is a valid engine type definition, from this SDK, another copy of it, or none. */
export declare function isEngineType(value: unknown): value is EngineTypeDefinition;

/**
 * An engine failure whose message is safe to show to API callers. Other engine
 * errors are reported only as "the engine failed (see the logs for request X)".
 */
export declare class EngineError extends Error {
    readonly expose: true;
    constructor(message: string);
}

/** An engine instance that cannot be enabled. The message names the instance. */
export declare class EngineConfigError extends Error {
    constructor(message: string);
}

/** `text` with each secret value replaced by "[redacted]". */
export declare function redact(text: unknown, secrets: unknown[]): string;

/** An engine instance to enable. `name` is undefined until loading when only a package or definition was given. */
export type EngineInstanceSpec = {
    name?: string;
    type: string | EngineTypeDefinition;
    options?: Record<string, any>;
};

/** Parse a `UAG_ENGINES` string (`jev,fast:claude`) or a configuration list. Nothing named means none. */
export declare function parseInstances(source: string | (string | EngineInstanceSpec)[] | undefined | null): EngineInstanceSpec[];

/** The instances from configuration (`engines`) when it lists them, otherwise from `UAG_ENGINES`. */
export declare function engineInstances(config?: Record<string, any>, env?: Record<string, string | undefined>): EngineInstanceSpec[];

/** An instance's own variable for a setting: `UAG_ENGINE_<NAME>_<SETTING>`. */
export declare function settingVariable(instance: string, setting: string): string;

/** An instance's settings: options, then `UAG_ENGINE_<NAME>_<SETTING>`, then the type's variables, then the default. */
export declare function resolveSettings(definition: EngineTypeDefinition, name: string, options?: Record<string, any>, env?: Record<string, string | undefined>): Record<string, any>;

/**
 * The extraction schema with every field required, for strict structured
 * outputs, and `decode`, which maps an answer back to the UAG's schema.
 */
export declare function requiredSchema(schema: Record<string, any>): { schema: Record<string, any>; decode(values: unknown): Record<string, any> };

export declare function decodeValues(values: unknown, decoders: Record<string, (value: any) => any>): Record<string, any>;

/** The first JSON object in a model's text answer. Throws an `EngineError` when there is none. */
export declare function parseJsonObject(text: string): Record<string, any>;

/** A tool call's result as text for a model. */
export declare function toolResultText(result: { content?: { type: string; text?: string; [key: string]: any }[] }): string;
