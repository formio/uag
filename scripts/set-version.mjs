#!/usr/bin/env node
/**
 * Sets one version on every package in this repository, which are released
 * together:
 *
 *   yarn release:version 2.0.0-rc.2
 *
 * - @formio/uag and every workspace (the engine SDK, the engines, the engine
 *   server, @formio/uag-js and the demo) take the version;
 * - each dependency on a package of this repository becomes `^<version>`, so the
 *   published packages install together (a prerelease range such as
 *   ^2.0.0-rc.2 accepts later prereleases of 2.0.0 and 2.0.0 itself);
 * - server.json (the MCP Registry entry) takes it too.
 *
 * Then rename CHANGELOG.md's newest heading to the version and run
 * `yarn install`; the release check (scripts/check-release.mjs) refuses a
 * release whose packages are out of step.
 *
 * UAG_RELEASE_ROOT sets another checkout (for the tests).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';

const root = process.env.UAG_RELEASE_ROOT ? pathToFileURL(`${process.env.UAG_RELEASE_ROOT.replace(/\/$/, '')}/`) : new URL('../', import.meta.url);
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version || '')) {
    console.error('Usage: yarn release:version <version>, such as 2.0.0 or 2.0.0-rc.2');
    process.exit(1);
}

const read = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const write = (path, json) => writeFileSync(new URL(path, root), `${JSON.stringify(json, null, 2)}\n`);

// The root and its workspaces: `dir/*` patterns name a folder of packages, others one package.
const files = ['package.json'];
for (const pattern of read('package.json').workspaces || []) {
    if (pattern.endsWith('/*')) {
        const base = pattern.slice(0, -2);
        for (const dir of readdirSync(new URL(`${base}/`, root))) {
            if (existsSync(new URL(`${base}/${dir}/package.json`, root))) files.push(`${base}/${dir}/package.json`);
        }
    }
    else if (existsSync(new URL(`${pattern}/package.json`, root))) {
        files.push(`${pattern}/package.json`);
    }
}

const packages = files.map((path) => ({ path, pkg: read(path) }));
const names = new Set(packages.map(({ pkg }) => pkg.name));
for (const { path, pkg } of packages) {
    pkg.version = version;
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of Object.keys(pkg[section] || {})) {
            if (names.has(name)) pkg[section][name] = `^${version}`;
        }
    }
    write(path, pkg);
    console.log(`${pkg.name}@${version}  (${path})`);
}

if (existsSync(new URL('server.json', root))) {
    const server = read('server.json');
    server.version = version;
    for (const entry of server.packages || []) entry.version = version;
    write('server.json', server);
    console.log(`server.json@${version}`);
}

console.log(`\nNow rename CHANGELOG.md's newest heading to "## ${version}" and run \`yarn install\`.`);
