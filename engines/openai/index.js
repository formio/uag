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
const { defineEngine, EngineConfigError, ENGINE_API_VERSION } = require('@formio/uag-sdk');
const { checkMode, openAIClient, agentEngine, responsesAgentEngine } = require('./compatible');
const { decisionEngine } = require('./decisions');

const KINDS = ['agent', 'decision'];
const APIS = ['responses', 'chat'];
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** Local servers ignore the key, but the SDK will not start without one. */
const PLACEHOLDER_KEY = 'unused';
/** The Decisions API accepts at most 255 choices per question (measured October 2026), as Jev does. */
const DEFAULT_MAX_OPTIONS = 255;

module.exports = defineEngine({
    type: 'openai',
    kinds: ['agent', 'decision'],
    apiVersion: ENGINE_API_VERSION,
    description: 'OpenAI: structured extraction with research over read-only tools, on OpenAI or any server with its chat completions API; or decisions with probabilities, on OpenAI\'s Decisions API.',
    settings: {
        kind: { env: 'OPENAI_KIND', default: 'agent', description: 'agent, or decision for the Decisions API.' },
        apiKey: { env: 'OPENAI_API_KEY', secret: true, description: 'Required unless baseURL is set.' },
        baseURL: { env: 'OPENAI_BASE_URL', description: 'An OpenAI-compatible server, such as http://ollama:11434/v1.' },
        model: { env: 'OPENAI_MODEL', required: true, description: 'A dated model version. There is no default.' },
        structuredOutput: { env: 'OPENAI_STRUCTURED_OUTPUT', default: 'json_schema', description: 'json_schema, json_object or prompt.' },
        api: { env: 'OPENAI_API', description: 'responses or chat. Default: responses for OpenAI itself, chat when baseURL is set.' },
        reasoningEffort: { env: 'OPENAI_REASONING_EFFORT', description: 'Sent as reasoning_effort, for models that take it.' },
        maxOptions: { type: 'number', default: DEFAULT_MAX_OPTIONS, description: 'Decision kind: the most options one choice question may carry.' },
    },
    create({ name, settings, options, requireSetting }) {
        const { kind, model } = settings;
        if (!KINDS.includes(kind)) {
            throw new EngineConfigError(`The "${name}" engine's kind setting must be one of ${KINDS.join(', ')}, not ${JSON.stringify(kind)}.`);
        }
        const apiKey = settings.baseURL ? settings.apiKey || PLACEHOLDER_KEY : requireSetting('apiKey');
        const client = options.client || openAIClient({ apiKey, baseURL: settings.baseURL || DEFAULT_BASE_URL });
        if (kind === 'decision') {
            if (!Number.isInteger(settings.maxOptions) || settings.maxOptions < 2) {
                throw new EngineConfigError(`The "${name}" engine's maxOptions setting must be a whole number of at least 2.`);
            }
            return decisionEngine({ name, model, client, maxOptions: settings.maxOptions });
        }
        const mode = checkMode(name, settings.structuredOutput);
        const api = settings.api || (settings.baseURL ? 'chat' : 'responses');
        if (!APIS.includes(api)) {
            throw new EngineConfigError(`The "${name}" engine's api setting must be one of ${APIS.join(', ')}, not ${JSON.stringify(api)}.`);
        }
        const engine = api === 'responses' ? responsesAgentEngine : agentEngine;
        // OpenAI's strict mode corrupts constrained dates, so it gets them in words.
        return engine({ name, model, client, mode, reasoningEffort: settings.reasoningEffort, formatsInWords: !settings.baseURL });
    },
});
