/**
 * Conversation forms: a chat whose questions come entirely from a form.
 *
 * This code knows nothing about service requests. It never names a field, a
 * validation rule or an option value: Claude discovers all of that through the
 * UAG's MCP tools, which read it out of the form JSON. Edit the form and the
 * conversation changes with it.
 *
 * Because the site is public, the chat is narrower than an internal one would
 * be. It runs with the project key, so it is offered only the tools that fill
 * in a form (never find_submissions or submission_update, which could read or
 * change another visitor's records), and only the forms in CHAT_FORMS.
 */
import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';

const TOOLS = new Set([
    'get_forms', 'get_form_fields', 'get_field_info',
    'collect_field_data', 'confirm_form_submission', 'submit_completed_form',
]);

/**
 * The only prompt in this application. It describes a process, not a form:
 * which tools to use and in what order, and how to behave while asking.
 */
export const SYSTEM_PROMPT = `You are a friendly intake assistant for a service company. You help a customer complete a request over chat.

Follow this process, using the tools available to you:

1. Call \`get_forms\` to see which forms exist, and pick the one that matches what the customer wants. Never assume a form exists without checking.
2. Call \`get_form_fields\` for that form to learn exactly which fields it has.
3. Call \`get_field_info\` before asking about a field so you know its type, whether it is required, its validation rules, and — for choice fields — the exact allowed values.
4. Ask the customer for the information conversationally, ONE question at a time. Never present a wall of questions, and never show raw field keys, JSON, or tool names to the customer.
5. For choice fields, offer the available options in plain language rather than asking an open question.
6. Use \`collect_field_data\` to record what the customer tells you as you go. A single message may answer several fields at once; capture all of it.
7. If a value fails validation, explain the problem in plain language and ask again. Do not invent a value on the customer's behalf, and never make up data to fill a required field.
8. Skip optional fields if the customer does not want to answer them.
9. When every required field is collected, call \`confirm_form_submission\` and show the customer a short summary, then ask them to confirm.
10. Only after the customer confirms, call \`submit_completed_form\`. Then tell them it was submitted successfully.

Keep replies short — two or three sentences at most. Be warm but efficient. If the customer asks something unrelated to the request, answer briefly and steer back to the next question.`;

/** Drop the forms outside `allowed` from get_forms' markdown, keeping its layout. */
export function filterFormList(text, allowed) {
    const lines = text.split('\n');
    const kept = [];
    let keep = true;
    let count = 0;
    for (const line of lines) {
        const entry = /^-\s+.+?\s+\(\*\*(.+?)\*\*\)/.exec(line);
        if (entry) {
            keep = allowed.includes(entry[1]);
            if (keep) count++;
        }
        else if (!/^\s+-/.test(line)) {
            keep = true;
        }
        if (keep) kept.push(line);
    }
    return kept.join('\n').replace(/^Total forms \(\d+ total\)/m, `Total forms (${count} total)`);
}

/** The forms in get_forms' markdown, as `{ title, name }`. */
export function parseForms(text) {
    const forms = [];
    const pattern = /^-\s+(.+?)\s+\(\*\*(.+?)\*\*\)/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) forms.push({ title: match[1].trim(), name: match[2].trim() });
    return forms;
}

/**
 * The history to keep: the most recent turns that fit in `maxChars`, starting
 * at a message the customer typed, so no tool result is left without the call
 * it answers.
 */
export function trimHistory(messages, maxChars) {
    const size = (message) => JSON.stringify(message.content).length;
    let total = messages.reduce((sum, message) => sum + size(message), 0);
    let start = 0;
    while (total > maxChars && start < messages.length - 1) {
        total -= size(messages[start]);
        start++;
        // Skip ahead to the next message the customer typed.
        while (start < messages.length - 1 && !(messages[start].role === 'user' && typeof messages[start].content === 'string')) {
            total -= size(messages[start]);
            start++;
        }
    }
    return start ? messages.slice(start) : messages;
}

