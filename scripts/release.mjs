#!/usr/bin/env node
/**
 * Prepares a release on the current branch, so the only step left is pushing it:
 *
 *   yarn release 2.0.0-rc.2           # prepare, commit and tag; prints the push command
 *   yarn release 2.0.0-rc.2 --push    # and push the branch and the tag, which starts CI
 *
 * In order: refuses a working tree with uncommitted changes, or a tag that
 * already exists here or on origin; sets the version on every package
 * (scripts/set-version.mjs); names CHANGELOG.md's newest entry for it
 * (scripts/changelog.mjs); updates the lockfile, builds and runs the tests
 * (--skip-tests skips them); runs the release check; commits "Update
 * versions." and tags v<version>. See RELEASING.md.
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { changelogFor } from './changelog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const version = args.find((arg) => !arg.startsWith('--'));
const push = args.includes('--push');
const skipTests = args.includes('--skip-tests');

function fail(message) {
    console.error(`[release] ${message}`);
    process.exit(1);
}

const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
const read = (command, commandArgs) => execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).trim();

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version || '')) {
    fail('Usage: yarn release <version> [--push] [--skip-tests], such as 2.0.0-rc.2 or 2.0.0');
}
const tag = `v${version}`;

// Only the release's own changes go into its commit.
if (read('git', ['status', '--porcelain', '--untracked-files=no'])) fail('Commit or stash your changes first.');
const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === 'HEAD') fail('Check out a branch first; the release is committed to it.');
if (read('git', ['tag', '--list', tag])) fail(`The tag ${tag} already exists here.`);
if (read('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) fail(`The tag ${tag} already exists on origin.`);

// Checked before anything changes, so a changelog that needs notes stops the release early.
const changelogPath = `${root}CHANGELOG.md`;
let changelog;
try {
    changelog = changelogFor(readFileSync(changelogPath, 'utf8'), version);
}
catch (err) {
    fail(err.message);
}

try {
    console.log(`[release] ${version} on ${branch}`);
    run(process.execPath, ['scripts/set-version.mjs', version]);
    writeFileSync(changelogPath, changelog);
    run('yarn', ['install']);
    run('yarn', ['build']);
    if (!skipTests) run('yarn', ['test']);
    run(process.execPath, ['scripts/check-release.mjs', '--before-publish']);
}
catch {
    fail('Stopped. Nothing is committed; `git checkout -- .` undoes the version changes.');
}

run('git', ['commit', '-a', '-q', '-m', 'Update versions.']);
run('git', ['tag', tag]);
console.log(`[release] Committed "Update versions." and tagged ${tag}.`);

if (push) {
    run('git', ['push', 'origin', branch]);
    run('git', ['push', 'origin', tag]);
    console.log(`[release] Pushed ${branch} and ${tag}; the publish workflow is running.`);
}
else {
    console.log(`[release] To publish it: git push origin ${branch} && git push origin ${tag}`);
}
