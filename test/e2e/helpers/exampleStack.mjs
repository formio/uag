import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '../../..');
export const IMAGE = 'formio/uag:e2e-local';

let imageBuild;

/** Builds this tree as `formio/uag:e2e-local`, once per test run. */
export function buildLocalImage() {
    imageBuild ||= exec('docker', ['build', '-t', IMAGE, repoRoot], { timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });
    return imageBuild;
}

/**
 * Runs an example's own docker-compose.yml for the layer 3 suites, under its
 * own Compose project name, so a copy of the example already running on this
 * machine is left alone.
 *
 * - `dir` is the example's folder (or a copy of it); its relative paths resolve
 *   from there.
 * - `env` is written to an env file passed with `--env-file`, so the example's
 *   own `.env` is never read. Pass `envFile` to use a file the caller manages.
 * - `files` are more Compose files from `dir`, added after docker-compose.yml.
 * - `override` is a Compose override (YAML), which should change only the
 *   UAG's image, the published ports and the container names. Use `!override`
 *   for ports, which Compose otherwise merges.
 */
export async function exampleStack({ project, dir, env = {}, envFile, files = [], override }) {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), `${project}-`));
    envFile ||= path.join(work, '.env');
    if (Object.keys(env).length) {
        // Single quotes keep values literal: Compose does not interpolate them.
        const lines = Object.entries(env).map(([name, value]) => `${name}='${value}'`);
        await fs.writeFile(envFile, `${lines.join('\n')}\n`, { mode: 0o600 });
    }
    const overrideFile = path.join(work, 'e2e.override.yml');
    await fs.writeFile(overrideFile, override);

    const compose = (...args) => exec('docker', [
        'compose', '-p', project, '--project-directory', dir, '--env-file', envFile,
        '-f', path.join(dir, 'docker-compose.yml'), ...files.flatMap((file) => ['-f', path.join(dir, file)]), '-f', overrideFile, ...args,
    ], { cwd: dir, timeout: 600000, maxBuffer: 16 * 1024 * 1024 });

    return {
        compose,
        envFile,
        /** The last lines a service logged, for failure messages. */
        async logs(service, lines = 80) {
            return (await compose('logs', '--tail', String(lines), service).catch((error) => error)).stdout || '';
        },
        /** Tears the stack down, volumes included. */
        async down() {
            await compose('down', '-v').catch((error) => console.log(`    Teardown of ${project} failed: ${error.message}`));
            await fs.rm(work, { recursive: true, force: true });
        },
    };
}

/** Polls `check` until it resolves, or throws what `describe()` says after `timeoutMs`. */
export async function waitUntil(check, { timeoutMs = 180000, intervalMs = 2000, describe = async () => '' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            return await check();
        }
        catch (error) {
            last = error;
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }
    throw new Error(`${last?.message || 'Timed out'}\n${await describe()}`);
}
