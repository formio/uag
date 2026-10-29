/**
 * Configuration for the demo site, read once from the environment.
 *
 * Everything that names a host lives here, so moving the site to another
 * domain is a change to DEMO_DOMAIN (or DEMO_PUBLIC_URL) and nothing else.
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const here = path.dirname(new URL(import.meta.url).pathname);

function int(value, fallback) {
    const parsed = parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value, fallback) {
    return String(value || fallback).split(',').map((item) => item.trim()).filter(Boolean);
}

function json(value, fallback, name) {
    if (!value) return fallback;
    try {
        return { ...fallback, ...JSON.parse(value) };
    }
    catch {
        throw new Error(`${name} is not valid JSON.`);
    }
}


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

/** The rate limits applied to each visitor, by operation: `{ limit, windowMs }` per session and per IP. */
export const DEFAULT_LIMITS = {
    chat: { session: { limit: 30, windowMs: 10 * 60_000 }, ip: { limit: 90, windowMs: 10 * 60_000 } },
    extract: { session: { limit: 30, windowMs: 10 * 60_000 }, ip: { limit: 90, windowMs: 10 * 60_000 } },
    submit: { session: { limit: 6, windowMs: 10 * 60_000 }, ip: { limit: 20, windowMs: 60 * 60_000 } },
};

/** What each operation costs against the daily budget. An application runs two agents. */
export const DEFAULT_COSTS = { chat: 1, extract: 1, submit: 1, application: 2 };

/**
 * A project's name, which the UAG serves its routes and names its client ids
 * under: the last path segment of a self-hosted Enterprise project
 * (`http://api-server:3000/demo`), or the subdomain of a project on Form.io's
 * hosted service (`https://uag.form.io`).
 */
export function projectNameOf(projectUrl) {
    const url = new URL(projectUrl);
    return url.pathname.split('/').filter(Boolean).pop() || url.hostname.split('.')[0];
}

