'use strict';

/** The engine contract version this SDK describes. */
const ENGINE_API_VERSION = 1;

/** Engine type and instance names: what `UAG_ENGINES` and routing lists use. */
const ENGINE_NAME = /^[a-z][a-z0-9-]{0,62}$/;

const KINDS = ['decision', 'agent'];
const SETTING_NAME = /^[a-z][a-zA-Z0-9]*$/;
const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const SETTING_TYPES = ['string', 'number', 'boolean'];
const SETTING_KEYS = ['env', 'required', 'secret', 'default', 'type', 'description'];

/** The reasons a value is not a valid engine type definition; empty when it is. */
function definitionProblems(definition) {
    if (!definition || typeof definition !== 'object') {
        return ['it is not an object'];
    }
    const problems = [];
    if (typeof definition.type !== 'string' || !ENGINE_NAME.test(definition.type)) {
        problems.push('"type" must be a name of lowercase letters, digits and "-", starting with a letter');
    }
    if (!Array.isArray(definition.kinds) || !definition.kinds.length || !definition.kinds.every((kind) => KINDS.includes(kind))) {
        problems.push('"kinds" must list "decision", "agent" or both');
    }
    if (!Number.isInteger(definition.apiVersion) || definition.apiVersion < 1) {
        problems.push('"apiVersion" must be the engine contract version it was built for');
    }
    if (typeof definition.create !== 'function') {
        problems.push('"create" must be a function');
    }
    const settings = definition.settings === undefined ? {} : definition.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        problems.push('"settings" must be an object');
    }
    else {
        for (const [key, spec] of Object.entries(settings)) {
            problems.push(...settingProblems(key, spec));
        }
    }
    return problems;
}

function settingProblems(key, spec) {
    const label = `setting "${key}"`;
    if (!SETTING_NAME.test(key)) {
        return [`${label} must be a camelCase name`];
    }
    if (!spec || typeof spec !== 'object') {
        return [`${label} must be an object`];
    }
    const problems = [];
    const unknown = Object.keys(spec).filter((name) => !SETTING_KEYS.includes(name));
    if (unknown.length) {
        problems.push(`${label} has unknown keys: ${unknown.join(', ')}`);
    }
    const env = spec.env === undefined ? [] : [].concat(spec.env);
    if (!env.every((name) => typeof name === 'string' && VARIABLE_NAME.test(name))) {
        problems.push(`${label}: "env" must name upper-case environment variables`);
    }
    if (spec.type !== undefined && !SETTING_TYPES.includes(spec.type)) {
        problems.push(`${label}: "type" must be one of ${SETTING_TYPES.join(', ')}`);
    }
    for (const flag of ['required', 'secret']) {
        if (spec[flag] !== undefined && typeof spec[flag] !== 'boolean') {
            problems.push(`${label}: "${flag}" must be true or false`);
        }
    }
    if (spec.default !== undefined && typeof spec.default !== (spec.type || 'string')) {
        problems.push(`${label}: "default" must be a ${spec.type || 'string'}`);
    }
    return problems;
}

/** Whether a value is a valid engine type definition, from this SDK or any other copy of it. */
function isEngineType(value) {
    return definitionProblems(value).length === 0;
}

/**
 * Define an engine type. Validates the definition and returns it frozen, so a
 * mistake in it fails when the package loads rather than when the UAG starts:
 *
 *   module.exports = defineEngine({
 *       type: 'acme',
 *       kinds: ['agent'],
 *       apiVersion: ENGINE_API_VERSION,
 *       settings: { apiKey: { env: 'ACME_API_KEY', required: true, secret: true } },
 *       create({ name, settings }) { return { name, kind: 'agent', model: '...', extract }; },
 *   });
 */
function defineEngine(definition) {
    const problems = definitionProblems(definition);
    if (problems.length) {
        const type = definition && typeof definition.type === 'string' ? ` "${definition.type}"` : '';
        throw new TypeError(`The engine type${type} is not valid: ${problems.join('; ')}.`);
    }
    const settings = {};
    for (const [key, spec] of Object.entries(definition.settings || {})) {
        settings[key] = Object.freeze({ ...spec, ...(spec.env !== undefined && { env: Object.freeze([].concat(spec.env)) }) });
    }
    return Object.freeze({ ...definition, kinds: Object.freeze([...definition.kinds]), settings: Object.freeze(settings) });
}

module.exports = { ENGINE_API_VERSION, ENGINE_NAME, KINDS, defineEngine, definitionProblems, isEngineType };
