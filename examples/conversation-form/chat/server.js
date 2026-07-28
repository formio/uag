/**
 * A minimal chat application driven entirely by a Form.io form.
 *
 * This server knows nothing about service requests. It never mentions a field
 * name, a validation rule, or an option value. All of that is discovered at
 * runtime through the UAG's MCP tools, which read it out of the form JSON. Edit
 * the form and the conversation changes with it.
 *
 * The MCP client runs here, connecting *out* to the UAG, so the UAG does not
 * need to be publicly reachable.
 */
import 'dotenv/config';
import Express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3400', 10);
const UAG_SERVER = process.env.UAG_SERVER || 'http://formio-uag:3200';
const ADMIN_KEY = process.env.ADMIN_KEY || 'CHANGEME';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const CLAUDE_MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '4096', 10);
const MAX_TOOL_ITERATIONS = parseInt(process.env.MAX_TOOL_ITERATIONS || '15', 10);

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY || '' });

/**
 * The only prompt in this application. Note that it describes a *process*, not
 * a form: which tools to use and in what order, and how to behave while asking.
 * The subject matter comes from the form.
 */
const SYSTEM_PROMPT = `You are a friendly intake assistant for a service company. You help a customer complete a request over chat.

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

// ---------------------------------------------------------------- UAG access

let cachedToken = '';

function tokenExpired(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
        return !payload.exp || Date.now() / 1000 >= payload.exp - 60;
    }
    catch {
        return true;
    }
}

/**
 * Exchanges the server-side key for an access token using the client_credentials
 * grant. On an Open Source deployment the project name is always `formio-oss`,
 * and the UAG requires the client_id to carry that prefix.
 */
async function getToken() {
    if (cachedToken && !tokenExpired(cachedToken)) {
        return cachedToken;
    }
    const response = await fetch(`${UAG_SERVER}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: 'formio-oss-x-admin-key',
            client_secret: ADMIN_KEY,
        }),
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(
            `Could not get a token from the UAG (${response.status}). ` +
            `A 404 here usually means BASE_URL is not set on the UAG. ${detail}`
        );
    }
    const body = await response.json();
    if (!body.access_token) {
        throw new Error('The UAG did not return an access_token.');
    }
    cachedToken = body.access_token;
    return cachedToken;
}

async function connectMcp() {
    const token = await getToken();
    const client = new Client({ name: 'uag-conversation-form', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${UAG_SERVER}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return client;
}

function toToolResultContent(content) {
    if (!content || !content.length) {
        return '';
    }
    return content.map((block) => (
        block.type === 'text'
            ? { type: 'text', text: block.text }
            : { type: 'text', text: JSON.stringify(block) }
    ));
}

// ------------------------------------------------------------------ sessions

// In-memory conversation history, keyed by session id. A real application
// would persist this; keeping it in a Map keeps the example readable.
const sessions = new Map();

function getSession(id) {
    if (!sessions.has(id)) {
        sessions.set(id, { messages: [] });
    }
    return sessions.get(id);
}

/**
 * Runs one turn of the conversation: send the history to Claude, service any
 * tool calls it makes against the UAG, and repeat until it produces text.
 */
async function runTurn(session, userMessage) {
    const mcp = await connectMcp();
    const toolsUsed = [];
    try {
        const { tools } = await mcp.listTools();
        const claudeTools = tools.map((tool) => ({
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema,
        }));

        session.messages.push({ role: 'user', content: userMessage });

        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
            const response = await anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: CLAUDE_MAX_TOKENS,
                system: SYSTEM_PROMPT,
                messages: session.messages,
                tools: claudeTools,
            });

            session.messages.push({ role: 'assistant', content: response.content });

            if (response.stop_reason !== 'tool_use') {
                const text = response.content
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('\n')
                    .trim();
                return { reply: text || '(no reply)', toolsUsed };
            }

            const toolUses = response.content.filter((block) => block.type === 'tool_use');
            const results = await Promise.all(toolUses.map(async (block) => {
                toolsUsed.push(block.name);
                try {
                    const result = await mcp.callTool({ name: block.name, arguments: block.input });
                    return {
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: toToolResultContent(result.content),
                        is_error: !!result.isError,
                    };
                }
                catch (error) {
                    return {
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: `Tool execution failed: ${error.message}`,
                        is_error: true,
                    };
                }
            }));

            session.messages.push({ role: 'user', content: results });
        }

        return {
            reply: 'I got stuck working on that. Could you rephrase your last message?',
            toolsUsed,
        };
    }
    finally {
        await mcp.close().catch(() => {});
    }
}

// -------------------------------------------------------------------- server

const app = Express();
app.use(Express.json());
app.use(Express.static(path.join(__dirname, 'public')));

app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body || {};
    if (!sessionId || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'sessionId and a non-empty message are required.' });
        return;
    }
    try {
        const result = await runTurn(getSession(sessionId), message.trim());
        res.json(result);
    }
    catch (error) {
        console.error('Chat turn failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/reset', (req, res) => {
    const { sessionId } = req.body || {};
    sessions.delete(sessionId);
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`Conversation form chat running on port ${PORT} (UAG at ${UAG_SERVER})`);
});
