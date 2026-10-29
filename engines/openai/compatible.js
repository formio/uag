/**
 * The OpenAI-compatible core of the UAG's agent engines: structured extraction
 * and research over a chat completions API, shared by `@formio/uag-openai` and
 * the provider packages built on it (Grok and Gemini; MAI, not yet released).
 *
 *   const { openAICompatible } = require('@formio/uag-openai/compatible');
 *   module.exports = openAICompatible({
 *       type: 'acme',
 *       description: 'Acme models, through their OpenAI-compatible API.',
 *       baseURL: 'https://api.acme.example/v1',
 *       apiKey: { env: 'ACME_API_KEY' },
 *       model: { env: 'ACME_MODEL' },
 *   });
 *
 * How an answer is constrained depends on what the server supports
 * (`structuredOutput`):
 *
 *   json_schema  a strict JSON schema response format
 *   json_object  a JSON object response format, with the schema in the prompt
 *   prompt       the schema in the prompt only
 *
 * When the UAG passes read-only tools (a task that enables research), the
 * engine first runs a function-calling loop over them - calls go through the
 * UAG's `callTool`, which enforces the task's tool list and the caller's
 * permissions - and then asks for the same answer with tools turned off.
 */
const { defineEngine, EngineConfigError, EngineError, ENGINE_API_VERSION, parseJsonObject, requiredSchema, toolResultText } = require('@formio/uag-sdk');

const MODES = ['json_schema', 'json_object', 'prompt'];

function isEmpty(value) {
    return value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
}

/** Refuse an unknown structured-output mode at startup. */
function checkMode(name, mode) {
    if (!MODES.includes(mode)) {
        throw new EngineConfigError(`The "${name}" engine's structuredOutput setting must be one of ${MODES.join(', ')}, not ${JSON.stringify(mode)}.`);
    }
    return mode;
}

/** OpenAI's own API, the only server that gets OpenAI's own settings from the environment. */
function isOpenAI(baseURL) {
    try {
        return new URL(baseURL).hostname === 'api.openai.com';
    }
    catch {
        return false;
    }
}

/** The header names in OPENAI_CUSTOM_HEADERS (`Name: value` lines), as the SDK reads them. */
function customHeaderNames(value) {
    return String(value || '').split('\n').filter((line) => line.includes(':')).map((line) => line.slice(0, line.indexOf(':')).trim()).filter(Boolean);
}

/**
 * An OpenAI SDK client. Retries stay small: the UAG's routing timeout aborts the
 * request (through the signal) and falls back to the next engine before retries
 * pile up.
 *
 * The SDK reads OpenAI's own settings from the environment (OPENAI_ORG_ID,
 * OPENAI_PROJECT_ID, OPENAI_CUSTOM_HEADERS) and sends them with every request.
 * They are OpenAI's, so any other server (Grok, Gemini, a local model) gets
 * none of them. `apiKey: null` sends no Authorization header, for a server
 * that needs no key or takes it in another header.
 */
function openAIClient({ apiKey, baseURL, defaultHeaders, fetch }) {
    const { OpenAI } = require('openai');
    const headers = { ...(defaultHeaders || {}) };
    const openAI = isOpenAI(baseURL);
    if (!openAI) {
        const own = new Set(Object.keys(headers).map((header) => header.toLowerCase()));
        for (const header of customHeaderNames(process.env.OPENAI_CUSTOM_HEADERS)) {
            if (!own.has(header.toLowerCase())) headers[header] = null;
        }
    }
    if (!apiKey) headers.Authorization = null;
    return new OpenAI({
        // The SDK will not start without a key, even when none is sent.
        apiKey: apiKey || 'unused',
        // Always explicit, so the SDK never falls back to OPENAI_BASE_URL for an
        // instance that was configured without it.
        baseURL,
        ...(!openAI && { organization: null, project: null }),
        // Never read from the environment: these engines only use `apiKey`.
        adminAPIKey: null,
        webhookSecret: null,
        ...(Object.keys(headers).length && { defaultHeaders: headers }),
        // Tests pass a fetch to see exactly what is sent, without the network.
        ...(fetch && { fetch }),
        maxRetries: 2,
        // The SDK refuses to start in a "browser-like environment". Inside the
        // UAG, Form.io's libraries install `window`/`document` shims, so allow it
        // only when actually running on Node; a real browser is still refused.
        dangerouslyAllowBrowser: typeof process !== 'undefined' && !!(process.versions && process.versions.node)
    });
}

/** End the attempt as an engine failure when the answer is unusable, so routing can fall back. */
function checkChoice(choice) {
    if (!choice || !choice.message) {
        throw new EngineError('The model returned no answer.');
    }
    if (choice.message.refusal) {
        throw new EngineError('The model declined the request.');
    }
    if (choice.finish_reason === 'length') {
        throw new EngineError('The model stopped at the token limit before finishing the answer.');
    }
    if (choice.finish_reason === 'content_filter') {
        throw new EngineError('The model\'s content filter stopped the answer.');
    }
    return choice.message;
}

