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
 * - every dependency on a package in this repository accepts its version here.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';

const root = new URL('../', import.meta.url);
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

// A caret range on a package in this repository must accept the version here,
// or the published packages would not install together.
const versions = new Map(workspaces.map(({ pkg }) => [pkg.name, pkg.version]));
const parse = (version) => version.split('-')[0].split('.').map(Number);
for (const { dir, pkg } of packages) {
    for (const [name, spec] of Object.entries(pkg.dependencies || {})) {
        if (!versions.has(name)) continue;
        const match = /^\^(\d+\.\d+\.\d+)$/.exec(String(spec));
        const [have, want] = [parse(versions.get(name)), match && parse(match[1])];
        const accepts = want && have[0] === want[0] && (have[1] > want[1] || (have[1] === want[1] && have[2] >= want[2]));
        if (!accepts) {
            problems.push(`${dir}: depends on ${name} "${spec}", which does not accept ${versions.get(name)} in this repository.`);
        }
    }
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
