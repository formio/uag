#!/usr/bin/env node
/**
 * Deletes what visitors left in the demo's project once it is older than
 * DEMO_RETENTION_HOURS (default 24): the submissions of the demo's forms, and
 * the guests themselves (the `guest` resource). Visitors type real-looking
 * personal details into the demos, so nothing they submit is kept for long.
 *
 *   FORMIO_PROJECT_URL=https://uag.form.io PROJECT_KEY=... node demo/scripts/retention.mjs
 *
 * The forms are the ones module/project.json defines, by their paths. Runs
 * hourly from .github/workflows/demo-retention.yml. Logs counts only, never a
 * submission. Exits non-zero when a form could not be purged.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROJECT_URL } from '../lib/config.mjs';

const BATCH = 100;
// At most this many batches per form and run: a backlog is cleared over several runs.
const MAX_ROUNDS = 50;

/** The paths of the forms and resources the demo's template defines. */
export function templatePaths() {
    const template = JSON.parse(readFileSync(fileURLToPath(new URL('../module/project.json', import.meta.url)), 'utf8'));
    return [...Object.values(template.forms || {}), ...Object.values(template.resources || {})].map((form) => form.path);
}

/**
 * Deletes every submission created before `hours` ago from each of `paths`.
 * Resolves to `{ deleted: { [path]: count }, failed: [path] }`.
 */
export async function purge({ projectUrl, key, hours = 24, paths = templatePaths(), fetch = globalThis.fetch, now = Date.now() }) {
    const base = projectUrl.replace(/\/+$/, '');
    const headers = { 'x-token': key };
    const cutoff = new Date(now - hours * 3_600_000).toISOString();
    const deleted = {};
    const failed = [];
    for (const path of paths) {
        deleted[path] = 0;
        try {
            for (let round = 0; round < MAX_ROUNDS; round++) {
                const listed = await fetch(`${base}/${path}/submission?created__lt=${encodeURIComponent(cutoff)}&limit=${BATCH}&select=_id`, { headers });
                if (!listed.ok) throw new Error(`listing answered ${listed.status}`);
                const old = await listed.json();
                if (!Array.isArray(old) || !old.length) break;
                for (const { _id } of old) {
                    const removed = await fetch(`${base}/${path}/submission/${_id}`, { method: 'DELETE', headers });
                    // Already gone (another run, or a guest deleted with its account) is fine.
                    if (!removed.ok && removed.status !== 404) throw new Error(`deleting answered ${removed.status}`);
                    deleted[path]++;
                }
                if (old.length < BATCH) break;
            }
        }
        catch (error) {
            console.error(`[demo-retention] ${path}: ${error.message}`);
            failed.push(path);
        }
    }
    return { deleted, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const env = process.env;
    if (!env.PROJECT_KEY) {
        console.error('[demo-retention] Set PROJECT_KEY to an API key of the project.');
        process.exit(1);
    }
    const hours = Number(env.DEMO_RETENTION_HOURS || 24);
    if (!(hours > 0)) {
        console.error('[demo-retention] DEMO_RETENTION_HOURS must be a number of hours above 0.');
        process.exit(1);
    }
    const { deleted, failed } = await purge({ projectUrl: env.FORMIO_PROJECT_URL || DEFAULT_PROJECT_URL, key: env.PROJECT_KEY, hours });
    for (const [path, count] of Object.entries(deleted)) console.log(`[demo-retention] ${path}: ${count} deleted`);
    process.exit(failed.length ? 1 : 0);
}