/** How a string format reads in a field's description, instead of as a schema constraint. */
const FORMAT_WORDING = {
    date: 'Write it as a date, YYYY-MM-DD.',
    'date-time': 'Write it as an ISO 8601 date and time, such as 2026-10-22T14:30:00Z.',
    time: 'Write it as a time, HH:MM:SS.',
    email: 'Write it as an email address.',
    uri: 'Write it as a URL.',
};

/**
 * The schema with every string `format` and `pattern` moved into the property's
 * description. OpenAI's strict mode enforces those constraints in a way that
 * corrupts dates (the year comes out as 1000, 1010, 3362 ...). A server that
 * enforces them also rules out the empty "not stated" answer every field is
 * allowed, so the model must invent a value (Grok answers a policy number
 * pattern with POL-000000). The same requirement in words is followed, and the
 * UAG validates every value afterwards.
 */
function describeFormats(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
    const out = { ...schema };
    const notes = [];
    if (typeof out.format === 'string') {
        notes.push(FORMAT_WORDING[out.format] || `Write it in the "${out.format}" format.`);
        delete out.format;
    }
    if (typeof out.pattern === 'string') {
        notes.push(`It must match the regular expression ${out.pattern}.`);
        delete out.pattern;
    }
    if (notes.length) {
        out.description = [out.description, ...notes].filter(Boolean).join(' ');
    }
    if (out.properties) {
        out.properties = Object.fromEntries(Object.entries(out.properties).map(([key, value]) => [key, describeFormats(value)]));
    }
    if (out.items) {
        out.items = describeFormats(out.items);
    }
    return out;
}

/** The prompt describing the information and the fields, and how to answer in each mode. */
function prompt(request, mode) {
    const lines = [
        'Information:',
        JSON.stringify(request.state, null, 2),
        '',
        'Fields to fill in (path, label, rule, format and allowed options):',
        JSON.stringify(request.fields, null, 2),
        '',
    ];
    if (mode === 'json_schema') {
        lines.push('Return one JSON object keyed by field path. For a field the information does not support, give an empty string, or an empty list for a list.');
    }
    else {
        lines.push(
            'Respond with only one JSON object keyed by field path, matching this JSON schema, and nothing else. Leave out any field the information does not support.',
            JSON.stringify(request.schema)
        );
    }
    return lines.join('\n');
}

/**
 * Run one tool call through the UAG's `callTool`. A call that throws, other
 * than because the request was aborted, goes back to the model as a tool error
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

/**
 * An agent engine over a chat completions client. It never sends `max_tokens`,
 * which reasoning models and some providers refuse; the server's own limit
 * applies.
 */
function agentEngine({ name, model, client, mode, reasoningEffort, formatsInWords = false }) {
    /** One chat completion, counted into `usage`. */
    async function complete(params, signal, usage) {
        if (signal) signal.throwIfAborted();
        const completion = await client.chat.completions.create({
            model,
            ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
            ...params
        }, { signal });
        if (completion && completion.usage) {
            usage.counted = true;
            usage.inputTokens += completion.usage.prompt_tokens || 0;
            usage.outputTokens += completion.usage.completion_tokens || 0;
        }
        return completion;
    }

    /**
     * Look up what the fields need with the read-only tools, appending every
     * turn to `messages`. Stops when the model stops calling tools, or at the
     * iteration limit.
     */
    async function research(request, tools, messages, usage) {
        const toolCalls = [];
        messages[1].content += '\n\nYou may first call the listed tools to look up information the fields need. The tools only read; nothing you do is saved.';
        for (let iteration = 0; iteration < (request.maxIterations || 10); iteration++) {
            const completion = await complete({ messages, tools }, request.signal, usage);
            const message = checkChoice(completion.choices && completion.choices[0]);
            const calls = (message.tool_calls || []).filter((call) => call.function);
            messages.push({ role: 'assistant', content: message.content ?? null, ...(calls.length && { tool_calls: calls }) });
            if (!calls.length) {
                break;
            }
            // Run the calls of one turn concurrently, and return every result,
            // recording the calls in the order the model made them.
            const results = await Promise.all(calls.map(async (call) => {
                let args;
                try {
                    args = JSON.parse(call.function.arguments || '{}');
                }
                catch {
                    args = undefined;
                }
                if (!args || typeof args !== 'object' || Array.isArray(args)) {
                    return { message: { role: 'tool', tool_call_id: call.id, content: 'Error: the arguments were not a JSON object. Call the tool again with a JSON object.' } };
                }
                const result = await runTool(request, call.function.name, args);
                const text = toolResultText(result);
                return {
                    call: { name: call.function.name, isError: !!result.isError },
                    message: { role: 'tool', tool_call_id: call.id, content: result.isError ? `Error: ${text}` : text }
                };
            }));
            for (const { call, message: result } of results) {
                if (call) toolCalls.push(call);
                messages.push(result);
            }
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
            const strict = requiredSchema(request.schema);
            const messages = [
                { role: 'system', content: request.instructions },
                { role: 'user', content: prompt(request, mode) },
            ];
            const usage = { inputTokens: 0, outputTokens: 0, counted: false };
            const tools = (request.tools || []).map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
            }));
            const toolCalls = tools.length ? await research(request, tools, messages, usage) : undefined;
            const completion = await complete({
                messages,
                // The tools stay declared because the history may hold tool calls.
                ...(tools.length && { tools, tool_choice: 'none' }),
                ...(mode === 'json_schema' && { response_format: { type: 'json_schema', json_schema: { name: 'fields', strict: true, schema: formatsInWords ? describeFormats(strict.schema) : strict.schema } } }),
                ...(mode === 'json_object' && { response_format: { type: 'json_object' } })
            }, request.signal, usage);
            const message = checkChoice(completion.choices && completion.choices[0]);
            const answer = parseJsonObject(message.content || '');
            // A strict answer is in the encoded schema; a prompted one in the UAG's own types.
            const decoded = mode === 'json_schema' ? strict.decode(answer) : answer;
            // Only the fields asked, whatever the model answered.
            const asked = new Set(Object.keys((request.schema && request.schema.properties) || {}));
            const values = Object.fromEntries(Object.entries(decoded).filter(([path, value]) => asked.has(path) && !isEmpty(value)));
            return {
                model: completion.model || model,
                values,
                ...(usage.counted && { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }),
                ...(toolCalls && { toolCalls })
            };
        }
    };
}

