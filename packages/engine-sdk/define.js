'use strict';

/** The engine contract version this SDK describes. */
const ENGINE_API_VERSION = 1;

/** Engine type and instance names: what `UAG_ENGINES` and routing lists use. */
const ENGINE_NAME = /^[a-z][a-z0-9-]{0,62}$/;

/** The plugin type of every engine definition. */
const ENGINE_PLUGIN_TYPE = 'engine';

/** The shape an engine definition takes, shown when one is in another shape. */
function definitionShape(name = 'acme') {
    return `{ type: 'engine', name: '${name}', title: '${name[0].toUpperCase()}${name.slice(1)}', version: '1.0.0', kinds, apiVersion, settings, create }`;
}

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
    if (definition.type !== ENGINE_PLUGIN_TYPE) {
        // The 2.0 release candidates put the engine's name in "type". The shape was
        // never in a final release, so it is refused rather than converted.
        if (typeof definition.type === 'string' && definition.name === undefined) {
            return [`it is in the shape of the 2.0 release candidates, { type: ${JSON.stringify(definition.type)}, kinds, ... }; ` +
                `an engine definition is now a plugin: ${definitionShape(ENGINE_NAME.test(definition.type) ? definition.type : 'acme')}`];
        }
        problems.push(`"type" must be "${ENGINE_PLUGIN_TYPE}"`);
    }
    if (typeof definition.name !== 'string' || !ENGINE_NAME.test(definition.name)) {
        problems.push('"name" must be a name of lowercase letters, digits and "-", starting with a letter');
    }
    if (definition.title !== undefined && (typeof definition.title !== 'string' || !definition.title)) {
        problems.push('"title" must be a non-empty string');
    }
    if (definition.version !== undefined && (typeof definition.version !== 'string' || !/^\d+\.\d+\.\d+/.test(definition.version))) {
        problems.push('"version" must be a semver string such as "1.0.0"');
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
 *       type: 'engine',
 *       name: 'acme',
 *       title: 'Acme',
 *       version: '1.0.0',     // optional: an engine package's own version is used
 *       kinds: ['agent'],
 *       apiVersion: ENGINE_API_VERSION,
 *       settings: { apiKey: { env: 'ACME_API_KEY', required: true, secret: true } },
 *       create({ name, settings }) { return { name, kind: 'agent', model: '...', extract }; },
 *   });
 */
function defineEngine(definition) {
    const problems = definitionProblems(definition);
    if (problems.length) {
        const name = definition && typeof definition.name === 'string' ? definition.name : definition && typeof definition.type === 'string' && definition.type !== ENGINE_PLUGIN_TYPE ? definition.type : '';
        throw new TypeError(`The engine type${name ? ` "${name}"` : ''} is not valid: ${problems.join('; ')}.`);
    }
    const settings = {};
    for (const [key, spec] of Object.entries(definition.settings || {})) {
        settings[key] = Object.freeze({ ...spec, ...(spec.env !== undefined && { env: Object.freeze([].concat(spec.env)) }) });
    }
    return Object.freeze({ ...definition, title: definition.title || definition.name, kinds: Object.freeze([...definition.kinds]), settings: Object.freeze(settings) });
}

/**
 * A valid definition with its defaults: `title` is its name, and `version` the
 * version of the package it was found in, when it does not give its own.
 */
function withDefaults(definition, packageVersion) {
    if (definition.title && (definition.version || !packageVersion)) return definition;
    const version = definition.version || packageVersion;
    return { ...definition, title: definition.title || definition.name, ...(version && { version }) };
}

module.exports = { ENGINE_API_VERSION, ENGINE_NAME, ENGINE_PLUGIN_TYPE, KINDS, defineEngine, definitionProblems, definitionShape, isEngineType, withDefaults };