function textOf(result) {
    return (result?.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

export function conversationRoutes(router, { config, uag, formio, flow, sessions, guard }) {
    const anthropic = new Anthropic({ apiKey: config.chat.apiKey || 'unset' });
    const allowed = config.chat.forms;

    async function callTool(mcp, block) {
        if (!TOOLS.has(block.name)) {
            return { text: `The tool "${block.name}" is not available in this demo.`, isError: true };
        }
        const form = block.input?.form_name;
        if (form !== undefined && !allowed.includes(form)) {
            return { text: `The form "${form}" is not available in this demo. Call get_forms to see the forms you can use.`, isError: true };
        }
        const result = await mcp.callTool({ name: block.name, arguments: block.input || {} });
        let text = textOf(result);
        if (block.name === 'get_forms') text = filterFormList(text, allowed);
        return { text, isError: !!result.isError };
    }

    /**
     * One turn: send the history to Claude, run its tool calls against the UAG,
     * until it answers in text. Each model call is charged by the tokens it
     * used, and the turn stops when the visitor goes away (`signal`). It
     * writes to `chat`, the conversation it began in: one the visitor started
     * over while it ran is no longer the session's.
     */
    async function runTurn(session, chat, message, req, signal) {
        const requestId = sessions.requestId(session);
        const mcp = await uag.mcp(requestId, 'uag-demo-conversation');
        const tools = [];
        let submission = null;
        // Work on a copy, so a failed turn leaves the history as it was.
        const messages = trimHistory([...chat.messages, { role: 'user', content: message }], config.chat.maxHistoryChars);
        const finish = (reply) => {
            chat.messages = messages;
            return { reply, tools, submission, run: requestId };
        };
        try {
            const listed = (await mcp.listTools()).tools.filter((tool) => TOOLS.has(tool.name));
            const claudeTools = listed.map((tool) => ({ name: tool.name, description: tool.description || '', input_schema: tool.inputSchema }));
            for (let iteration = 0; iteration < config.chat.maxToolIterations; iteration++) {
                const response = await anthropic.messages.create({
                    model: config.chat.model,
                    max_tokens: config.chat.maxTokens,
                    system: SYSTEM_PROMPT,
                    messages,
                    tools: claudeTools,
                }, { signal });
                messages.push({ role: 'assistant', content: response.content });
                const usage = response.usage || {};
                const tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_creation_input_tokens || 0);
                if (!guard.spendTokens(req, tokens) && response.stop_reason === 'tool_use') {
                    // The day's budget ran out mid-turn: stop before the next model call.
                    messages.pop();
                    return finish('The live demo has reached its limit for today. It resets at midnight UTC.');
                }
                if (response.stop_reason !== 'tool_use') return finish(textOf(response).trim() || '(no reply)');
                signal?.throwIfAborted();
                const results = [];
                for (const block of response.content.filter((item) => item.type === 'tool_use')) {
                    let outcome;
                    try {
                        outcome = await callTool(mcp, block);
                    }
                    catch (err) {
                        outcome = { text: `Tool execution failed: ${err.message}`, isError: true };
                    }
                    tools.push({ name: block.name, ok: !outcome.isError });
                    if (block.name === 'submit_completed_form' && !outcome.isError) {
                        const id = /\*\*Submission ID\*\*[^:]*:\s*([a-f0-9]{24})/i.exec(outcome.text)?.[1];
                        if (id) {
                            flow.own(session, id, block.input.form_name);
                            const saved = await formio.submission(block.input.form_name, id).catch(() => null);
                            submission = { form: block.input.form_name, id, data: saved?.ok ? saved.body.data : null };
                        }
                    }
                    results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.text || '(empty)', is_error: outcome.isError });
                }
                messages.push({ role: 'user', content: results });
            }
            return finish('I got stuck working on that. Could you rephrase your last message?');
        }
        finally {
            await mcp.close().catch(() => {});
        }
    }

    // Every visitor's page polls this; the UAG is asked at most once every 30 seconds,
    // and once for all the polls that arrive while it is being asked.
    let formsCache = null;
    let formsPending = null;
    async function listForms() {
        let mcp;
        try {
            // Not attributed to the visitor: the page polls this, and it would crowd their flow view.
            mcp = await uag.mcp(`demo-forms.${randomBytes(4).toString('hex')}`, 'uag-demo-forms');
            const forms = parseForms(textOf(await mcp.callTool({ name: 'get_forms', arguments: {} }))).filter((form) => allowed.includes(form.name));
            formsCache = { forms, expires: Date.now() + 30_000 };
            return forms;
        }
        finally {
            // Closed in the background, so the answer does not wait on it.
            mcp?.close().catch(() => {});
        }
    }

    router.get('/api/conversation/forms', async (req, res) => {
        if (formsCache && formsCache.expires > Date.now()) {
            res.json({ forms: formsCache.forms });
            return;
        }
        try {
            formsPending ||= listForms().finally(() => { formsPending = null; });
            res.json({ forms: await formsPending });
        }
        catch (err) {
            console.error('Listing forms failed:', err.message);
            res.status(502).json({ error: 'The UAG could not be reached.' });
        }
    });

    router.post('/api/conversation/chat', (req, res, next) => {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!message) {
            res.status(400).json({ error: 'Type a message first.' });
            return;
        }
        if (message.length > config.chat.maxMessageLength) {
            res.status(400).json({ error: `Messages are limited to ${config.chat.maxMessageLength} characters in this demo.` });
            return;
        }
        if (req.session.chat.turns >= config.chat.maxTurns) {
            res.status(429).json({ error: 'This conversation has reached the demo\'s length limit. Start a new one to keep going.', code: 'conversation_limit' });
            return;
        }
        if (req.session.chat.busy) {
            res.status(409).json({ error: 'Still working on your last message.' });
            return;
        }
        req.message = message;
        next();
    }, guard.protect('chat'), async (req, res) => {
        const session = req.session;
        const chat = session.chat;
        chat.busy = true;
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableFinished) abort.abort(); });
        try {
            const result = await runTurn(session, chat, req.message, req, abort.signal);
            chat.turns++;
            res.json(result);
        }
        catch (err) {
            if (abort.signal.aborted) return;
            console.error('Chat turn failed:', err.message);
            res.status(502).json({ error: 'The assistant ran into a problem. Please try again.' });
        }
        finally {
            chat.busy = false;
        }
    });

    router.post('/api/conversation/reset', (req, res) => {
        req.session.chat = { messages: [], turns: 0 };
        res.json({ ok: true });
    });
}