/** The text of a Responses API answer, or an engine failure when there is none. */
function responseText(response) {
    if (response.status === 'incomplete') {
        const reason = response.incomplete_details && response.incomplete_details.reason;
        throw new EngineError(reason === 'max_output_tokens'
            ? 'The model stopped at the token limit before finishing the answer.'
            : reason === 'content_filter'
                ? 'The model\'s content filter stopped the answer.'
                : 'The model did not finish the answer.');
    }
    const parts = (response.output || []).filter((item) => item.type === 'message').flatMap((item) => item.content || []);
    if (parts.some((part) => part.type === 'refusal')) {
        throw new EngineError('The model declined the request.');
    }
    return parts.filter((part) => part.type === 'output_text').map((part) => part.text).join('');
}

/**
 * An agent engine on OpenAI's Responses API, which allows function tools while
 * a model reasons (Chat Completions does not). Nothing is stored at OpenAI
 * (`store: false`); the model's reasoning carries across research turns as
 * encrypted reasoning items in the history.
 */
function responsesAgentEngine({ name, model, client, mode, reasoningEffort, formatsInWords = false }) {
    /** One response, counted into `usage`. */
    async function respond(params, signal, usage) {
        if (signal) signal.throwIfAborted();
        const response = await client.responses.create({
            model,
            store: false,
            include: ['reasoning.encrypted_content'],
            ...(reasoningEffort && { reasoning: { effort: reasoningEffort } }),
            ...params
        }, { signal });
        if (response && response.usage) {
            usage.counted = true;
            usage.inputTokens += response.usage.input_tokens || 0;
            usage.outputTokens += response.usage.output_tokens || 0;
        }
        return response;
    }

    return {
        name,
        kind: 'agent',
        apiVersion: ENGINE_API_VERSION,
        model,
        toolUse: true,

        async extract(request) {
            const strict = requiredSchema(request.schema);
            const tools = (request.tools || []).map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
                // The UAG's tool schemas are not written for strict mode.
                strict: false,
            }));
            const input = [{ role: 'user', content: prompt(request, mode) }];
            const usage = { inputTokens: 0, outputTokens: 0, counted: false };
            const toolCalls = [];
            if (tools.length) {
                input[0].content += '\n\nYou may first call the listed tools to look up information the fields need. The tools only read; nothing you do is saved.';
                for (let iteration = 0; iteration < (request.maxIterations || 10); iteration++) {
                    const response = await respond({ instructions: request.instructions, input, tools }, request.signal, usage);
                    responseText(response);
                    // The whole output goes back: reasoning items, messages and calls.
                    input.push(...(response.output || []));
                    const calls = (response.output || []).filter((item) => item.type === 'function_call');
                    if (!calls.length) {
                        break;
                    }
                    // Run the calls of one turn concurrently, and return every result,
                    // recording the calls in the order the model made them.
                    const results = await Promise.all(calls.map(async (call) => {
                        let args;
                        try {
                            args = JSON.parse(call.arguments || '{}');
                        }
                        catch {
                            args = undefined;
                        }
                        if (!args || typeof args !== 'object' || Array.isArray(args)) {
                            return { output: { type: 'function_call_output', call_id: call.call_id, output: 'Error: the arguments were not a JSON object. Call the tool again with a JSON object.' } };
                        }
                        const result = await runTool(request, call.name, args);
                        const text = toolResultText(result);
                        return {
                            call: { name: call.name, isError: !!result.isError },
                            output: { type: 'function_call_output', call_id: call.call_id, output: result.isError ? `Error: ${text}` : text }
                        };
                    }));
                    for (const { call, output } of results) {
                        if (call) toolCalls.push(call);
                        input.push(output);
                    }
                }
                input.push({ role: 'user', content: 'Now give the answer: one JSON object keyed by field path.' });
            }
            const response = await respond({
                instructions: request.instructions,
                input,
                // The tools stay declared because the history may hold tool calls.
                ...(tools.length && { tools, tool_choice: 'none' }),
                ...(mode === 'json_schema' && { text: { format: { type: 'json_schema', name: 'fields', strict: true, schema: formatsInWords ? describeFormats(strict.schema) : strict.schema } } }),
                ...(mode === 'json_object' && { text: { format: { type: 'json_object' } } })
            }, request.signal, usage);
            const answer = parseJsonObject(responseText(response));
            // A strict answer is in the encoded schema; a prompted one in the UAG's own types.
            const decoded = mode === 'json_schema' ? strict.decode(answer) : answer;
            // Only the fields asked, whatever the model answered.
            const asked = new Set(Object.keys((request.schema && request.schema.properties) || {}));
            const values = Object.fromEntries(Object.entries(decoded).filter(([path, value]) => asked.has(path) && !isEmpty(value)));
            return {
                model: response.model || model,
                values,
                ...(usage.counted && { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } }),
                ...(tools.length && { toolCalls })
            };
        }
    };
}

