'use strict';
const { ENGINE_NAME } = require('./define');
const { EngineConfigError } = require('./errors');

/**
 * npm package names, scoped or not. Every segment starts with a letter or digit,
 * so "." and ".." (and so any relative path) can never match.
 */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const MAX_PACKAGE_NAME = 214;

/**
 * Whether a type is given as a package name rather than a type name: scoped
 * (`@acme/uag-engine-x`), or unscoped with the conventional prefix (`uag-engine-x`).
 */
function isPackageName(type) {
    return type.startsWith('@') || type.includes('/') || type.startsWith('uag-engine-');
}

/** Refuse a type that is neither a type name nor a package name, before any lookup. */
function checkType(type) {
    const valid = isPackageName(type)
        ? PACKAGE_NAME.test(type) && type.length <= MAX_PACKAGE_NAME
        : ENGINE_NAME.test(type);
    if (!valid) {
        throw new EngineConfigError(
            `The engine type name ${JSON.stringify(type)} is not valid. Use a type name such as "claude", ` +
            'or a package name such as "@acme/uag-engine-x" or "uag-engine-x".'
        );
    }
}

function checkName(name) {
    if (!ENGINE_NAME.test(name)) {
        throw new EngineConfigError(
            `The engine name ${JSON.stringify(name)} is not valid: use lowercase letters, digits and "-", ` +
            'starting with a letter, up to 63 characters.'
        );
    }
}

/** Refuse two instances with the same name. Instances without a name yet are skipped. */
function checkUnique(instances) {
    const seen = new Set();
    for (const { name } of instances) {
        if (!name) continue;
        if (seen.has(name)) {
            throw new EngineConfigError(`Two engines are named "${name}". Engine instance names must be unique.`);
        }
        seen.add(name);
    }
}

/** One `UAG_ENGINES` entry: `<type>` or `<name>:<type>`. */
function parseEntry(entry) {
    const colon = entry.indexOf(':');
    const name = colon === -1 ? undefined : entry.slice(0, colon).trim();
    const type = colon === -1 ? entry : entry.slice(colon + 1).trim();
    if (name !== undefined) checkName(name);
    checkType(type);
    // A bare package name takes its type's name, which is known once it loads.
    return { name: name ?? (isPackageName(type) ? undefined : type), type, options: {} };
}

/** One configuration entry: a `UAG_ENGINES` string, or `{ name, type, options }`. */
function parseConfigured(entry) {
    if (typeof entry === 'string') {
        return parseEntry(entry.trim());
    }
    if (!entry || typeof entry !== 'object') {
        throw new EngineConfigError(`An engine entry must be a string or { name, type, options }, not ${JSON.stringify(entry)}.`);
    }
    const { name, type, options = {} } = entry;
    if (name !== undefined) checkName(name);
    if (typeof type === 'string') {
        checkType(type);
    }
    else if (!type || typeof type !== 'object') {
        throw new EngineConfigError(`The engine${name ? ` "${name}"` : ''} needs a type: a type name, a package name, or an engine type definition.`);
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new EngineConfigError(`The options of the engine${name ? ` "${name}"` : ''} must be an object.`);
    }
    const named = name ?? (typeof type === 'string' ? (isPackageName(type) ? undefined : type) : undefined);
    return { name: named, type, options };
}

/**
 * The engine instances in a `UAG_ENGINES` string or a configuration list. Each
 * is `{ name, type, options }`; `name` is undefined until the type is known when
 * the entry names only a package or a definition. Nothing named means none.
 */
function parseInstances(source) {
    if (source === undefined || source === null) return [];
    let entries;
    if (typeof source === 'string') {
        entries = source.split(',').map((entry) => entry.trim()).filter(Boolean).map(parseEntry);
    }
    else if (Array.isArray(source)) {
        entries = source.filter((entry) => entry !== '').map(parseConfigured);
    }
    else {
        throw new EngineConfigError('The engine list must be a comma-separated string or an array.');
    }
    checkUnique(entries);
    return entries;
}

/**
 * The instances to enable: from configuration (`engines`) when it lists them,
 * otherwise from `UAG_ENGINES`. Configuration takes precedence.
 */
function engineInstances(config = {}, env = process.env) {
    return parseInstances(Array.isArray(config && config.engines) ? config.engines : env.UAG_ENGINES);
}

module.exports = { PACKAGE_NAME, isPackageName, checkName, checkType, checkUnique, parseInstances, engineInstances };
