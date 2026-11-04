import type { FeatureSettings } from './types';

/** A value from the environment, as the default's type. Undefined when it is not one. */
function fromEnv(raw: string, fallback: unknown): string | number | boolean | undefined {
    const value = raw.trim();
    if (typeof fallback === 'number') {
        const number = Number(value);
        return value !== '' && Number.isFinite(number) ? number : undefined;
    }
    if (typeof fallback === 'boolean') {
        if (/^(true|1|yes|on)$/i.test(value)) return true;
        if (/^(false|0|no|off)$/i.test(value)) return false;
        return undefined;
    }
    return value;
}

/**
 * A feature's settings: each from `config[key]`, then its environment
 * variable, then its default. Problems (a value the environment cannot give
 * as the default's type, or what `validate` reports) are returned, naming the
 * setting; the caller stops startup with them.
 */
export function resolveFeatureSettings(
    declared: FeatureSettings | undefined,
    config: Record<string, any> = {},
    env: Record<string, string | undefined> = process.env
): { settings: Record<string, any>; problems: string[] } {
    if (!declared) return { settings: {}, problems: [] };
    const section = config?.[declared.key] && typeof config[declared.key] === 'object' ? config[declared.key] : {};
    const settings: Record<string, any> = { ...section };
    const problems: string[] = [];
    for (const [name, fallback] of Object.entries(declared.defaults || {})) {
        if (section[name] !== undefined && section[name] !== null && section[name] !== '') {
            settings[name] = section[name];
            continue;
        }
        const variable = declared.env?.[name];
        const raw = variable ? env[variable] : undefined;
        if (raw !== undefined && raw.trim() !== '') {
            const value = fromEnv(raw, fallback);
            if (value === undefined) {
                problems.push(`${name}: ${variable} must be a ${typeof fallback}`);
                settings[name] = fallback;
            }
            else {
                settings[name] = value;
            }
            continue;
        }
        settings[name] = fallback;
    }
    if (!problems.length && typeof declared.validate === 'function') {
        problems.push(...(declared.validate(settings) || []));
    }
    return { settings, problems };
}