/**
 * An agent engine type for a provider with an OpenAI-compatible API.
 *
 * - `type`, `description`: the type's name and what it is.
 * - `baseURL`: the provider's API, or a function `(settings, requireSetting)`
 *   that returns it. Every instance can override it with its `baseURL` setting.
 * - `apiKey`, `model`: the variables (`env`) for the key and the model, which
 *   are both required and have no default.
 * - `apiKeyHeader`: send the key in this header instead of as a bearer token.
 * - `settings`: more settings the type needs, such as an endpoint.
 * - `structuredOutput`: the default structured-output mode.
 * - `reasoningEffort`: the variable for `reasoning_effort`, for providers that take it.
 * - `formatsInWords`: false to send string formats and patterns as schema
 *   constraints rather than in words (see `describeFormats`). Default true.
 */
function openAICompatible(provider) {
    const settings = {
        ...(provider.settings || {}),
        apiKey: { env: provider.apiKey.env, required: true, secret: true },
        model: { env: provider.model.env, required: true, description: provider.model.description || 'A dated model version. There is no default.' },
        baseURL: { env: provider.baseURLEnv, description: 'Override the provider\'s API URL, for a proxy or a regional endpoint.' },
        structuredOutput: { env: provider.structuredOutputEnv, default: provider.structuredOutput || 'json_schema', description: 'json_schema, json_object or prompt.' },
        ...(provider.reasoningEffort && { reasoningEffort: { env: provider.reasoningEffort.env, description: 'Sent as reasoning_effort, for models that take it.' } }),
    };
    for (const spec of Object.values(settings)) {
        if (spec.env === undefined) delete spec.env;
    }
    return defineEngine({
        type: provider.type,
        kinds: ['agent'],
        apiVersion: ENGINE_API_VERSION,
        description: provider.description,
        settings,
        create({ name, settings: resolved, options, requireSetting }) {
            const mode = checkMode(name, resolved.structuredOutput);
            const baseURL = resolved.baseURL || (typeof provider.baseURL === 'function' ? provider.baseURL(resolved, requireSetting) : provider.baseURL);
            const client = options.client || openAIClient({
                // With a custom header, no bearer token is sent.
                apiKey: provider.apiKeyHeader ? null : resolved.apiKey,
                baseURL,
                ...(provider.apiKeyHeader && { defaultHeaders: { [provider.apiKeyHeader]: resolved.apiKey } }),
                fetch: options.fetch,
            });
            return agentEngine({ name, model: resolved.model, client, mode, reasoningEffort: resolved.reasoningEffort, formatsInWords: provider.formatsInWords !== false });
        },
    });
}

module.exports = { MODES, checkMode, isOpenAI, openAIClient, agentEngine, responsesAgentEngine, describeFormats, openAICompatible };
