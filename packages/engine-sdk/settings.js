'use strict';
const { EngineConfigError } = require('./errors');

/** `apiKey` → `API_KEY`, `baseURL` → `BASE_URL`, `fast-lane` → `FAST_LANE`. */
function upperSnake(name) {
    return String(name)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
        .replace(/-/g, '_')
        .toUpperCase();
}

/** The instance's own variable for a setting: `UAG_ENGINE_<NAME>_<SETTING>`. */
function settingVariable(instance, setting) {
    return `UAG_ENGINE_${upperSnake(instance)}_${upperSnake(setting)}`;
}

/**
 * The variables that set a setting, in the order they are read. `env` may be one
 * name or a list: definitions not made with `defineEngine` are not normalised.
 */
function settingVariables(instance, setting, spec) {
    return [settingVariable(instance, setting), ...[].concat(spec.env || [])];
}

function given(value) {
    return value !== undefined && value !== null && value !== '';
}

function listNames(names) {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
}

/** Coerce a value read from the environment (always a string) to the setting's type. */
function coerce(value, spec, describe) {
    const type = spec.type || 'string';
    if (type === 'number') {
        const number = typeof value === 'number' ? value : Number(String(value).trim());
        if (String(value).trim() === '' || !Number.isFinite(number)) {
            throw new EngineConfigError(`${describe()} must be a number${spec.secret ? '' : `, not ${JSON.stringify(value)}`}.`);
        }
        return number;
    }
    if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        const text = String(value).trim().toLowerCase();
        if (['true', '1', 'yes'].includes(text)) return true;
        if (['false', '0', 'no'].includes(text)) return false;
        throw new EngineConfigError(`${describe()} must be true or false${spec.secret ? '' : `, not ${JSON.stringify(value)}`}.`);
    }
    return typeof value === 'string' ? value : String(value);
}

/**
 * An instance's value for each setting its type declares, from the first of:
 * the instance's options, `UAG_ENGINE_<NAME>_<SETTING>`, the type's own
 * variables, and the default. A required setting with no value is an error
 * naming the instance, the type, the setting and every variable that sets it.
 */
function resolveSettings(definition, name, options = {}, env = process.env) {
    const settings = {};
    for (const [key, spec] of Object.entries(definition.settings || {})) {
        const describe = () => `The "${name}" engine's ${key} setting`;
        let value = options[key];
        if (!given(value)) {
            const variable = settingVariables(name, key, spec).find((candidate) => given(env[candidate]));
            value = variable ? env[variable] : spec.default;
        }
        if (!given(value)) {
            if (spec.required) {
                throw missingSetting(definition, name, key);
            }
            continue;
        }
        settings[key] = coerce(value, spec, describe);
    }
    return settings;
}

/** The error for a required setting with no value. */
function missingSetting(definition, name, key) {
    const spec = (definition.settings || {})[key] || {};
    return new EngineConfigError(
        `The "${name}" engine (type "${definition.type}") needs its ${key} setting: set ${listNames(settingVariables(name, key, spec))}.`
    );
}

/** The resolved values of the settings a type marks secret. */
function secretValues(definition, settings, options = {}) {
    const secrets = [];
    for (const [key, spec] of Object.entries(definition.settings || {})) {
        if (!spec.secret) continue;
        if (given(settings[key])) secrets.push(settings[key]);
        if (given(options[key])) secrets.push(options[key]);
    }
    return secrets;
}

module.exports = { upperSnake, settingVariable, settingVariables, resolveSettings, missingSetting, secretValues };
