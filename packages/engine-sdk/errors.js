'use strict';

/**
 * An engine failure whose message is safe to show to API callers, such as
 * "Quota exceeded for this API key". The UAG reports any other engine error only
 * as "the engine failed (see the logs for request X)", because a provider SDK's
 * error can carry URLs or account details.
 */
class EngineError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EngineError';
        Object.defineProperty(this, 'expose', { value: true, enumerable: true });
    }
}

/**
 * Thrown when an engine instance cannot be enabled. The message names the
 * instance, and is what the operator reads when the UAG refuses to start.
 */
class EngineConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EngineConfigError';
    }
}

/** Shorter values are too likely to occur by chance to be worth redacting. */
const MIN_SECRET_LENGTH = 4;

/** `text` with every occurrence of each secret value replaced. */
function redact(text, secrets) {
    let result = String(text);
    for (const secret of secrets || []) {
        const value = secret === undefined || secret === null ? '' : String(secret);
        if (value.length >= MIN_SECRET_LENGTH) {
            result = result.split(value).join('[redacted]');
        }
    }
    return result;
}

module.exports = { EngineError, EngineConfigError, redact };
