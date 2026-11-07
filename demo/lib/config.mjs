/**
 * The demo site's build-time configuration, read once from the environment.
 *
 * The site is static: everything here ends up in the pages, so nothing here
 * may be a secret. Everything that names a host lives here, so moving the
 * site to another domain is a change to DEMO_DOMAIN (or DEMO_PUBLIC_URL), and
 * moving the UAG is a change to DEMO_UAG_URL.
 */
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
// The site's version is the UAG release it ships with (set by "Update versions.").
const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

/** The demo's own project, on Form.io's hosted service. */
export const DEFAULT_PROJECT_URL = 'https://uag.form.io';

const DEFAULT_DOMAIN = 'ai.form.io';

/** The site's public URL: DEMO_PUBLIC_URL, or else DEMO_DOMAIN over HTTPS. */
export function publicUrlOf(env) {
    return (env.DEMO_PUBLIC_URL || `https://${env.DEMO_DOMAIN || DEFAULT_DOMAIN}`).replace(/\/+$/, '');
}

/**
 * Whether a UAG's capabilities let it run Agentic Formflow: it needs a UAG
 * license or a project on Form.io's hosted service.
 */
export function formflowSupported(capabilities) {
    const reason = capabilities?.formflow?.reason;
    return !!capabilities?.formflow?.allowed && (reason === 'licensed' || reason === 'hosted');
}

/**
 * A project's name, which the UAG serves its routes under: the last path
 * segment of a self-hosted Enterprise project (`http://api-server:3000/demo`),
 * or the subdomain of a project on Form.io's hosted service (`https://uag.form.io`).
 */
export function projectNameOf(projectUrl) {
    const url = new URL(projectUrl);
    return url.pathname.split('/').filter(Boolean).pop() || url.hostname.split('.')[0];
}

/**
 * Names of settings that hold secrets. None of their values may appear in the
 * built site (see scripts/build.mjs).
 */
export function isSecretName(name) {
    return /KEY|SECRET|PASS|LICENSE|TOKEN/.test(name);
}

const trim = (url) => String(url || '').replace(/\/+$/, '');

/**
 * The Form.io server a project is on (formio.js's base URL): `https://api.form.io`
 * for a project on Form.io's hosted service, else the project URL without its
 * last path segment (`http://localhost:3001/demo` → `http://localhost:3001`).
 */
export function formioBaseOf(projectUrl) {
    const url = new URL(projectUrl);
    if (url.hostname.endsWith('.form.io') && url.pathname.replace(/\/+$/, '') === '') return 'https://api.form.io';
    const parts = url.pathname.split('/').filter(Boolean);
    parts.pop();
    return `${url.origin}${parts.length ? `/${parts.join('/')}` : ''}`;
}

/**
 * The site's Content-Security-Policy. deploy/site.yml sends the same policy from
 * CloudFront, with its UagOrigin parameter for `uagOrigin` (a test keeps the two
 * the same); scripts/serve.mjs sends it locally, adding `projectOrigin` when the
 * project is not on Form.io's hosted service.
 *
 * The UAG serves @formio/uag-js (`/uag-js/uag.use.js` and its stylesheet), and
 * the pages call it and the project from the browser. formio.js evaluates form
 * logic with Function, so the demo apps need 'unsafe-eval'.
 */
export function contentSecurityPolicy({ uagOrigin, projectOrigin = '' }) {
    const connect = ["'self'", uagOrigin, 'https://*.form.io'];
    if (projectOrigin && !/^https:\/\/([^/]+\.)?form\.io$/.test(projectOrigin) && projectOrigin !== uagOrigin) connect.push(projectOrigin);
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net https://cdn.form.io ${uagOrigin}`,
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdn.form.io ${uagOrigin}`,
        `font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdn.form.io ${uagOrigin}`,
        "img-src 'self' data: blob: https:",
        `connect-src ${connect.join(' ')}`,
        "frame-src 'self'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');
}

export function readConfig(env = process.env) {
    const production = env.NODE_ENV === 'production';
    const publicUrl = publicUrlOf(env);
    const projectUrl = trim(env.FORMIO_PROJECT_URL || DEFAULT_PROJECT_URL);
    const uagUrl = trim(env.DEMO_UAG_URL || (production ? '' : 'http://localhost:3200'));
    if (production && !uagUrl) throw new Error('Set DEMO_UAG_URL to build the site for production.');
    // The UAG serves a self-hosted Enterprise or hosted project's form routes under
    // the project's name, and an Open Source server's at its root (DEMO_UAG_PROJECT_PATH="").
    const projectPath = env.DEMO_UAG_PROJECT_PATH !== undefined
        ? trim(env.DEMO_UAG_PROJECT_PATH)
        : `/${projectNameOf(projectUrl)}`;
    return {
        production,
        publicUrl,
        root: path.resolve(here, '..'),
        out: path.resolve(here, '..', env.DEMO_OUT || 'dist'),
        // What the pages are given: the UAG they embed, the project's URL on it, and the
        // project itself, where visitors register as guests.
        uag: { url: uagUrl, projectUrl: `${uagUrl}${projectPath}` },
        projectUrl,
        formioBaseUrl: trim(env.FORMIO_BASE_URL || formioBaseOf(projectUrl)),
        links: {
            contactForm: env.CONTACT_FORM_URL || 'https://formio.form.io/contact',
            portal: env.PORTAL_URL || 'https://portal.form.io',
            github: env.GITHUB_URL || 'https://github.com/formio/uag',
            // Links into the repository's files point at this release's tag, so they
            // resolve before the release reaches the default branch.
            source: `${env.GITHUB_URL || 'https://github.com/formio/uag'}/tree/v${version}`,
            sourceFile: `${env.GITHUB_URL || 'https://github.com/formio/uag'}/blob/v${version}`,
            // The Agentic Coding Plugin (skills and the Form.io MCP server).
            plugin: env.PLUGIN_URL || 'https://github.com/formio/ai',
            formio: env.FORMIO_SITE_URL || 'https://form.io',
            schedule: env.SCHEDULE_URL || 'https://form.io/contact-us',
            // Where the demos run for anyone, named by the notice a local run shows.
            liveDemo: env.DEMO_LIVE_URL || 'https://ai.form.io',
        },
        formioJsVersion: env.FORMIO_JS_VERSION || '5.6.1',
        // Added to the URLs of the site's scripts and stylesheets (?v=), so a new
        // release's are fetched at once while each stays cached between releases.
        assetVersion: env.DEMO_ASSET_VERSION || version,
    };
}
