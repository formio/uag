/**
 * TypeSafe Jev decision engine for the UAG Agent API.
 *
 *   UAG_ENGINES=jev            TYPESAFE_API_KEY=...
 *   UAG_ENGINES=jev,next:jev   UAG_ENGINE_NEXT_MODEL=jev-1.14.0
 *
 * The UAG compiles decision fields into Choice, Score and Noul questions and
 * sends them all in one call; this engine only maps them to and from the SDK.
 * The routing timeout aborts the request through its signal; without one (as
 * in `uag-eval`), SDK retries wait at most the timeout for a `Retry-After`.
 *
 * Jev's `confidence` is already normalized as the contract asks: for a Choice,
 * (p_max - 1/n) / (1 - 1/n); for a Score, how close the probability sits to the
 * likeliest level, floored at 0 (https://docs.typesafe.ai/confidence).
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

/**
 * Map one SDK answer to the UAG's answer shape, for the question asked: a
 * choice that is not one of its options is dropped, and a score is kept within
 * its levels.
 */
function fromSdkAnswer(answer, question) {
    if (!answer || answer.type !== question.type) return undefined;
    switch (answer.type) {
        case 'choice':
            if (typeof answer.choice !== 'string' || !Object.prototype.hasOwnProperty.call(question.options, answer.choice)) return undefined;
            return { type: 'choice', choice: answer.choice, probabilities: { ...answer.probabilities }, confidence: answer.confidence };
        case 'score':
            if (!Number.isFinite(answer.score)) return undefined;
            return {
                type: 'score',
                score: Math.min(Math.max(answer.score, 0), question.levels.length - 1),
                probabilities: { ...answer.probabilities },
                confidence: answer.confidence
            };
        case 'noul':
            return { type: 'noul', probability: answer.noul };
        default:
            return undefined;
    }
}

/**
 * Provider failures an API caller can act on, as an `EngineError` with a fixed
 * message: never the response body, which may echo the request.
 */
function providerError(err) {
    const status = err && typeof err.status === 'number' ? err.status : undefined;
    if (status === 401 || status === 403) return new EngineError(`TypeSafe refused the decision engine's API key (HTTP ${status}).`);
    if (status === 429) return new EngineError('TypeSafe is rate-limiting the decision engine (HTTP 429). Try again later.');
    if (status >= 500 && status <= 599) return new EngineError(`TypeSafe failed to answer (HTTP ${status}).`);
    return err;
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
                // Never wait longer than the timeout for a Retry-After.
                retry: { maxRetries: 2, backoffMaxMs: Math.min(2000, Math.floor(timeout / 4)), maxRetryAfterMs: Math.min(timeout, 60000) }
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
                let result;
                try {
                    result = await client.systemOne(
                        { state: request.state, questions, model },
                        { signal: request.signal, timeout }
                    );
                }
                catch (err) {
                    throw providerError(err);
                }
                const answers = {};
                for (const [id, answer] of Object.entries(result.answers || {})) {
                    // Only the questions asked: anything else is dropped here, not passed on.
                    const mapped = Object.prototype.hasOwnProperty.call(request.questions, id) && fromSdkAnswer(answer, request.questions[id]);
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
