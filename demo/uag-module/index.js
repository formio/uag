/**
 * The demo UAG's module: rate limits for a UAG that anyone on the internet can
 * use as a guest of the demo's project (the demo site signs each visitor in as
 * one). Mounted at /app/module (docker-compose.yml), or named by UAG_MODULE.
 *
 * Every guest is its own caller, so `caller` limits each visitor; `engine`
 * limits what all visitors together may ask of the model, per UAG instance.
 * The model provider's own spend limit is the cap behind these.
 *
 * DEMO_RATE_LIMITS (JSON, the shape of agentApi.rateLimits) replaces them.
 */
const MINUTE = 60_000;

const defaults = {
    caller: {
        chat: { limit: 20, windowMs: MINUTE },
        extract: { limit: 20, windowMs: MINUTE },
        document: { limit: 6, windowMs: MINUTE },
        default: { limit: 60, windowMs: MINUTE },
    },
    engine: {
        claude: { limit: 120, windowMs: MINUTE },
    },
};

function rateLimits(env = process.env) {
    if (!env.DEMO_RATE_LIMITS) return defaults;
    try {
        return JSON.parse(env.DEMO_RATE_LIMITS);
    }
    catch (error) {
        throw new Error(`DEMO_RATE_LIMITS is not JSON: ${error.message}`);
    }
}

module.exports = {
    config: {
        agentApi: { rateLimits: rateLimits() },
    },
};
