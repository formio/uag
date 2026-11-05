import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { Request, Response, Router } from 'express';
import type { PluginRegistry, ServedComponent } from '@formio/appserver';

/** Where @formio/uag-js is installed: as a package, or the UAG's own workspace copy. */
function uagJsDirectory(): string | undefined {
    try {
        return path.dirname(require.resolve('@formio/uag-js/package.json'));
    }
    catch {
        const local = path.resolve(__dirname, '..', '..', 'packages', 'uag-js');
        return fs.existsSync(path.join(local, 'index.js')) ? local : undefined;
    }
}

const read = (file: string) => fs.readFileSync(path.join(uagJsDirectory() || '', file), 'utf8');

/** A chained script or stylesheet URL from `?chain=`, when it is an absolute URL of the allowed schemes. */
function chainOf(req: Request, schemes: string[]): string | undefined {
    const chain = typeof req.query.chain === 'string' ? req.query.chain : '';
    if (!chain) return undefined;
    try {
        const url = new URL(chain);
        return schemes.includes(url.protocol) ? url.href : undefined;
    }
    catch {
        return undefined;
    }
}

/**
 * The script that registers the bundle once formio.js is on the page: with
 * this UAG's URL (from the script's own src) and the manifest, and in portal
 * mode for the portal script, then loads the chained script over https only.
 */
function registration(manifest: any[], options: { portal: boolean; chain?: string }): string {
    return `
;(function () {
    var manifest = ${JSON.stringify(manifest).replace(/</g, '\\u003c')};
    var script = document.currentScript;
    var src = script && script.src ? new URL(script.src, location.href) : null;
    var uagUrl = src ? src.href.slice(0, src.href.indexOf('/uag-js/')) : location.origin;
    function register() {
        var Formio = window.Formio;
        var lib = window.FormioUAG;
        if (!Formio || !lib || typeof Formio.use !== 'function') return false;
        Formio.use(lib.UAG(uagUrl, { ${options.portal ? 'portal: true, ' : ''}manifest: manifest }));
        return true;
    }
    if (!register()) {
        var tries = 0;
        var timer = setInterval(function () { if (register() || ++tries > 600) clearInterval(timer); }, 50);
    }
    ${options.chain ? `var chain = document.createElement('script');
    chain.src = ${JSON.stringify(options.chain)};
    document.head.appendChild(chain);` : ''}
})();
`;
}

/** Serve one file: public, revalidated every time (no-cache), with an ETag from its content and the manifest. */
function serve(req: Request, res: Response, type: string, body: string) {
    const etag = `"${createHash('sha256').update(body).digest('base64url')}"`;
    res.set({ 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache', ETag: etag, 'Access-Control-Allow-Origin': '*' });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.status(200).send(body);
}

/**
 * `@formio/uag-js` from the UAG's own installation, at stable URLs (never a
 * version in the path: the portal remembers its one-time prompt by URL):
 *
 * - `/uag-js/uag.use.js`: the bundle, registering itself with this UAG's URL and the manifest;
 * - `/uag-js/portal.js`: the same in portal mode (the component only), then `?chain=` (https only);
 * - `/uag-js/portal.css`: the stylesheet, after `@import url(<chain>)` when `?chain=` is given;
 * - `/uag-js/uag-js.css`: the stylesheet.
 *
 * The modules' components come after: each script after the registration in
 * `uag.use.js` and `portal.js`, each stylesheet after `uag-js.css` (and in
 * `portal.css`), and each on its own at `/uag-js/components/<type>.js|css`.
 * They are read on every request, as the bundle is, so the ETag follows them.
 */
export function uagJsRouter(registry: () => PluginRegistry | undefined, components: () => ServedComponent[] = () => []): Router {
    const router = Router();
    const manifest = () => {
        const plugins = registry();
        // Every plugin the modules' components may read (document, converter, module, and types
        // modules define): not the UAG's own engines, tools and actions, which /plugins lists.
        return plugins ? plugins.manifest().filter((plugin) => !['engine', 'tool', 'action'].includes(plugin.type)) : [];
    };
    // Each component's script in its own try/catch, so one that fails does not stop the others.
    const scripts = () => components().map((component) => `\n;/* ${component.module}: ${component.type} */\ntry {\n${fs.readFileSync(component.scriptPath, 'utf8')}\n} catch (err) { console.error(${JSON.stringify(`[uag-js] The ${component.type} component of the ${component.module} module could not load:`)}, err); }\n`).join('');
    const styles = () => components().filter((component) => component.stylePath).map((component) => `\n/* ${component.module}: ${component.type} */\n${fs.readFileSync(component.stylePath as string, 'utf8')}`).join('');
    const component = (type: string) => components().find((candidate) => candidate.type === type);
    router.get('/uag-js/components/:file', (req, res) => {
        const match = /^([a-z][a-z0-9]*)\.(js|css)$/.exec(String(req.params.file));
        const found = match ? component(match[1]) : undefined;
        const file = found && (match![2] === 'js' ? found.scriptPath : found.stylePath);
        if (!file) return res.status(404).type('text/plain').send('No module of this UAG has that component.');
        serve(req, res, match![2] === 'js' ? 'application/javascript' : 'text/css', fs.readFileSync(file, 'utf8'));
    });
    const missing = (res: Response) => res.status(404).type('text/plain').send('@formio/uag-js is not installed with this UAG.');
    router.get('/uag-js/uag.use.js', (req, res) => {
        if (!uagJsDirectory()) return missing(res);
        serve(req, res, 'application/javascript', read('index.js') + registration(manifest(), { portal: false }) + scripts());
    });
    router.get('/uag-js/portal.js', (req, res) => {
        if (!uagJsDirectory()) return missing(res);
        serve(req, res, 'application/javascript', read('index.js') + registration(manifest(), { portal: true, chain: chainOf(req, ['https:']) }) + scripts());
    });
    router.get('/uag-js/portal.css', (req, res) => {
        if (!uagJsDirectory()) return missing(res);
        const chain = chainOf(req, ['https:', 'http:']);
        serve(req, res, 'text/css', (chain ? `@import url(${JSON.stringify(chain)});\n` : '') + read('uag-js.css') + styles());
    });
    router.get('/uag-js/uag-js.css', (req, res) => {
        if (!uagJsDirectory()) return missing(res);
        serve(req, res, 'text/css', read('uag-js.css') + styles());
    });
    return router;
}
