/**
 * OpenAI engine for the UAG Agent API: OpenAI itself, or any server that
 * implements its chat completions API (Ollama, vLLM, LM Studio, OpenRouter).
 *
 *   UAG_ENGINES=openai         OPENAI_API_KEY=...  OPENAI_MODEL=<a dated model version>
 *   UAG_ENGINES=local:openai   UAG_ENGINE_LOCAL_BASE_URL=http://ollama:11434/v1
 *                              UAG_ENGINE_LOCAL_MODEL=llama4:16x17b
 *   UAG_ENGINES=decide:openai  UAG_ENGINE_DECIDE_KIND=decision  UAG_ENGINE_DECIDE_MODEL=gpt-6-luna
 *
 * An instance is an agent engine (the default: structured extraction, with
 * research over read-only tools; see compatible.js), or, with `kind` set to
 * `decision`, a decision engine on OpenAI's Decisions API (see decisions.js).
 *
 * An agent instance talks to OpenAI through the Responses API, which allows
 * tools while a model reasons, and to any other server (`baseURL`) through
 * Chat Completions. The `api` setting overrides the choice.
 */
const { defineEngine, EngineConfigError, ENGINE_API_VERSION, settingVariable } = require('@formio/uag-sdk');
const { checkMode, isOpenAI, openAIClient, agentEngine, responsesAgentEngine } = require('./compatible');
const { decisionEngine } = require('./decisions');

const KINDS = ['agent', 'decision'];
const APIS = ['responses', 'chat'];
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** The Decisions API accepts at most 255 choices per question (measured October 2026), as Jev does. */
const MAX_OPTIONS = 255;

module.exports = defineEngine({
    type: 'openai',
    kinds: ['agent', 'decision'],
    apiVersion: ENGINE_API_VERSION,
    description: 'OpenAI: structured extraction with research over read-only tools, on OpenAI or any server with its chat completions API; or decisions with probabilities, on OpenAI\'s Decisions API.',
    settings: {
        kind: { env: 'OPENAI_KIND', default: 'agent', description: 'agent, or decision for the Decisions API.' },
        // The instance's own key, for any server. OpenAI's (OPENAI_API_KEY) is a
        // setting of its own, so it is only ever sent to OpenAI itself.
        apiKey: { secret: true, description: 'This instance\'s key, sent to its server. Required for OpenAI itself unless OPENAI_API_KEY is set.' },
        openaiApiKey: { env: 'OPENAI_API_KEY', secret: true, description: 'OpenAI\'s key, sent only to OpenAI itself, never to a baseURL server.' },
        baseURL: { env: 'OPENAI_BASE_URL', description: 'An OpenAI-compatible server, such as http://ollama:11434/v1.' },
        model: { env: 'OPENAI_MODEL', required: true, description: 'A dated model version. There is no default.' },
        structuredOutput: { env: 'OPENAI_STRUCTURED_OUTPUT', default: 'json_schema', description: 'json_schema, json_object or prompt.' },
        api: { env: 'OPENAI_API', description: 'responses or chat. Default: responses for OpenAI itself, chat for any other server.' },
        reasoningEffort: { env: 'OPENAI_REASONING_EFFORT', description: 'Sent as reasoning_effort, for models that take it.' },
        maxOptions: { type: 'number', default: MAX_OPTIONS, description: 'Decision kind: the most options one choice question may carry, up to 255.' },
    },
    create({ name, settings, options }) {
        const { kind, model } = settings;
        if (!KINDS.includes(kind)) {
            throw new EngineConfigError(`The "${name}" engine's kind setting must be one of ${KINDS.join(', ')}, not ${JSON.stringify(kind)}.`);
        }
        const baseURL = settings.baseURL || DEFAULT_BASE_URL;
        // A server other than OpenAI gets only the instance's own key, or none.
        const apiKey = isOpenAI(baseURL) ? settings.apiKey || settings.openaiApiKey : settings.apiKey;
        if (!apiKey && isOpenAI(baseURL)) {
            throw new EngineConfigError(`The "${name}" engine (type "openai") needs its apiKey setting: set ${settingVariable(name, 'apiKey')} or OPENAI_API_KEY.`);
        }
        const client = options.client || openAIClient({ apiKey, baseURL, fetch: options.fetch });
        if (kind === 'decision') {
            if (!Number.isInteger(settings.maxOptions) || settings.maxOptions < 2 || settings.maxOptions > MAX_OPTIONS) {
                throw new EngineConfigError(`The "${name}" engine's maxOptions setting must be a whole number from 2 to ${MAX_OPTIONS}.`);
            }
            return decisionEngine({ name, model, client, maxOptions: settings.maxOptions });
        }
        const mode = checkMode(name, settings.structuredOutput);
        const own = isOpenAI(baseURL);
        const api = settings.api || (own ? 'responses' : 'chat');
        if (!APIS.includes(api)) {
            throw new EngineConfigError(`The "${name}" engine's api setting must be one of ${APIS.join(', ')}, not ${JSON.stringify(api)}.`);
        }
        const engine = api === 'responses' ? responsesAgentEngine : agentEngine;
        // OpenAI's strict mode corrupts constrained dates, so it gets them in words.
        return engine({ name, model, client, mode, reasoningEffort: settings.reasoningEffort, formatsInWords: own });
    },
});
