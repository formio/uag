'use strict';
const fs = require('fs');
const path = require('path');
const { ENGINE_API_VERSION, definitionProblems } = require('./define');
const { EngineConfigError, redact } = require('./errors');
const { checkName, checkType, checkUnique, isPackageName } = require('./instances');
const { missingSetting, resolveSettings, secretValues, settingVariable } = require('./settings');

/**
 * Finding, configuring and creating engine instances. The UAG, `uag-eval` and
 * the engine server all load engines here, so one configuration means the same
 * engines in each.
 */

/**
 * The directories whose `node_modules` engine packages are looked up in: the
 * host's own installation and each directory above it (where Node finds the
 * host's own dependencies, so engines installed beside the host are found),
 * then each absolute directory in `UAG_ENGINE_PATH`, without the directories
 * above it. Never the working directory, `NODE_PATH` or Node's global folders.
 */
function enginePaths(root, env = process.env) {
    const extra = String(env.UAG_ENGINE_PATH || '').split(path.delimiter).map((dir) => dir.trim()).filter(Boolean);
    for (const dir of extra) {
        if (!path.isAbsolute(dir)) {
            throw new EngineConfigError(`UAG_ENGINE_PATH must list absolute directories; "${dir}" is relative.`);
        }
    }
    const host = [];
    for (let dir = root && path.resolve(root); dir; ) {
        // As Node does, never look for node_modules/node_modules.
        if (path.basename(dir) !== 'node_modules') host.push(dir);
        const parent = path.dirname(dir);
        dir = parent === dir ? undefined : parent;
    }
    return [...host, ...extra];
}

/** The packages a type name may come from, in order. */
function packageCandidates(type) {
    return isPackageName(type) ? [type] : [`@formio/uag-${type}`, `uag-engine-${type}`];
}

