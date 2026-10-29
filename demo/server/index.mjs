/**
 * The Form.io UAG demo site: the product pages, the developer documentation,
 * and the back end of the three live examples and the flow viewer.
 *
 * It is the only public service of the demo stack. The UAG stays on the private
 * network, and this server connects out to it, and to the project on Form.io;
 * see docker-compose.yml. With FLOW_UAG_URL set, it runs the flow proxy itself
 * (startFlowProxy); docker-compose.split.yml runs it as its own service instead.
 */
import express from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createFlowProxy } from '../flow/proxy.mjs';
import { formflowSupported, readConfig } from './config.mjs';
import { Sessions } from './sessions.mjs';
import { Guard, networkOf } from './guard.mjs';
import { FormioClient, UagClient } from './clients.mjs';
import { FlowHub } from './flow.mjs';
import { Docs } from './docs.mjs';
import { PAGES, Views, render, siteValues } from './pages.mjs';
import { conversationRoutes } from './conversation.mjs';
import { workflowRoutes } from './workflow.mjs';
import { CLAIMS_PATH, formflowRoutes } from './formflow.mjs';
import { startRetention } from './retention.mjs';

/** Security headers. The live demos load formio.js and the Turnstile widget from their CDNs. */
function securityHeaders(config) {
    const contact = new URL(config.links.contactForm).origin;
    const csp = [
        "default-src 'self'",
        // formio.js evaluates form logic with Function, so the demo apps need 'unsafe-eval'.
        "script-src 'self' 'unsafe-eval' https://cdn.jsdelivr.net https://cdn.form.io https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdn.form.io",
        "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdn.form.io",
        "img-src 'self' data: blob: https:",
        `connect-src 'self' ${contact} https://*.form.io`,
        "frame-src 'self' https://challenges.cloudflare.com",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');
    return (req, res, next) => {
        res.set({
            'Content-Security-Policy': csp,
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        });
        if (config.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
        next();
    };
}

/** Why the examples cannot all run here, by the reason formflowStatus() gives. */
const LICENSE_NOTICES = {
    unreachable: { reason: 'unreachable', why: 'No UAG answered at this site\'s <code>UAG_URL</code>, so the live demos cannot run.' },
    unlicensed: { reason: 'unlicensed', why: 'The UAG this site uses runs conversation forms, so the chat works, but not Agentic Formflow (the workflow and formflow demos) without a <code>LICENSE_KEY</code> that includes the UAG, or a project on Form.io\'s hosted service.' },
};

export function createApp(config = readConfig(), overrides = {}) {
    const sessions = new Sessions(config);
    const guard = overrides.guard || new Guard(config);
    const formio = new FormioClient(config.formio);
    const uag = new UagClient({ ...config.uag, keyHeader: config.formio.keyHeader });
    const flow = new FlowHub({ ...config.flow, streamsPerNetwork: config.streamsPerNetwork }, sessions);
    const docs = new Docs(path.join(config.root, 'content/developers'));
    const views = new Views(path.join(config.root, 'views'), { reload: config.reload });
    const context = { config, sessions, guard, formio, uag, flow };

    const app = express();
    app.set('trust proxy', config.trustProxy);
    app.disable('x-powered-by');
    app.use(securityHeaders(config));
    app.get('/health', (req, res) => res.json({ ok: true }));

    // Pages are revalidated on every load, so a deploy shows at once; their assets are cached for an hour.
    const statics = {
        maxAge: config.production ? '1h' : 0,
        index: 'index.html',
        setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
    };
    app.use(express.static(path.join(config.root, 'public'), statics));
    app.use('/renderer', express.static(config.rendererDir, statics));

    // Sessions exist only for the API: pages and assets never start one. A
    // network may start only so many, so a flood cannot push visitors out.
    app.use('/api', sessions.middleware({
        allowNew: (req) => !guard.windows.hit(`sessions:ip:${networkOf(req.ip)}`, { limit: config.sessionsPerNetwork, windowMs: 10 * 60_000 }),
    }));
    // The claim upload is parsed by its own route, after the guard has let it in.
    const smallJson = express.json({ limit: '200kb' });
    app.use((req, res, next) => (req.path === CLAIMS_PATH ? next() : smallJson(req, res, next)));

    // Whether the UAG may run Agentic Formflow (the workflow and formflow demos): it
    // needs a UAG license or a project on Form.io's hosted service. Conversation forms
    // need neither. Asked of the UAG, which always answers, at most once a minute,
    // and once for every request that arrives while it is being asked.
    let formflowCache = null;
    let formflowPending = null;
    async function formflowStatus() {
        if (formflowCache && formflowCache.expires > Date.now()) return formflowCache.value;
        formflowPending ||= checkFormflow().finally(() => { formflowPending = null; });
        return formflowPending;
    }
    async function checkFormflow() {
        let value;
        let ttl = 60_000;
        try {
            const caps = await uag.capabilities();
            value = { supported: formflowSupported(caps), reason: caps?.formflow?.reason || 'unknown', edition: caps?.edition || 'unknown' };
        }
        catch {
            // No UAG answered, or it answered with an error. Run on your own machine, that is a demo without a UAG of
            // its own (start one, on a license or a hosted project, and it is found within
            // seconds). Deployed, it is an outage, not a missing license: the demos say so
            // themselves.
            value = config.production
                ? { supported: true, reason: 'unknown', edition: 'unknown' }
                : { supported: false, reason: 'unreachable', edition: 'unknown' };
            ttl = 5_000;
        }
        formflowCache = { value, expires: Date.now() + ttl };
        return value;
    }

    const api = express.Router();
    api.get('/api/status', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ ...guard.status(req.session), flow: flow.enabled, formflow: await formflowStatus() });
    });
    api.post('/api/session/verify', async (req, res) => {
        const ok = await guard.verify(req.session, req.body?.token, req.ip);
        res.status(ok ? 200 : 403).json({ verified: ok });
    });
    api.get('/api/flow/stream', flow.stream());
    api.post('/api/flow/clear', (req, res) => {
        flow.clear(req.session);
        res.json({ ok: true });
    });
    conversationRoutes(api, context);
    workflowRoutes(api, context);
    formflowRoutes(api, context);
    api.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
    app.use(api);

    for (const page of PAGES) {
        app.get(page.route, async (req, res) => {
            const values = siteValues(config, page);
            // What a demo frame shows in place of a demo this deployment cannot run.
            if (page.app) values.demoUnsupported = views.read('partials/demo-unsupported');
            // Run on your own machine without a license, the examples say what they need.
            const formflow = page.nav === 'examples' ? await formflowStatus() : null;
            if (formflow && !formflow.supported) {
                values.licenseNotice = render(views.read('partials/license-notice'), { ...values, notice: LICENSE_NOTICES[formflow.reason] || LICENSE_NOTICES.unlicensed });
            }
            res.type('html').send(views.page(page.view, values));
        });
    }

    app.get(['/developers', '/developers/:slug'], (req, res, next) => {
        if (config.reload) docs.load();
        const doc = docs.get(req.params.slug);
        if (!doc || req.params.slug === 'index') return next();
        const { previous, next: following } = docs.neighbors(doc.slug);
        const page = { route: doc.href, view: 'developers', nav: 'developers', title: doc.slug === 'index' ? 'Developers' : doc.title, description: doc.description };
        res.type('html').send(views.page('developers', siteValues(config, page, {
            doc,
            docsNav: docs.nav(doc.slug),
            toc: doc.headings.filter((heading) => heading.depth === 2).map((heading) => `<li><a href="#${heading.id}">${heading.text}</a></li>`).join(''),
            pager: [
                previous ? `<a class="pager-prev" href="${previous.href}"><small>Previous</small>${previous.title}</a>` : '<span></span>',
                following ? `<a class="pager-next" href="${following.href}"><small>Next</small>${following.title}</a>` : '<span></span>',
            ].join(''),
            source: `${config.links.github}/blob/main/demo/content/developers/${doc.slug}.md`,
        })));
    });

    app.use((req, res) => {
        const page = { route: req.path, view: '404', nav: '', title: 'Page not found', description: '' };
        res.status(404).type('html').send(views.page('404', siteValues(config, page)));
    });
    app.use((err, req, res, next) => {
        // Body-parser errors carry the raw body, which holds what the visitor typed.
        if (err.type?.startsWith('entity.') || err.type === 'request.aborted') {
            if (res.headersSent) return res.end();
            return res.status(err.status || 400).json({ error: err.type === 'entity.too.large' ? 'That request is too large.' : 'That request could not be read.' });
        }
        console.error(err.stack || err.message);
        if (res.headersSent) return res.end();
        if (req.path.startsWith('/api/')) return res.status(err.status || 500).json({ error: err.expose ? err.message : 'Something went wrong.' });
        res.status(500).type('text').send('Something went wrong.');
    });

    flow.start();
    const stopRetention = overrides.retention === false ? () => {} : startRetention(context);
    app.locals.close = () => {
        flow.stop();
        sessions.close();
        guard.close();
        stopRetention();
    };
    app.locals.context = context;
    return app;
}

/**
 * Runs the flow proxy inside the site, on loopback, in front of config.flow.uagUrl, and
 * points the site's UAG and flow stream at it: the single-container form of uag-flow.
 */
export async function startFlowProxy(config) {
    const key = config.flow.key || randomBytes(32).toString('hex');
    // The engines run inside the UAG here, so nothing is sent to an engine server.
    const server = createFlowProxy({ uag: new URL(config.flow.uagUrl), engines: new URL('http://127.0.0.1:9'), flowKey: key });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    config.uag.url = url;
    config.flow = { ...config.flow, url, key };
    return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    // Run on its own (`yarn demo:start`), the site reads demo/.env.local, if there is one.
    const local = path.join(path.dirname(new URL(import.meta.url).pathname), '../.env.local');
    if (fs.existsSync(local)) process.loadEnvFile(local);
    const config = readConfig();
    if (config.flow.uagUrl) await startFlowProxy(config);
    createApp(config).listen(config.port, () => {
        console.log(`UAG demo site on port ${config.port}, published as ${config.publicUrl}`);
    });
}
