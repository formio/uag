import { spawn } from 'child_process';

/**
 * Spawns a child node process and returns a handle with a kill() method.
 * Captures stdout/stderr for debugging output on failure.
 */
export function spawnNode(scriptPath, { env = {}, cwd } = {}) {
    const child = spawn(process.execPath, ['--no-node-snapshot', scriptPath], {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    return {
        child,
        getOutput: () => output,
        kill: () => new Promise((resolve) => {
            if (child.exitCode !== null) return resolve();
            child.once('exit', resolve);
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 3000).unref();
        }),
    };
}

/**
 * Polls a URL until it responds (any HTTP status) or the deadline passes.
 */
export async function waitForHttp(url, { timeoutMs = 30000, intervalMs = 250, method = 'GET' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            await fetch(url, { method, signal: AbortSignal.timeout(2000) });
            return;
        }
        catch (error) {
            lastError = error;
            await new Promise((r) => setTimeout(r, intervalMs));
        }
    }
    throw new Error(`Timed out waiting for ${url}: ${lastError?.message}`);
}
