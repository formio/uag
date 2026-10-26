import http from 'http';

/**
 * A stand-in for the Anthropic Messages API (`POST /v1/messages`), for running
 * an example's own chat server with no key. Point the server's Anthropic SDK at
 * it with `ANTHROPIC_BASE_URL`.
 *
 * The test scripts what the model does after each user message: `respond(text,
 * steps)` registers the steps for a user message containing `text`. Each step
 * is one model response:
 *   - `{ tool, input }` calls a tool. `input` may be a function of the step
 *     context (see below);
 *   - `{ text }` replies and ends the turn. `text` may be a function of the
 *     step context.
 *
 * The step to take is found from the conversation the chat server sends: the
 * latest user text, and how many responses the model has given since. The step
 * context holds `results`, the tool results returned since that user text
 * (`{ name, text, isError }`), and `last`, the latest of them.
 *
 * Every request is recorded in `requests`.
 */
export async function startScriptedClaude({ port = 0 } = {}) {
    const scripts = [];
    const requests = [];
    let ids = 0;

    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString());
                requests.push(body);
                if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
                    throw new Error(`Unexpected request ${req.method} ${req.url}`);
                }
                const content = next(body);
                res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                    id: `msg_scripted_${++ids}`,
                    type: 'message',
                    role: 'assistant',
                    model: body.model,
                    content,
                    stop_reason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
                    stop_sequence: null,
                    usage: { input_tokens: 1, output_tokens: 1 },
                }));
            }
            catch (error) {
                res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({
                    type: 'error',
                    error: { type: 'invalid_request_error', message: `Scripted model: ${error.message}` },
                }));
            }
        });
    });

    /** The model's next response for this conversation. */
    function next({ messages }) {
        const start = messages.findLastIndex((message) => message.role === 'user' && typeof message.content === 'string');
        if (start < 0) throw new Error('no user message');
        const userText = messages[start].content;
        const script = scripts.findLast((entry) => userText.includes(entry.text));
        if (!script) throw new Error(`nothing scripted for "${userText}"`);
        const after = messages.slice(start + 1);
        const responses = after.filter((message) => message.role === 'assistant').length;
        const step = script.steps[responses];
        if (!step) throw new Error(`the script for "${script.text}" has no step ${responses + 1}`);

        const names = new Map();
        for (const message of after) {
            if (message.role !== 'assistant') continue;
            for (const block of message.content) if (block.type === 'tool_use') names.set(block.id, block.name);
        }
        const results = after
            .filter((message) => message.role === 'user' && Array.isArray(message.content))
            .flatMap((message) => message.content.filter((block) => block.type === 'tool_result'))
            .map((block) => ({
                name: names.get(block.tool_use_id),
                text: typeof block.content === 'string' ? block.content : (block.content || []).map((part) => part.text || '').join('\n'),
                isError: !!block.is_error,
            }));
        const context = { results, last: results[results.length - 1] };
        const value = (field) => (typeof field === 'function' ? field(context) : field);

        if (step.tool) {
            return [{ type: 'tool_use', id: `toolu_scripted_${++ids}`, name: step.tool, input: value(step.input) || {} }];
        }
        return [{ type: 'text', text: value(step.text) }];
    }

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });

    return {
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        respond(text, steps) {
            scripts.push({ text, steps });
        },
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}
