'use strict';
const { ENGINE_NAME } = require('./define');

/**
 * The remote engine protocol, version 1: JSON over HTTP between the UAG's
 * `remote` engine type and an engine server.
 *
 *   GET  /v1/engines                 -> { protocol, engines: [{ name, kind, model, maxOptions?, toolUse? }] }
 *   POST /v1/engines/:name/decide    { protocol, state, questions }  -> { protocol, model, answers, usage? }
 *   POST /v1/engines/:name/extract   { protocol, instructions, state, fields, schema, tools?, maxIterations? }
 *                                    -> { protocol, model, values, toolCalls?, usage? }
 *   Authorization: Bearer <engine server key>
 *   X-UAG-Scoped-Token: <scoped token>        research extracts only
 *   X-Request-Id: <request id>                optional, on decide and extract
 *   errors: { protocol, error, expose }       with a 4xx or 5xx status
 *
 * The version is in both the path and the body: the path routes future
 * versions side by side, and the body catches a proxy that mixes them up.
 *
 * The request id is the Agent API request's, and the engine server sends it on
 * with research's calls to the UAG's `/mcp`, so logs can group every leg of a
 * run. Neither side sends or logs one that is not a short token (`safeRequestId`).
 */
const PROTOCOL_VERSION = 1;
const SCOPED_TOKEN_HEADER = 'x-uag-scoped-token';
const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** A request id that is safe to send and log: up to 128 letters, digits, `.`, `_`, `:` or `-`. Anything else is undefined. */
function safeRequestId(value) {
    return typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined;
}

/** A message that breaks the protocol: the wrong version, or the wrong shape. */
class ProtocolError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'ProtocolError';
        this.status = status;
    }
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function check(condition, message, status) {
    if (!condition) throw new ProtocolError(message, status);
}

/** Refuse a message in another protocol version, naming both versions. */
function checkVersion(body, side = 'request') {
    check(isObject(body), `The ${side} is not a JSON object.`);
    const version = body.protocol;
    if (version !== PROTOCOL_VERSION) {
        throw new ProtocolError(
            `This side speaks remote engine protocol ${PROTOCOL_VERSION}; the ${side} used ${version === undefined ? 'no version' : `protocol ${JSON.stringify(version)}`}.`,
            400
        );
    }
}

function checkState(state) {
    check(isObject(state) && isObject(state.input) && typeof state.today === 'string', '"state" must be an object with "input" and "today".');
}

/** A decide request, as an engine server receives it. */
function checkDecideRequest(body) {
    checkVersion(body);
    checkState(body.state);
    check(isObject(body.questions), '"questions" must be an object.');
    for (const [id, question] of Object.entries(body.questions)) {
        check(isObject(question) && ['choice', 'score', 'noul'].includes(question.type) && typeof question.instructions === 'string',
            `The question "${id}" is not a choice, score or noul question.`);
    }
    return { state: body.state, questions: body.questions };
}

/** An extract request, as an engine server receives it. */
function checkExtractRequest(body) {
    checkVersion(body);
    checkState(body.state);
    check(typeof body.instructions === 'string', '"instructions" must be a string.');
    check(Array.isArray(body.fields) && body.fields.every((field) => isObject(field) && typeof field.path === 'string'), '"fields" must be a list of fields with paths.');
    check(isObject(body.schema), '"schema" must be an object.');
    const request = { instructions: body.instructions, state: body.state, fields: body.fields, schema: body.schema };
    if (body.tools !== undefined) {
        check(Array.isArray(body.tools) && body.tools.every((tool) => isObject(tool) && typeof tool.name === 'string' && typeof tool.description === 'string' && isObject(tool.inputSchema)),
            '"tools" must be a list of tool definitions.');
        check(Number.isInteger(body.maxIterations) && body.maxIterations > 0, '"maxIterations" must be a positive whole number with "tools".');
        Object.assign(request, { tools: body.tools, maxIterations: body.maxIterations });
    }
    return request;
}

