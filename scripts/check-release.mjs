#!/usr/bin/env node
/**
 * Checks the UAG and its engine packages before any of them is published:
 *
 * - no dependency points at a local folder (such as a temporary `file:` link
 *   to an unpublished @formio/appserver-core build), which cannot be installed;
 * - every published package is MIT;
 * - @formio/uag depends on no model provider SDK and on no engine package, so
 *   engines stay optional and separately installable;
 * - each engine pins its provider SDK to an exact version, so a provider's
 *   release cannot change an engine's behavior without a new engine release
 *   (official @formio/uag-* packages, such as the OpenAI engine the Grok,
 *   Gemini and MAI engines build on, take a caret range);
 * - every package of this repository is at @formio/uag's version (they are
 *   released together; `yarn release:version <version>` sets it everywhere);
 * - every dependency on a package in this repository accepts its version here;
 * - @formio/uag's version is the one CHANGELOG.md's newest entry describes;
 * - the packages of this repository that @formio/uag depends on are published
 *   at a version its range accepts (publish them first);
 * - lib/ is built from the current src/ (run `yarn build`).
 *
 * UAG_RELEASE_ROOT checks another checkout (for the tests).
 */
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { pathToFileURL } from 'url';

const root = process.env.UAG_RELEASE_ROOT ? pathToFileURL(`${process.env.UAG_RELEASE_ROOT.replace(/\/$/, '')}/`) : new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

const uag = read('package.json');
const workspaces = [];
for (const pattern of uag.workspaces || []) {
    const base = pattern.replace(/\/\*$/, '');
    for (const dir of readdirSync(new URL(`${base}/`, root))) {
        if (existsSync(new URL(`${base}/${dir}/package.json`, root))) {
            workspaces.push({ dir: `${base}/${dir}`, pkg: read(`${base}/${dir}/package.json`) });
        }
    }
}
const packages = [{ dir: '.', pkg: uag }, ...workspaces];
const problems = [];

const local = /^(file|portal|link|workspace):/;
for (const { dir, pkg } of packages) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'resolutions']) {
        for (const [name, spec] of Object.entries(pkg[section] || {})) {
            if (local.test(String(spec))) problems.push(`${dir}: ${section}["${name}"] = "${spec}" points at a local folder.`);
        }
    }
    if (!pkg.private && pkg.license !== 'MIT') {
        problems.push(`${dir}: ${pkg.name} is licensed "${pkg.license}", not MIT.`);
    }
}

const modelSdk = /anthropic|openai|typesafe|google-ai|generative-ai|mistral|cohere|ollama/i;
for (const name of Object.keys(uag.dependencies || {})) {
    if (modelSdk.test(name)) problems.push(`@formio/uag depends on the model SDK ${name}; only engine packages may.`);
    if (/^@formio\/uag-/.test(name) && name !== '@formio/uag-sdk') problems.push(`@formio/uag depends on ${name}; engines must stay optional.`);
}

const exact = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
for (const { dir, pkg } of workspaces.filter(({ dir }) => dir.startsWith('engines/'))) {
    for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
        if (!name.startsWith('@formio/uag-') && !exact.test(String(spec))) {
            problems.push(`${dir}: ${name} is "${spec}"; pin provider SDKs to an exact version.`);
        }
    }
}

// The packages of this repository are released together, at one version.
for (const { dir, pkg } of workspaces) {
    if (pkg.version !== uag.version) {
        problems.push(`${dir}: ${pkg.name} is version ${pkg.version}, not ${uag.version}. Run \`yarn release:version ${uag.version}\`.`);
    }
}

