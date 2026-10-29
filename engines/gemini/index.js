/**
 * Gemini engine for the UAG Agent API: Google's Gemini models, through Google's
 * OpenAI-compatible endpoint, for structured extraction with research over
 * read-only tools.
 *
 *   UAG_ENGINES=gemini   GEMINI_API_KEY=...   GEMINI_MODEL=<a Gemini model ID>
 *
 * Gemini has no decision API, so this is an agent engine only.
 */
const { openAICompatible } = require('@formio/uag-openai/compatible');

module.exports = openAICompatible({
    type: 'gemini',
    description: 'Google\'s Gemini models: structured extraction, with research over read-only tools.',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: { env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
    model: { env: 'GEMINI_MODEL' },
    structuredOutput: 'json_schema',
    reasoningEffort: { env: 'GEMINI_REASONING_EFFORT' },
});
