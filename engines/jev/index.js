/**
 * TypeSafe Jev decision engine for the UAG Agent API.
 *
 *   UAG_ENGINES=jev            TYPESAFE_API_KEY=...
 *   UAG_ENGINES=jev,next:jev   UAG_ENGINE_NEXT_MODEL=jev-1.14.0
 *
 * The UAG compiles decision fields into Choice, Score and Noul questions and
 * sends them all in one call; this engine only maps them to and from the SDK.
 * The routing timeout aborts the request through its signal, so SDK retries of
 * rate-limit and overload responses never outlast it.
 */
const { defineEngine, EngineError, ENGINE_API_VERSION } = require('@formio/uag-sdk');

/** Pin a dated version, never an alias, and re-run `uag-eval` before changing it. */
const DEFAULT_MODEL = 'jev-1.13.0';
/** Jev accepts up to 255 options per Choice question. */
const MAX_OPTIONS = 255;
const DEFAULT_TIMEOUT = 30000;

/** Map one UAG decision question to the SDK's question shape. */
function toSdkQuestion(question) {
    switch (question.type) {
        case 'choice':
            return { type: 'choice', instructions: question.instructions, criteria: question.options };
        case 'score':
            return { type: 'score', instructions: question.instructions, criteria: question.levels };
        case 'noul':
            return {
                type: 'noul',
                instructions: question.instructions,
                ...(question.criteria && { criteria: question.criteria })
            };
        default:
            throw new EngineError(`Unsupported question type "${question.type}".`);
    }
}

/** Map one SDK answer to the UAG's answer shape. */
function fromSdkAnswer(answer) {
    switch (answer && answer.type) {
        case 'choice':
            return { type: 'choice', choice: answer.choice, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
        case 'score':
            return { type: 'score', score: answer.score, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
        case 'noul':
            return { type: 'noul', probability: answer.noul };
        default:
            return undefined;
    }
}

module.exports = defineEngine({
    type: 'jev',
    kinds: ['decision'],
    apiVersion: ENGINE_API_VERSION,
    description: 'TypeSafe Jev: confidence-scored Choice, Score and yes/no decisions.',
    settings: {
        apiKey: { env: 'TYPESAFE_API_KEY', required: true, secret: true },
        model: { env: 'TYPESAFE_MODEL', default: DEFAULT_MODEL, description: 'A dated model version.' },
        baseURL: { env: 'TYPESAFE_BASE_URL', description: 'The API base URL, when not the SDK\'s default.' },
    },
    create({ name, settings, options, config }) {
        const { model } = settings;
        // Keep the SDK's own per-request timeout inside this instance's routing timeout.
        const timeout = (config.routing && config.routing.timeouts && config.routing.timeouts[name])
            || (config.agentApi && config.agentApi.timeout)
            || DEFAULT_TIMEOUT;

        let client = options.client;
        if (!client) {
            const { TypeSafeClient } = require('@typesafe-ai/sdk');
            client = new TypeSafeClient({
                apiKey: settings.apiKey,
                // The SDK refuses to start when it sees `window.document` and
                // `navigator`. Inside the UAG both exist: Node 21+ defines
                // `navigator`, and Form.io's libraries install `window`/`document`
                // shims. Allow it only when actually running on Node, so a real
                // browser is still refused.
                dangerouslyAllowBrowser: typeof process !== 'undefined' && !!(process.versions && process.versions.node),
                defaultModel: model,
                ...(settings.baseURL && { baseURL: settings.baseURL }),
                timeout,
                retry: { maxRetries: 2, backoffMaxMs: Math.min(2000, Math.floor(timeout / 4)) }
            });
        }

        return {
            name,
            kind: 'decision',
            apiVersion: ENGINE_API_VERSION,
            model,
            maxOptions: MAX_OPTIONS,
            async decide(request) {
                if (request.signal) request.signal.throwIfAborted();
                const questions = {};
                for (const [id, question] of Object.entries(request.questions)) {
                    questions[id] = toSdkQuestion(question);
                }
                const result = await client.systemOne(
                    { state: request.state, questions, model },
                    { signal: request.signal, timeout }
                );
                const answers = {};
                for (const [id, answer] of Object.entries(result.answers || {})) {
                    // Only the questions asked: anything else is dropped here, not passed on.
                    const mapped = request.questions[id] && fromSdkAnswer(answer);
                    if (mapped) answers[id] = mapped;
                }
                return {
                    model: result.model || model,
                    answers,
                    ...(result.usage && { usage: { inputTokens: result.usage.input_tokens ?? null, outputTokens: result.usage.output_tokens ?? null } })
                };
            }
        };
    },
});