/** A describe response, as the UAG receives it. */
function checkDescription(body) {
    checkVersion(body, 'response');
    check(Array.isArray(body.engines), '"engines" must be a list.');
    return body.engines.map((engine) => {
        check(isObject(engine) && typeof engine.name === 'string' && ENGINE_NAME.test(engine.name), 'Each engine needs a valid name.');
        check(['decision', 'agent'].includes(engine.kind), `The engine "${engine.name}" must be a decision or an agent engine.`);
        check(typeof engine.model === 'string' && engine.model, `The engine "${engine.name}" does not name its model.`);
        if (engine.kind === 'decision') {
            check(Number.isInteger(engine.maxOptions) && engine.maxOptions >= 2, `The decision engine "${engine.name}" needs maxOptions.`);
        }
        return {
            name: engine.name,
            kind: engine.kind,
            model: engine.model,
            ...(engine.kind === 'decision' && { maxOptions: engine.maxOptions }),
            ...(engine.kind === 'agent' && { toolUse: engine.toolUse === true }),
        };
    });
}

/** A token count: a whole number, or null when not reported. */
function tokenCount(value, key) {
    if (value === undefined || value === null) return null;
    check(Number.isInteger(value) && value >= 0, `"usage.${key}" must be a whole number or null.`);
    return value;
}

function checkUsage(usage) {
    if (usage === undefined) return undefined;
    check(isObject(usage), '"usage" must be an object.');
    return { inputTokens: tokenCount(usage.inputTokens, 'inputTokens'), outputTokens: tokenCount(usage.outputTokens, 'outputTokens') };
}

const isProbability = (value) => typeof value === 'number' && value >= 0 && value <= 1;

/** One answer's shape (which options and levels were asked is the UAG's to check). */
function checkAnswer(id, answer) {
    const where = `The answer to "${id}"`;
    check(isObject(answer) && ['choice', 'score', 'noul'].includes(answer.type), `${where} must be a choice, score or noul answer.`);
    if (answer.type === 'noul') {
        check(isProbability(answer.probability), `${where} needs a probability from 0 to 1.`);
        return;
    }
    check(isObject(answer.probabilities) && Object.values(answer.probabilities).every(isProbability), `${where} needs probabilities from 0 to 1.`);
    check(isProbability(answer.confidence), `${where} needs a confidence from 0 to 1.`);
    if (answer.type === 'choice') check(typeof answer.choice === 'string', `${where} needs its choice.`);
    else check(Number.isFinite(answer.score), `${where} needs its score.`);
}

/** A decide response, as the UAG receives it. */
function checkDecisionResponse(body) {
    checkVersion(body, 'response');
    check(typeof body.model === 'string', 'The response does not name its model.');
    check(isObject(body.answers), '"answers" must be an object.');
    for (const [id, answer] of Object.entries(body.answers)) checkAnswer(id, answer);
    const usage = checkUsage(body.usage);
    return { model: body.model, answers: body.answers, ...(usage && { usage }) };
}

/** An extract response, as the UAG receives it. */
function checkExtractResponse(body) {
    checkVersion(body, 'response');
    check(typeof body.model === 'string', 'The response does not name its model.');
    check(isObject(body.values), '"values" must be an object.');
    if (body.toolCalls !== undefined) {
        check(Array.isArray(body.toolCalls) && body.toolCalls.every((call) => isObject(call) && typeof call.name === 'string'), '"toolCalls" must be a list of calls.');
    }
    const usage = checkUsage(body.usage);
    return {
        model: body.model,
        values: body.values,
        ...(body.toolCalls && { toolCalls: body.toolCalls.map((call) => ({ name: call.name, isError: call.isError === true })) }),
        ...(usage && { usage }),
    };
}

/** An error response body. `expose` says whether the message may be shown to API callers. */
function errorBody(message, expose = false) {
    return { protocol: PROTOCOL_VERSION, error: String(message), expose: expose === true };
}

module.exports = {
    PROTOCOL_VERSION,
    SCOPED_TOKEN_HEADER,
    REQUEST_ID_HEADER,
    safeRequestId,
    ProtocolError,
    checkVersion,
    checkDecideRequest,
    checkExtractRequest,
    checkDescription,
    checkDecisionResponse,
    checkExtractResponse,
    errorBody,
};
