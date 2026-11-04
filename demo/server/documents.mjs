/**
 * AI Document: a lease review form whose AI Document components turn an
 * uploaded lease into its key clauses, copied word for word, a summary, and a
 * translation for the tenant.
 *
 * The page renders the form with formio.js and registers @formio/uag-js with
 * this site as its "UAG": the component asks these routes for the installed
 * plugins and posts its files here, and they relay to the UAG with the
 * project key. A production application would register the UAG's own URL and
 * give the component the signed-in user's token instead.
 *
 *   GET  /api/documents/form                 the lease review form definition
 *   GET  /api/documents/uag/plugins          the document plugins and converters the UAG has
 *   POST /api/documents/uag/project/:project/form/:form/document/process
 *                                            process one AI Document's files, streamed back
 *   POST /api/documents/reviews              save the review through the UAG
 */
import express from 'express';
import { Readable } from 'node:stream';

const FORM = 'leaseReview';
/** The form's AI Documents: the only components the browser may ask to process. */
const DOCUMENTS = ['leaseClauses', 'leaseSummary', 'leaseTranslation'];
/** The text fields sent along with a document's files (the plugins may read the form's data). */
const FIELDS = ['property', 'reviewer'];
/** Where the component posts, under the "UAG" URL the page registers. */
export const DOCUMENTS_UAG_PATH = '/api/documents/uag/';
/** The review upload, whose files make it larger than the site's JSON limit. */
export const REVIEWS_PATH = '/api/documents/reviews';
// A lease of up to 3 MB, base64 encoded, in each of the two components.
const BODY_LIMIT = '12mb';

export function documentRoutes(router, { config, uag, formio, flow, sessions, guard }) {
    const tooLong = (value) => value !== undefined && (typeof value !== 'string' || value.length > config.maxInputLength);
    const fieldsOf = (data) => Object.fromEntries(FIELDS.filter((key) => typeof data?.[key] === 'string').map((key) => [key, data[key]]));

    router.get('/api/documents/form', async (req, res) => {
        const response = await formio.form(FORM);
        res.status(response.status).json(response.body);
    });

    // Asked by every visitor's page, so kept for a minute; only the plugins' public descriptions are passed on.
    let manifest = null;
    router.get(`${DOCUMENTS_UAG_PATH}plugins`, async (req, res) => {
        try {
            if (!manifest || manifest.expires < Date.now()) {
                const plugins = await uag.plugins();
                manifest = { plugins: (Array.isArray(plugins) ? plugins : []).filter((plugin) => plugin?.type === 'document' || plugin?.type === 'converter'), expires: Date.now() + 60_000 };
            }
            res.set('Cache-Control', 'no-store').json(manifest.plugins);
        }
        catch {
            res.status(502).json({ error: 'The UAG could not be reached.' });
        }
    });

    /** Only the lease review form's own documents: the browser does not choose what the demo's key is used for. */
    async function validateProcess(req, res, next) {
        try {
            const form = (await formio.form(FORM)).body;
            if (!form?._id || req.params.form !== String(form._id)) {
                res.status(404).json({ error: 'This demo processes only the lease review form.' });
                return;
            }
            next();
        }
        catch {
            res.status(502).json({ error: 'The form could not be loaded.' });
        }
    }

    // The body (the lease, base64 encoded) is read only once the guard has let the request in.
    router.post(`${DOCUMENTS_UAG_PATH}project/:project/form/:form/document/process`, validateProcess, guard.protect('document'), express.json({ limit: BODY_LIMIT }), async (req, res) => {
        const { path, files, data } = req.body || {};
        if (!DOCUMENTS.includes(path) || !Array.isArray(files) || !files.length || files.length > 1 || FIELDS.some((key) => tooLong(data?.[key]))) {
            res.status(400).json({ error: 'Send one lease to process.' });
            return;
        }
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        let response;
        try {
            // The other document's files stay behind: only the text fields go with this one.
            response = await uag.document(await formio.pathOf(FORM), { path, files, data: fieldsOf(data) }, {
                requestId: sessions.requestId(req.session),
                accept: req.get('accept') === 'text/event-stream' ? 'text/event-stream' : 'application/json',
                signal: abort.signal,
            });
        }
        catch {
            if (!abort.signal.aborted) res.status(502).json({ error: 'The UAG could not be reached.' });
            return;
        }
        res.status(response.status);
        res.set('Content-Type', response.headers.get('content-type') || 'application/json');
        res.set('Cache-Control', 'no-cache, no-transform');
        res.set('X-Accel-Buffering', 'no');
        if (response.body) Readable.fromWeb(response.body).on('error', () => res.end()).pipe(res);
        else res.end();
    });

    router.post(REVIEWS_PATH, guard.protect('submit'), express.json({ limit: BODY_LIMIT }), async (req, res) => {
        const data = req.body?.data;
        if (!data || typeof data !== 'object' || FIELDS.some((key) => tooLong(data[key]))) {
            res.status(400).json({ error: 'No review was sent.' });
            return;
        }
        try {
            const response = await uag.submit(await formio.pathOf(FORM), data, { requestId: sessions.requestId(req.session) });
            const body = await response.json().catch(() => ({}));
            if (response.ok && body._id) flow.own(req.session, body._id, FORM);
            res.status(response.status).json(body);
        }
        catch {
            res.status(502).json({ error: 'The review could not be saved. Please try again.' });
        }
    });
}