/** Whether `file` is `dir` or inside it. */
function isInside(file, dir) {
    const relative = path.relative(dir, file);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Find `name` in `<dir>/node_modules` of the first of `paths` that has it, and
 * nowhere else: not in the directories above, `NODE_PATH` or Node's global
 * folders, which `require.resolve` would also search. Returns its entry file
 * and package.json, or undefined when no path has it.
 */
function findPackage(name, paths) {
    for (const dir of paths) {
        const packageDir = path.join(dir, 'node_modules', ...name.split('/'));
        const manifest = path.join(packageDir, 'package.json');
        if (!fs.existsSync(manifest)) continue;
        let json;
        try {
            json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        }
        catch (err) {
            throw new EngineConfigError(`The package "${name}" has an unreadable package.json (${manifest}): ${err && err.message}`);
        }
        let entry;
        try {
            entry = require.resolve(name, { paths: [dir] });
        }
        catch (err) {
            throw new EngineConfigError(`The package "${name}" (${packageDir}) has no entry point that require() can load: ${err && (err.code || err.message)}.`);
        }
        // A broken package must not fall through to a copy found elsewhere.
        // Real paths, so a linked workspace package is still its own.
        if (!isInside(fs.realpathSync(entry), fs.realpathSync(packageDir))) {
            throw new EngineConfigError(`The package "${name}" in ${packageDir} resolved to ${entry}, outside it; it was not loaded.`);
        }
        return { entry, json };
    }
    return undefined;
}

/** The message of anything thrown, including a string. */
function errorText(err) {
    return err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
}

/** Check a definition, from this SDK, another copy of it, or none. */
function checkDefinition(definition, source, apiVersion) {
    const problems = definitionProblems(definition);
    if (problems.length) {
        throw new EngineConfigError(`${source} is not a UAG engine: it does not export a valid engine type definition (${problems.join('; ')}).`);
    }
    if (definition.apiVersion !== apiVersion) {
        throw new EngineConfigError(
            `${source} (engine type "${definition.type}") was built for engine API version ${definition.apiVersion}; ` +
            `this server supports version ${apiVersion}.`
        );
    }
    return definition;
}

/**
 * The definition for an instance's type: a definition given directly, a type in
 * `types` (built-in, or passed by the embedding application), then the packages
 * `@formio/uag-<type>` and `uag-engine-<type>`, or the package named.
 * Returns the package's name and version when it came from one.
 */
function resolveType(type, { types = {}, paths = [], apiVersion = ENGINE_API_VERSION } = {}) {
    if (type && typeof type === 'object') {
        return { definition: checkDefinition(type, 'The engine type given in configuration', apiVersion) };
    }
    checkType(type);
    if (!isPackageName(type) && Object.prototype.hasOwnProperty.call(types, type)) {
        return { definition: checkDefinition(types[type], `The built-in engine type "${type}"`, apiVersion) };
    }
    const candidates = packageCandidates(type);
    for (const candidate of candidates) {
        const found = findPackage(candidate, paths);
        if (!found) continue;
        const { entry, json: pkg } = found;
        let exported;
        try {
            exported = require(entry);
        }
        catch (err) {
            throw new EngineConfigError(`The package "${candidate}" failed to load: ${errorText(err)}`);
        }
        const definition = exported && exported.__esModule && exported.default ? exported.default : exported;
        return {
            definition: checkDefinition(definition, `The package "${candidate}"`, apiVersion),
            package: candidate,
            ...(pkg.version && { version: pkg.version })
        };
    }
    const known = Object.keys(types);
    throw new EngineConfigError(
        `No engine type "${type}" is installed. Looked for ${candidates.map((name) => `"${name}"`).join(' and ')}. ` +
        `Install one (npm install ${candidates[0]}), or add a directory that contains it to UAG_ENGINE_PATH.` +
        (known.length ? ` Types available without installing: ${known.join(', ')}.` : '')
    );
}

/** Refuse two instance settings that would read the same `UAG_ENGINE_*` variable. */
function checkVariables(resolved) {
    const owners = new Map();
    for (const { name, definition } of resolved) {
        for (const key of Object.keys(definition.settings || {})) {
            const variable = settingVariable(name, key);
            const owner = owners.get(variable);
            if (owner && owner.name !== name) {
                throw new EngineConfigError(
                    `The engines "${owner.name}" and "${name}" would both read ${variable} (for ${owner.key} and ${key}). Rename one of them.`
                );
            }
            owners.set(variable, { name, key });
        }
    }
}

/**
 * Create one engine from its definition, for an instance name and options.
 * Errors name the instance and its type, and never contain a secret setting.
 */
async function createEngine(definition, { name, options = {}, env = process.env, config = {} }) {
    const label = `The "${name}" engine (type "${definition.type}")`;
    const settings = resolveSettings(definition, name, options, env);
    const secrets = secretValues(definition, settings, options);
    let engine;
    try {
        engine = await definition.create({
            name,
            settings,
            options,
            config,
            requireSetting: (key) => {
                if (settings[key] === undefined) throw missingSetting(definition, name, key);
                return settings[key];
            },
        });
    }
    catch (err) {
        const message = redact(errorText(err), secrets);
        throw new EngineConfigError(err instanceof EngineConfigError || (err && err.name === 'EngineConfigError') ? message : `${label} failed to start: ${message}`);
    }
    if (!engine || typeof engine !== 'object') {
        throw new EngineConfigError(`${label} did not create an engine.`);
    }
    if (engine.name !== name) {
        throw new EngineConfigError(`${label} created an engine named ${JSON.stringify(engine.name)}; it must use the instance name.`);
    }
    if (!definition.kinds.includes(engine.kind)) {
        throw new EngineConfigError(`${label} created a ${JSON.stringify(engine.kind)} engine; its type declares ${definition.kinds.join(' and ')}.`);
    }
    return engine;
}

/**
 * Load the given instances (from `parseInstances` or `engineInstances`): resolve
 * each type, resolve its settings, and create the engine. Returns
 * `{ engine, type, package, version }` for each, in order, ready for
 * `Formflow.engineRegistry`. Any problem stops loading with the instance named.
 */
async function loadEngines(instances, { types = {}, paths = [], env = process.env, config = {}, apiVersion = ENGINE_API_VERSION } = {}) {
    const resolved = instances.map((instance) => {
        const found = resolveType(instance.type, { types, paths, apiVersion });
        const name = instance.name || found.definition.type;
        checkName(name);
        return { ...found, name, options: instance.options || {} };
    });
    checkUnique(resolved);
    checkVariables(resolved);
    const loaded = [];
    for (const { definition, name, options, package: pkg, version } of resolved) {
        const engine = await createEngine(definition, { name, options, env, config });
        loaded.push({ engine, type: definition.type, ...(pkg && { package: pkg }), ...(version && { version }) });
    }
    return loaded;
}

module.exports = { enginePaths, packageCandidates, resolveType, createEngine, loadEngines };