export function readConfig(env = process.env) {
    const publicUrl = publicUrlOf(env);
    const projectUrl = (env.FORMIO_PROJECT_URL || DEFAULT_PROJECT_URL).replace(/\/+$/, '');
    const adminKey = env.ADMIN_KEY || '';
    const projectKey = env.PROJECT_KEY || '';
    if (!adminKey && !projectKey) {
        throw new Error('Set PROJECT_KEY (Form.io Enterprise) or ADMIN_KEY (Form.io Open Source).');
    }
    const projectName = env.FORMIO_PROJECT_NAME || projectNameOf(projectUrl);
    const production = env.NODE_ENV === 'production';
    if (production && !env.DEMO_SECRET) {
        throw new Error('Set DEMO_SECRET: it signs the visitor cookie.');
    }
    // Without the human check, anyone can script the demos into the budget, so a
    // public deployment needs it unless it is turned off on purpose.
    if (production && env.DEMO_REQUIRE_TURNSTILE !== 'false' && !(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)) {
        throw new Error('Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or DEMO_REQUIRE_TURNSTILE=false to run the public demos without a human check.');
    }
    return {
        port: int(env.PORT, 8080),
        publicUrl,
        secure: publicUrl.startsWith('https:'),
        // Hops of reverse proxy in front of the site (the load balancer that ends TLS).
        trustProxy: int(env.TRUST_PROXY, 1),
        secret: env.DEMO_SECRET || randomBytes(32).toString('hex'),
        production,
        // Re-read the pages and docs on every request, for editing them (scripts/dev.mjs).
        reload: !!env.DEMO_RELOAD,

        formio: {
            projectUrl,
            // The key header the Form.io server expects: an Enterprise project key, or the OSS admin key.
            keyHeader: projectKey ? { 'x-token': projectKey } : { 'x-admin-key': adminKey },
        },
        uag: {
            // The flow proxy, which forwards to the UAG, so the demo's own calls show in the viewer.
            // With FLOW_UAG_URL the site runs that proxy itself, and sets this to it at startup.
            url: (env.UAG_URL || 'http://uag-flow:3250').replace(/\/+$/, ''),
            // An Enterprise project's form routes are served under its name, an Open Source
            // server's at the root. /agent/capabilities is at the root.
            projectPath: projectKey ? `/${projectName}` : '',
        },
        flow: {
            url: (env.FLOW_URL || '').replace(/\/+$/, ''),
            key: env.FLOW_KEY || '',
            // The UAG, when the site runs the flow proxy in front of it itself (one container
            // instead of uag-flow). The engines then run inside the UAG, so no engine server is shown.
            uagUrl: (env.FLOW_UAG_URL || '').replace(/\/+$/, ''),
            // Where the engines run, which decides what the flow viewer can show: `remote`, on an
            // engine server behind the flow proxy, so each engine call is seen; or `inside` the UAG,
            // where its calls to them never cross the network. Inside by default with FLOW_UAG_URL.
            engines: env.FLOW_ENGINES === 'inside' || env.FLOW_ENGINES === 'remote' ? env.FLOW_ENGINES : (env.FLOW_UAG_URL ? 'inside' : 'remote'),
        },
        chat: {
            // The form the conversation demo embeds as a chat, with @formio/uag-js.
            form: env.CHAT_FORM || 'serviceRequest',
            // Turns one visitor's conversation may take before it must start over.
            maxTurns: int(env.CHAT_MAX_TURNS, 30),
            maxMessageLength: int(env.CHAT_MAX_MESSAGE_LENGTH, 2000),
        },
        turnstile: {
            siteKey: env.TURNSTILE_SITE_KEY || '',
            secretKey: env.TURNSTILE_SECRET_KEY || '',
            // How long one successful challenge lets a visitor use the live demos.
            validMs: int(env.TURNSTILE_VALID_MINUTES, 120) * 60_000,
        },
        budget: {
            // Units per UTC day across every visitor; 0 turns the cap off.
            daily: int(env.DEMO_DAILY_BUDGET, 2000),
            costs: json(env.DEMO_COSTS, DEFAULT_COSTS, 'DEMO_COSTS'),
            // A chat turn also pays one unit per this many model tokens it used.
            tokensPerUnit: int(env.DEMO_TOKENS_PER_UNIT, 20_000),
            // Units one network (an IPv4 address or IPv6 /64) may spend a day; 0 turns it off.
            perNetwork: int(env.DEMO_DAILY_NETWORK_BUDGET, 200),
        },
        limits: json(env.DEMO_LIMITS, DEFAULT_LIMITS, 'DEMO_LIMITS'),
        stateDir: env.DEMO_STATE_DIR || '',
        // New visitor sessions one network may start in ten minutes.
        sessionsPerNetwork: int(env.DEMO_SESSIONS_PER_NETWORK, 300),
        // Live flow streams one network may hold open.
        streamsPerNetwork: int(env.DEMO_STREAMS_PER_NETWORK, 10),
        // The longest free-text input a demo task takes (a description, a message).
        maxInputLength: int(env.DEMO_MAX_INPUT_LENGTH, 8000),
        retentionHours: int(env.DEMO_RETENTION_HOURS, 24),
        retentionForms: list(env.DEMO_RETENTION_FORMS, 'serviceRequest,application,sum,claim'),

        links: {
            contactForm: env.CONTACT_FORM_URL || 'https://formio.form.io/contact',
            portal: env.PORTAL_URL || 'https://portal.form.io',
            github: env.GITHUB_URL || 'https://github.com/formio/uag',
            // The Agentic Coding Plugin (skills and the Form.io MCP server).
            plugin: env.PLUGIN_URL || 'https://github.com/formio/ai',
            formio: env.FORMIO_SITE_URL || 'https://form.io',
            schedule: env.SCHEDULE_URL || 'https://form.io/contact-us',
            // Where the demos run for anyone, named by the notice a local run shows.
            liveDemo: env.DEMO_LIVE_URL || 'https://ai.form.io',
        },
        formioJsVersion: env.FORMIO_JS_VERSION || '5.6.1',
        rendererDir: env.RENDERER_DIR || path.resolve(here, '../../packages/uag-js'),
        root: path.resolve(here, '..'),
    };
}
