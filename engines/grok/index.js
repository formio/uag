/**
 * Grok engine for the UAG Agent API: xAI's models, through xAI's
 * OpenAI-compatible API, for structured extraction with research over
 * read-only tools.
 *
 *   UAG_ENGINES=grok   XAI_API_KEY=...   XAI_MODEL=<a Grok model ID>
 *
 * Grok has no decision API, so this is an agent engine only.
 */
const { openAICompatible } = require('@formio/uag-openai/compatible');

module.exports = openAICompatible({
    type: 'grok',
    description: 'xAI\'s Grok models: structured extraction, with research over read-only tools.',
    baseURL: 'https://api.x.ai/v1',
    apiKey: { env: 'XAI_API_KEY' },
    model: { env: 'XAI_MODEL' },
    structuredOutput: 'json_schema',
});
