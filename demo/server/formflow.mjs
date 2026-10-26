/**
 * Agentic Formflow: the Lantern Mutual claims wizard (a first notice of loss).
 *
 * The page renders the claim form with formio.js and attaches the UAG's
 * renderer plugin, which calls the Agent API as the policyholder continues.
 * The browser talks only to these routes, which relay to the UAG and Form.io
 * with the project key. A production application would instead give the
 * plugin the signed-in user's own UAG token, so extraction runs with that
 * user's permissions; the UAG refuses admin keys from browsers.
 *
 *   GET  /api/formflow/form            the claim form definition
 *   POST /api/formflow/agent/extract   the Agent API, streamed back as it answers
 *   POST /api/formflow/claims          save the claim through the UAG
 */
import express from 'express';
import { Readable } from 'node:stream';

const FORM = 'claim';
const TASK = 'triage';
// The triage task's input field: the description the engines read.
const INPUT = 'lossDescription';
// What else of the claim the engines read: the triage task's context (`uagContext`).
const CONTEXT = ['policyNumber'];
/** The claim upload, which reads its own (larger) body rather than the site's JSON parser. */
export const CLAIMS_PATH = '/api/formflow/claims';

export function formflowRoutes(router, { config, uag, formio, flow, sessions, guard }) {
    // A free-text value longer than the demo takes, or not text at all.
    const tooLong = (value) => value !== undefined && (typeof value !== 'string' || value.length > config.maxInputLength);
    // Any value of the claim the engines read, too long: each is sent with every question.
    const tooLongForEngines = (data) => [INPUT, ...CONTEXT].some((key) => tooLong(data?.[key]));

    router.get('/api/formflow/form', async (req, res) => {
        const response = await formio.form(FORM);
        res.status(response.status).json(response.body);
    });

    /** Refuse, before anything is charged, a description (or policy number) longer than the demo takes. */
    function validateExtract(req, res, next) {
        const { data, text } = req.body || {};
        if ((data !== undefined && (typeof data !== 'object' || data === null)) || tooLong(text) || tooLongForEngines(data)) {
            res.status(400).json({ error: 'The description or policy number is too long for this demo.' });
            return;
        }
        next();
    }

    router.post('/api/formflow/agent/extract', validateExtract, guard.protect('extract'), async (req, res) => {
        const { data, text, overwrite } = req.body || {};
        // Only the claim form's triage task: the browser does not choose what the demo's key is used for.
        const body = { form: FORM, task: TASK, ...(data && { data }), ...(text !== undefined && { text }), ...(overwrite && { overwrite: true }) };
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        let response;
        try {
            response = await uag.agent('extract', body, {
                requestId: sessions.requestId(req.session),
                accept: req.get('accept') === 'text/event-stream' ? 'text/event-stream' : 'application/json',
                signal: abort.signal,
            });
        }
        catch (err) {
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

    // Saved through the UAG, so the form's agentDecide action re-decides triage on
    // the server before the claim is stored: a value changed in the browser is not
    // trusted for the routing it drives.
    // The body (photos included) is read only once the guard has let the request in.
    router.post(CLAIMS_PATH, guard.protect('submit'), express.json({ limit: '8mb' }), async (req, res) => {
        const data = req.body?.data;
        if (!data || typeof data !== 'object' || tooLongForEngines(data)) {
            res.status(400).json({ error: 'No claim was sent.' });
            return;
        }
        try {
            const response = await uag.submit(await formio.pathOf(FORM), data, { requestId: sessions.requestId(req.session) });
            const body = await response.json().catch(() => ({}));
            if (response.ok && body._id) flow.own(req.session, body._id, FORM);
            res.status(response.status).json(body);
        }
        catch (err) {
            res.status(502).json({ error: 'The claim could not be saved. Please try again.' });
        }
    });
}
