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

/**
 * The Dockerfile, with `@formio/appserver-core` and `@formio/appserver` taken
 * from local builds instead of the registry: E2E_LOCAL_CORE (appserver-core's
 * `build/` folder) and E2E_LOCAL_APPSERVER (the appserver repository, built), to
 * check this tree against unpublished versions of both. They are copied over
 * the installed packages before the UAG is compiled, and again in the image,
 * since installing the production dependencies links the packages anew.
 */
async function localPackagesDockerfile() {
    const dockerfile = await fs.readFile(path.join(repoRoot, 'Dockerfile'), 'utf8');
    const copy = (target) => [
        `COPY --from=core / ${target}/node_modules/@formio/appserver-core/`,
        `COPY --from=appserver lib ${target}/node_modules/@formio/appserver/lib/`,
        `COPY --from=appserver package.json ${target}/node_modules/@formio/appserver/package.json`,
    ].join('\n');
    const install = /^RUN .*yarn install --immutable$/m;
    const image = /^COPY --from=builder \/app\/node_modules \.\/node_modules$/m;
    if (!install.test(dockerfile) || !image.test(dockerfile)) throw new Error('The Dockerfile changed: E2E_LOCAL_CORE cannot place the local packages.');
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'uag-local-packages-')), 'Dockerfile');
    await fs.writeFile(file, dockerfile
        .replace(install, (line) => `${line}\n${copy('/app')}`)
        .replace(image, (line) => `${line}\n${copy('.')}`));
    return file;
}

/** Builds this tree as `formio/uag:e2e-local`, once per test run. */
export function buildLocalImage() {
    imageBuild ||= (async () => {
        const args = ['build', '-t', IMAGE];
        const core = process.env.E2E_LOCAL_CORE;
        const appserver = process.env.E2E_LOCAL_APPSERVER;
        if (core || appserver) {
            if (!core || !appserver) throw new Error('Set both E2E_LOCAL_CORE and E2E_LOCAL_APPSERVER, or neither.');
            // Only the built package, not the repository and its node_modules.
            const staged = await fs.mkdtemp(path.join(os.tmpdir(), 'uag-local-appserver-'));
            await fs.cp(path.join(path.resolve(appserver), 'lib'), path.join(staged, 'lib'), { recursive: true });
            await fs.copyFile(path.join(path.resolve(appserver), 'package.json'), path.join(staged, 'package.json'));
            args.push('-f', await localPackagesDockerfile(), '--build-context', `core=${path.resolve(core)}`, '--build-context', `appserver=${staged}`);
        }
        return exec('docker', [...args, repoRoot], { timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });
    })();
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
