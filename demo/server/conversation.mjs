/**
 * Conversation forms: the service request form, as a chat.
 *
 * The page embeds the form with @formio/uag-js, as any application would:
 *
 *   Formio.use(FormioUAG.UAG(UAG_URL));
 *   Formio.createChat(element, FORM_URL);
 *
 * and the conversation runs in the UAG: each turn is the form's own chat
 * operation (`{form}/agent/chat`), which reads the form's fields, rules and
 * options and returns the next message with the values it took from the
 * visitor's words. This code knows nothing about service requests, and never
 * names a field.
 *
 * The demo's UAG is on a private network, so here UAG_URL and FORM_URL are
 * these routes, which stand in for the UAG's own for this one form: they relay
 * to it with the project key, behind the demo's bot check, budget and rate
 * limits, and attribute each turn to the visitor's flow view. An application
 * whose users sign in with Form.io uses the UAG's URL itself, with each user's
 * own token, and needs no routes of its own.
 *
 *   GET  /api/conversation/uag/{formPath}                     the form
 *   POST /api/conversation/uag[/project/{id}]/form/{id}/agent/chat   one turn
 *   POST /api/conversation/uag[/project/{id}]/form/{id}/submission   save it through the UAG
 *   POST /api/conversation/reset                              start a new conversation (its length limit)
 */

/** The model tokens a chat turn used, from the engine summary the UAG returns. */
export function tokensOf(turn) {
    const usage = turn?.engine?.usage || {};
    return (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
}

export function conversationRoutes(router, { config, uag, formio, flow, sessions, guard }) {
    const FORM = config.chat.form;

    /** The base the page registers as the UAG's URL. */
    const BASE = '/api/conversation/uag';

    router.get(`${BASE}/:formPath`, async (req, res) => {
        if (req.params.formPath !== await formio.pathOf(FORM)) {
            res.status(404).json({ error: 'Only the service request form is available in this demo.' });
            return;
        }
        const response = await formio.form(FORM);
        res.status(response.status).json(response.body);
    });

    /** Only the chat's own form: the browser does not choose what the demo's key is used for. */
    async function ownForm(req, res, next) {
        const form = await formio.form(FORM);
        if (!form.ok || String(form.body?._id) !== req.params.formId) {
            res.status(404).json({ error: 'Only the service request form is available in this demo.' });
            return;
        }
        next();
    }

    /** Refuse, before anything is charged, a turn the demo does not take. */
    function validateTurn(req, res, next) {
        const { messages, data } = req.body || {};
        const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
        if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
            res.status(400).json({ error: 'Type a message first.' });
            return;
        }
        if (messages.some((message) => typeof message?.content !== 'string' || message.content.length > config.chat.maxMessageLength)) {
            res.status(400).json({ error: `Messages are limited to ${config.chat.maxMessageLength} characters in this demo.` });
            return;
        }
        if (data !== undefined && (typeof data !== 'object' || data === null || Array.isArray(data))) {
            res.status(400).json({ error: 'That request could not be read.' });
            return;
        }
        if (req.session.chat.turns >= config.chat.maxTurns) {
            res.status(429).json({ error: 'This conversation has reached the demo\'s length limit. Start a new one to keep going.', code: 'conversation_limit' });
            return;
        }
        next();
    }

    router.post(`${BASE}{/project/:projectId}/form/:formId/agent/chat`, ownForm, validateTurn, guard.protect('chat'), async (req, res) => {
        const { messages, data } = req.body;
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableFinished) abort.abort(); });
        let response;
        try {
            response = await uag.agent(await formio.pathOf(FORM), 'chat', { messages, data: data || {} }, {
                requestId: sessions.requestId(req.session),
                signal: abort.signal,
            });
        }
        catch (err) {
            if (!abort.signal.aborted) res.status(502).json({ error: 'The UAG could not be reached.' });
            return;
        }
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
            req.session.chat.turns++;
            // The turn paid a unit up front; it also pays for the model tokens it used.
            guard.spendTokens(req, tokensOf(body));
        }
        res.status(response.status).json(body);
    });

    // Saved through the UAG, like the claim: the form's actions run on the server.
    router.post(`${BASE}{/project/:projectId}/form/:formId/submission`, ownForm, guard.protect('submit'), async (req, res) => {
        const data = req.body?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            res.status(400).json({ error: 'No request was sent.' });
            return;
        }
        try {
            const response = await uag.submit(await formio.pathOf(FORM), data, { requestId: sessions.requestId(req.session) });
            const body = await response.json().catch(() => ({}));
            if (response.ok && body._id) {
                flow.own(req.session, body._id, FORM);
                // A new conversation for the next request.
                req.session.chat.turns = 0;
            }
            res.status(response.status).json(body);
        }
        catch (err) {
            res.status(502).json({ error: 'The request could not be saved. Please try again.' });
        }
    });

    // Rate-limited like a turn (it costs nothing), so starting over cannot get round the length limit's purpose.
    router.post('/api/conversation/reset', guard.protect('chat', 0), (req, res) => {
        req.session.chat = { turns: 0 };
        res.json({ ok: true });
    });
}
