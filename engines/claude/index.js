/**
 * Claude agent engine for the UAG Agent API.
 *
 *   UAG_ENGINES=claude                 CLAUDE_API_KEY=...
 *   UAG_ENGINES=fast:claude,deep:claude
 *     UAG_ENGINE_FAST_MODEL=claude-haiku-5-5   UAG_ENGINE_DEEP_MODEL=claude-opus-5-5
 *
 * extract() makes one call with structured outputs (`output_config.format`),
 * so the answer is valid JSON for the requested fields. When the UAG passes
 * read-only tools (a task that enables research), it first runs a tool-use
 * loop over them - calls go through the UAG's `callTool`, which enforces the
 * task's tool list and the caller's permissions - and then asks for the same
 * structured answer with tools turned off.
 */
const { defineEngine, EngineConfigError, EngineError, ENGINE_API_VERSION, requiredSchema, toolResultText } = require('@formio/uag-sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The text of a response, from its text blocks. */
function textOf(message) {
    return (message.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
}

/** A refusal ends the attempt as an engine failure, so routing can fall back. */
function assertNotRefused(message) {
    if (message.stop_reason === 'refusal') {
        const category = message.stop_details && message.stop_details.category;
        throw new EngineError(`Claude declined the request${category ? ` (${category})` : ''}.`);
    }
}

/**
 * Run one tool call through the UAG's `callTool`. A call that throws, other
 * than because the request was aborted, goes back to Claude as a tool error
 * instead of failing the extraction.
 */
async function runTool(request, name, args) {
    try {
        return await request.callTool(name, args);
    }
    catch (err) {
        if (request.signal && request.signal.aborted) throw err;
        return { content: [{ type: 'text', text: 'The tool call failed.' }], isError: true };
    }
}

function checkEffort(name, key, value) {
    if (!EFFORTS.includes(value)) {
        throw new EngineConfigError(`The "${name}" engine's ${key} setting must be one of ${EFFORTS.join(', ')}, not ${JSON.stringify(value)}.`);
    }
    return value;
}

module.exports = defineEngine({
    type: 'claude',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    description: 'Claude: structured extraction, with research over read-only tools.',
    settings: {
        apiKey: { env: ['CLAUDE_API_KEY', 'ANTHROPIC_API_KEY'], required: true, secret: true },
        model: { env: 'CLAUDE_MODEL', default: DEFAULT_MODEL },
        effort: { env: 'CLAUDE_EFFORT', default: 'low', description: 'Effort for extraction.' },
        researchEffort: { env: 'CLAUDE_RESEARCH_EFFORT', default: 'medium', description: 'Effort for research with tools.' },
        fallbacks: { env: 'CLAUDE_FALLBACKS', default: 'default', description: '"default" re-runs a refused request on a fallback model server-side; "off" turns that off.' },
    },
    create({ name, settings, options }) {
        const { model } = settings;
        const extractEffort = checkEffort(name, 'effort', settings.effort);
        const researchEffort = checkEffort(name, 'researchEffort', settings.researchEffort);
        if (!['default', 'off'].includes(settings.fallbacks)) {
            throw new EngineConfigError(`The "${name}" engine's fallbacks setting must be "default" or "off", not ${JSON.stringify(settings.fallbacks)}.`);
        }
        const fallbacks = settings.fallbacks === 'default';

        let client = options.client;
        if (!client) {
            const Anthropic = require('@anthropic-ai/sdk');
            const AnthropicClass = Anthropic.default || Anthropic;
            // Retries stay small: the UAG's routing timeout aborts the request (via
            // the signal) and falls back to the next engine before retries pile up.
            client = new AnthropicClass({
                apiKey: settings.apiKey,
                maxRetries: 2,
                // The SDK refuses to start in a "browser-like environment". Inside
                // the UAG, Form.io's libraries install `window`/`document` shims,
                // so allow it only when actually running on Node; a real browser is
                // still refused.
                dangerouslyAllowBrowser: typeof process !== 'undefined' && !!(process.versions && process.versions.node)
            });
        }

        /** One Messages call, with the server-side refusal fallback unless turned off. */
        function create(params, signal) {
            if (signal) signal.throwIfAborted();
            const body = { model, max_tokens: MAX_TOKENS, ...params };
            if (fallbacks) {
                return client.beta.messages.create({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal });
            }
            return client.messages.create(body, { signal });
        }

        /**
         * Look up what the fields need with the read-only tools, appending every
         * turn to `messages` (append-only, thinking blocks included). Stops when
         * Claude stops calling tools, or at the iteration limit.
         */
        async function research(request, tools, messages, count) {
            const toolCalls = [];
            messages[0].content += '\n\nYou may first call the listed tools to look up information the fields need. The tools only read; nothing you do is saved.';
            for (let iteration = 0; iteration < (request.maxIterations || 10); iteration++) {
                const message = await create({
                    system: request.instructions,
                    messages,
                    tools,
                    output_config: { effort: researchEffort }
                }, request.signal);
                count(message);
                assertNotRefused(message);
                // A turn cut off at the token limit may end in a tool call with no
                // result, which the API refuses on the next call.
                if (message.stop_reason === 'max_tokens') {
                    throw new EngineError('Claude stopped at the token limit while researching.');
                }
                messages.push({ role: 'assistant', content: message.content });
                if (message.stop_reason === 'pause_turn') {
                    continue;
                }
                if (message.stop_reason !== 'tool_use') {
                    break;
                }
                const uses = message.content.filter((block) => block.type === 'tool_use');
                // Run the calls of one turn concurrently, and return every result in
                // one message, recording the calls in the order Claude made them.
                const results = await Promise.all(uses.map(async (use) => {
                    const result = await runTool(request, use.name, use.input || {});
                    return { type: 'tool_result', tool_use_id: use.id, content: toolResultText(result), ...(result.isError && { is_error: true }) };
                }));
                uses.forEach((use, i) => toolCalls.push({ name: use.name, isError: !!results[i].is_error }));
                messages.push({ role: 'user', content: results });
            }
            messages.push({ role: 'user', content: 'Now give the answer: one JSON object keyed by field path.' });
            return toolCalls;
        }

        return {
            name,
            kind: 'agent',
            apiVersion: ENGINE_API_VERSION,
            model,
            toolUse: true,

            async extract(request) {
                const { schema, decode } = requiredSchema(request.schema);
                const messages = [{
                    role: 'user',
                    content: [
                        'Information:',
                        JSON.stringify(request.state, null, 2),
                        '',
                        'Fields to fill in (path, label, rule, format and allowed options):',
                        JSON.stringify(request.fields, null, 2),
                        '',
                        'Return one JSON object keyed by field path. For a field the information does not support, give an empty string, or an empty list for a list.'
                    ].join('\n')
                }];
                const usage = { inputTokens: 0, outputTokens: 0 };
                const count = (message) => {
                    usage.inputTokens += (message.usage && message.usage.input_tokens) || 0;
                    usage.outputTokens += (message.usage && message.usage.output_tokens) || 0;
                };
                const tools = (request.tools || []).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
                const toolCalls = tools.length ? await research(request, tools, messages, count) : undefined;
                // The answer: structured output, with tools turned off. The tools stay
                // declared because the history may hold tool_use and tool_result blocks.
                const message = await create({
                    system: request.instructions,
                    messages,
                    ...(tools.length && { tools, tool_choice: { type: 'none' } }),
                    output_config: {
                        effort: extractEffort,
                        format: { type: 'json_schema', schema }
                    }
                }, request.signal);
                count(message);
                assertNotRefused(message);
                if (message.stop_reason === 'max_tokens') {
                    throw new EngineError('Claude stopped at the token limit before finishing the answer.');
                }
                let answer;
                try {
                    answer = JSON.parse(textOf(message) || '{}');
                }
                catch {
                    throw new EngineError('Claude did not return valid JSON.');
                }
                // Only the fields asked: the schema should ensure it, but never pass on more.
                const asked = new Set(Object.keys((request.schema && request.schema.properties) || {}));
                const values = Object.fromEntries(Object.entries(decode(answer)).filter(([path]) => asked.has(path)));
                const single = message.usage && { inputTokens: message.usage.input_tokens ?? null, outputTokens: message.usage.output_tokens ?? null };
                return {
                    model: message.model || model,
                    values,
                    ...(tools.length ? { usage } : single && { usage: single }),
                    ...(toolCalls && { toolCalls })
                };
            }
        };
    },
});
