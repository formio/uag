/**
 * MAI engine for the UAG Agent API: Microsoft's MAI models (MAI-Thinking-1, in
 * preview) on Microsoft Foundry, for structured extraction with research over
 * read-only tools.
 *
 *   UAG_ENGINES=mai
 *   MAI_ENDPOINT=https://<resource>.services.ai.azure.com
 *   MAI_API_KEY=...
 *   MAI_DEPLOYMENT=<your deployment name>
 *
 * Foundry serves MAI models on an OpenAI-compatible chat completions API at
 * `<endpoint>/mai/v1`, authenticated with the key in an `api-key` header, and
 * names the deployment as the model. It documents no JSON response format, so
 * the schema goes in the prompt. MAI has no decision API, so this is an agent
 * engine only.
 */
const { openAICompatible } = require('@formio/uag-openai/compatible');

module.exports = openAICompatible({
    type: 'mai',
    description: 'Microsoft\'s MAI models on Microsoft Foundry: structured extraction, with research over read-only tools.',
    settings: {
        endpoint: { env: 'MAI_ENDPOINT', description: 'The Foundry resource endpoint, such as https://<resource>.services.ai.azure.com.' },
    },
    baseURL: (settings, requireSetting) => `${String(requireSetting('endpoint')).replace(/\/+$/, '')}/mai/v1`,
    apiKey: { env: 'MAI_API_KEY' },
    apiKeyHeader: 'api-key',
    model: { env: 'MAI_DEPLOYMENT', description: 'The Foundry deployment name, which MAI uses as the model.' },
    structuredOutput: 'prompt',
});