// A caret range on a package in this repository must accept the version here,
// or the published packages would not install together.
const versions = new Map(workspaces.map(({ pkg }) => [pkg.name, pkg.version]));
const parse = (version) => {
    const [core, ...pre] = version.split('-');
    return { nums: core.split('.').map(Number), pre: pre.length ? pre.join('-').split('.') : [] };
};
// Semver precedence: numbers first, then a release above its prereleases, then
// prerelease identifiers in order (numeric ones as numbers, below text ones).
const compare = (a, b) => {
    for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
    if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const [x, y] = [a.pre[i], b.pre[i]];
        if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
        if (x === y) continue;
        const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
        if (nx && ny) return Number(x) - Number(y);
        if (nx !== ny) return nx ? -1 : 1;
        return x < y ? -1 : 1;
    }
    return 0;
};
for (const { dir, pkg } of packages) {
    for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
        if (!versions.has(name)) continue;
        const match = /^\^(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(String(spec));
        const [have, want] = [parse(versions.get(name)), match && parse(match[1])];
        // As npm resolves a caret range: the same major, no lower, and a prerelease
        // only when the range names a prerelease of the same version.
        const accepts = want && have.nums[0] === want.nums[0] && compare(have, want) >= 0
            && (!have.pre.length || (want.pre.length > 0 && have.nums.every((n, i) => n === want.nums[i])));
        if (!accepts) {
            problems.push(`${dir}: depends on ${name} "${spec}", which does not accept ${versions.get(name)} in this repository.`);
        }
    }
}

// The version must be the one the changelog's newest entry describes.
try {
    const newest = /^## \[?v?(\d+\.\d+\.\d+[^\]\s]*)/m.exec(readFileSync(new URL('CHANGELOG.md', root), 'utf8'));
    if (newest && newest[1] !== uag.version) {
        problems.push(`package.json is version ${uag.version}, but CHANGELOG.md's newest entry is ${newest[1]}. Update the version.`);
    }
}
catch {
    // No changelog: nothing to compare.
}

// The packages of this repository @formio/uag depends on must be on npm first.
for (const [name, spec] of Object.entries(uag.dependencies || {})) {
    if (!versions.has(name)) continue;
    let found;
    try {
        const out = execFileSync('npm', ['view', `${name}@${spec}`, 'version', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        found = out ? [].concat(JSON.parse(out)) : [];
    }
    catch (err) {
        if (!/E404|404 Not Found/.test(String(err?.stderr || err?.message))) {
            problems.push(`could not ask npm whether ${name}@${spec} is published (${String(err?.stderr || err?.message).trim().split('\n')[0]}).`);
            continue;
        }
        found = [];
    }
    if (!found.length) problems.push(`${name}@${spec} is not published on npm. Publish ${name} first.`);
}

// lib/ must be built from the current src/.
const stale = [];
const walk = (dir) => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
        const path = `${dir}${entry.name}`;
        if (entry.isDirectory()) {
            walk(`${path}/`);
            continue;
        }
        const built = /\.ts$/.test(path) && !/\.d\.ts$/.test(path) ? path.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js')
            : /^src\/templates\/.*\.md$/.test(path) ? path.replace(/^src\//, 'lib/') : null;
        if (!built) continue;
        const target = new URL(built, root);
        if (!existsSync(target) || statSync(target).mtimeMs < statSync(new URL(path, root)).mtimeMs) stale.push(path);
    }
};
if (existsSync(new URL('src/', root))) walk('src/');
if (stale.length) {
    problems.push(`lib/ is not built from the current src/ (${stale.slice(0, 3).join(', ')}${stale.length > 3 ? `, and ${stale.length - 3} more` : ''}). Run \`yarn build\`.`);
}

let lock = '';
try {
    lock = readFileSync(new URL('yarn.lock', root), 'utf8');
}
catch {
    // No lockfile: nothing more to check.
}
for (const match of lock.matchAll(/^"?(@?[^@\s"]+)@(?:npm:)?(file|portal|link):[^\n]*$/gm)) {
    problems.push(`yarn.lock: ${match[0].replace(/:$/, '')} points at a local folder.`);
}

if (problems.length) {
    console.error(`Refusing to publish:\n  ${problems.join('\n  ')}`);
    process.exit(1);
}
const listed = (list) => list.map(({ pkg }) => `${pkg.name}@${pkg.version}`).join(', ');
const unreleased = packages.filter(({ pkg }) => pkg.private);
console.log(`release check passed (${listed(packages.filter(({ pkg }) => !pkg.private))})${unreleased.length ? `; not published: ${listed(unreleased)}` : ''}`);
