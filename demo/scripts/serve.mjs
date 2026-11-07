#!/usr/bin/env node
/**
 * Serves the built site (demo/dist) on your machine the way CloudFront serves
 * it (deploy/site.yml): `/a/b` and `/a/b/` answer `a/b/index.html`, and a path
 * the site does not have answers `404.html` with status 404.
 *
 *   node demo/scripts/serve.mjs [port]           serve demo/dist (DEMO_PORT, else 8080)
 *   node demo/scripts/serve.mjs [port] --watch   build first, and again on every change
 *
 * For development only: production is S3 + CloudFront.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy, readConfig } from '../lib/config.mjs';
import { build } from './build.mjs';

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.woff2': 'font/woff2', '.xml': 'application/xml',
};

/** The file a request path answers with, or null: the CloudFront function's mapping (deploy/site.yml). */
export function resolve(root, urlPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(urlPath.split('?')[0]);
    }
    catch {
        return null;
    }
    const file = path.normalize(path.join(root, decoded));
    if (file !== root && !file.startsWith(root + path.sep)) return null;
    for (const candidate of [file, path.join(file, 'index.html')]) {
        try {
            if (fs.statSync(candidate).isFile()) return candidate;
        }
        catch {
            // Not there; try the next.
        }
    }
    return null;
}

/**
 * A static server for `root`. `headers` are sent with every answer, as
 * CloudFront's response headers policy sends them (deploy/site.yml).
 */
export function createServer(root, headers = {}) {
    root = path.resolve(root);
    return http.createServer((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD' }).end();
            return;
        }
        const found = resolve(root, req.url || '/');
        const file = found || path.join(root, '404.html');
        const type = TYPES[path.extname(file)] || 'application/octet-stream';
        // HTML is revalidated on every load; nothing is cached for long in development.
        res.writeHead(found ? 200 : 404, { ...headers, 'Content-Type': type, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).on('error', () => res.end()).pipe(res);
    });
}

/** The headers CloudFront's response headers policy sends (deploy/site.yml), for a build's config. */
export function securityHeaders(config) {
    return {
        'Content-Security-Policy': contentSecurityPolicy({ uagOrigin: new URL(config.uag.url).origin, projectOrigin: new URL(config.projectUrl).origin }),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
    };
}

/**
 * Builds the site with the settings in `env` (as lib/config.mjs reads them) and
 * serves it on `port`, for the local stacks and the e2e suites. Give each stack
 * its own DEMO_OUT. Resolves to `{ config, env, url, close }`.
 */
export async function serveSite({ port, env, host = '127.0.0.1' }) {
    const config = readConfig(env);
    build(config, { ...process.env, ...env });
    const server = createServer(config.out, securityHeaders(config));
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(port), host, resolve);
    });
    return {
        config,
        env,
        url: `http://${host}:${port}`,
        close: () => new Promise((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
        }),
    };
}

/** The folders a build reads, which a watched site is rebuilt on. */
const SOURCES = ['views', 'content', 'public', 'lib', 'module'];

/**
 * Rebuilds the site with the settings in `env` whenever its sources change.
 * Returns a function that stops watching.
 */
export function watchSite(env) {
    const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    let timer = null;
    const rebuild = () => {
        try {
            build(readConfig(env), { ...process.env, ...env });
            console.log('[demo] Rebuilt the site.');
        }
        catch (error) {
            console.error(`[demo] The site did not build: ${error.message}`);
        }
    };
    const watchers = SOURCES.map((dir) => fs.watch(path.join(demo, dir), { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(rebuild, 150);
    }));
    return () => {
        clearTimeout(timer);
        for (const watcher of watchers) watcher.close();
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const args = process.argv.slice(2);
    const watch = args.includes('--watch');
    const port = Number(args.find((arg) => /^\d+$/.test(arg)) || process.env.DEMO_PORT || 8080);
    const local = path.join(demo, '.env.local');
    if (fs.existsSync(local)) process.loadEnvFile(local);
    const config = readConfig();

    if (watch) {
        try {
            build(config);
        }
        catch (error) {
            console.error(`[demo:serve] ${error.message}`);
        }
        watchSite(process.env);
    }
    if (!fs.existsSync(path.join(config.out, 'index.html'))) {
        console.error('[demo:serve] Nothing to serve: build the site first (yarn demo:build), or pass --watch.');
        process.exit(1);
    }
    createServer(config.out, securityHeaders(config)).listen(port, '127.0.0.1', () => {
        console.log(`[demo:serve] The site is at http://localhost:${port}, against the UAG at ${config.uag.url}.`);
    });
}
