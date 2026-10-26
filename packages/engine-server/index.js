'use strict';
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { engineInstances } = require('@formio/uag-sdk');
const { enginePaths, loadEngines } = require('@formio/uag-sdk/loader');
const {
    PROTOCOL_VERSION,
    REQUEST_ID_HEADER,
    SCOPED_TOKEN_HEADER,
    ProtocolError,
    checkDecideRequest,
    checkExtractRequest,
    errorBody,
    safeRequestId,
} = require('@formio/uag-sdk/protocol');
const { openResearch, connectMcp } = require('./research');
const debug = require('debug')('formio:uag:engine-server');

/**
 * The UAG engine server: hosts engine instances, resolved and configured as on
 * the UAG, behind the remote engine protocol. The UAG's `remote` engine type
 * calls it, so model credentials and model traffic stay in this process.
 *
 * It holds no Form.io credential. For research it connects back to the UAG's
 * `/mcp` with the scoped token the UAG sent, at the UAG URL it is configured
 * with, never one taken from a request. The UAG's request id, when it sends a
 * short token, goes on with that connection and into this server's logs.
 */

const MIN_KEY_LENGTH = 32;
const ROOT = __dirname;

/** Thrown for a configuration the server cannot start with. */
class EngineServerConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EngineServerConfigError';
    }
}

/** An error answered with a status and the protocol's error body. */
class HttpError extends Error {
    constructor(status, message, expose = true) {
        super(message);
        this.status = status;
        this.expose = expose;
    }
}

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();

/** Compare a presented key with the server key in constant time, whatever their lengths. */
function keyMatches(presented, key) {
    return typeof presented === 'string' && crypto.timingSafeEqual(digest(presented), digest(key));
}

/** The engine server key, refusing a missing or short one. */
function serverKey(env) {
    const key = env.UAG_ENGINE_SERVER_KEY;
    if (!key) {
        throw new EngineServerConfigError('UAG_ENGINE_SERVER_KEY is not set. The engine server refuses to start without a key.');
    }
    if (key.length < MIN_KEY_LENGTH) {
        throw new EngineServerConfigError(`UAG_ENGINE_SERVER_KEY must be at least ${MIN_KEY_LENGTH} characters.`);
    }
    return key;
}

/** What `GET /v1/engines` says about one engine. */
function describe(engine) {
    return {
        name: engine.name,
        kind: engine.kind,
        model: engine.model,
        ...(engine.kind === 'decision' && { maxOptions: engine.maxOptions }),
        ...(engine.kind === 'agent' && { toolUse: engine.toolUse === true }),
    };
}

/** An abort signal that fires when the client goes away before the answer is sent. */
function requestSignal(res) {
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableFinished) controller.abort(new Error('The UAG closed the request.'));
    });
    return controller.signal;
}

/** The UAG's request id for a call, when it sent one that is safe to pass on and log. */
function requestIdOf(req) {
    return safeRequestId(req.get(REQUEST_ID_HEADER));
}

/** Only the keys asked for. */
function pick(object, keys) {
    return Object.fromEntries(Object.entries(object || {}).filter(([key]) => keys.has(key)));
}

/**
 * Build the engine server's Express app for already-loaded engines.
 *
 * Options:
 * - `engines`: `{ engine }` entries from the SDK loader;
 * - `key`: the engine server key;
 * - `uagServer`: the UAG's base URL, for research;
 * - `connect(url, token, requestId)`: the MCP client factory (for tests).
 */
function engineServerApp({ engines, key, uagServer, connect = connectMcp }) {
    const byName = new Map(engines.map(({ engine }) => [engine.name, engine]));
    const app = express();
    app.disable('x-powered-by');

    // The key is checked before anything else, including reading the body.
    app.use((req, res, next) => {
        const presented = /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1];
        if (!keyMatches(presented, key)) {
            res.status(401).json(errorBody('Unauthorized.', true));
            return;
        }
        next();
    });
    app.use(express.json({ limit: '5mb' }));

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', engines: byName.size });
    });

    app.get('/v1/engines', (req, res) => {
        res.json({ protocol: PROTOCOL_VERSION, engines: [...byName.values()].map(describe) });
    });

    function engineFor(name, kind) {
        const engine = byName.get(name);
        if (!engine) {
            throw new HttpError(404, `This engine server does not host an engine named "${name}".`);
        }
        if (engine.kind !== kind) {
            throw new HttpError(400, `The engine "${name}" is a ${engine.kind} engine.`);
        }
        return engine;
    }

    app.post('/v1/engines/:name/decide', async (req, res, next) => {
        try {
            const engine = engineFor(req.params.name, 'decision');
            const { state, questions } = checkDecideRequest(req.body);
            const response = await engine.decide({ state, questions, signal: requestSignal(res) });
            res.json({
                protocol: PROTOCOL_VERSION,
                model: response.model || engine.model,
                answers: pick(response.answers, new Set(Object.keys(questions))),
                ...(response.usage && { usage: response.usage }),
            });
        }
        catch (err) {
            next(err);
        }
    });

    app.post('/v1/engines/:name/extract', async (req, res, next) => {
        let research;
        try {
            const engine = engineFor(req.params.name, 'agent');
            const request = checkExtractRequest(req.body);
            const signal = requestSignal(res);
            if (request.tools) {
                const token = req.get(SCOPED_TOKEN_HEADER);
                if (!token) {
                    throw new HttpError(400, `A research extract needs a scoped token in the ${SCOPED_TOKEN_HEADER} header.`);
                }
                if (!engine.toolUse) {
                    throw new HttpError(400, `The engine "${engine.name}" does not research with tools.`);
                }
                if (!uagServer) {
                    throw new HttpError(503, 'This engine server cannot research: UAG_SERVER is not set.');
                }
                research = await openResearch({ uagServer, token, requestId: requestIdOf(req), requested: request.tools, signal, connect });
            }
            const response = await engine.extract({
                instructions: request.instructions,
                state: request.state,
                fields: request.fields,
                schema: request.schema,
                signal,
                ...(research && { tools: research.tools, callTool: research.callTool, maxIterations: request.maxIterations }),
            });
            res.json({
                protocol: PROTOCOL_VERSION,
                model: response.model || engine.model,
                values: pick(response.values, new Set(Object.keys((request.schema && request.schema.properties) || {}))),
                // The calls this server made for the engine, not what the engine reports.
                ...(research && { toolCalls: research.calls }),
                ...(response.usage && { usage: response.usage }),
            });
        }
        catch (err) {
            next(err);
        }
        finally {
            if (research) await research.close();
        }
    });

    app.use((req, res) => {
        res.status(404).json(errorBody(`No route for ${req.method} ${req.path}.`, true));
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        if (res.headersSent || res.destroyed) return;
        if (err instanceof HttpError || err instanceof ProtocolError) {
            res.status(err.status).json(errorBody(err.message, true));
            return;
        }
        if (err && err.type === 'entity.parse.failed') {
            res.status(400).json(errorBody('The request body is not valid JSON.', true));
            return;
        }
        if (err && err.type === 'entity.too.large') {
            res.status(413).json(errorBody('The request body is too large.', true));
            return;
        }
        debug(`[${requestIdOf(req) || '-'}] Engine failure on ${req.method} ${req.path}: ${err && err.stack ? err.stack : err}`);
        // Engines mark the messages that are safe to show; everything else stays here.
        res.status(502).json(err && err.expose === true
            ? errorBody(err.message, true)
            : errorBody('The engine failed (see the engine server logs).', false));
    });

    return app;
}

/**
 * Load the engines and build the app from the environment: `UAG_ENGINES` (and
 * each instance's `UAG_ENGINE_*` settings), `UAG_ENGINE_SERVER_KEY`,
 * `UAG_SERVER` and `UAG_ENGINE_PATH`.
 */
async function createEngineServer({ env = process.env, config = {}, types = {}, root = ROOT, connect } = {}) {
    const key = serverKey(env);
    const uagServer = env.UAG_SERVER ? String(env.UAG_SERVER) : undefined;
    if (uagServer && !/^https?:\/\//.test(uagServer)) {
        throw new EngineServerConfigError('UAG_SERVER must be an http or https URL.');
    }
    const engines = await loadEngines(engineInstances(config, env), {
        types,
        paths: enginePaths(root, env),
        env,
        config,
    });
    if (!engines.length) {
        throw new EngineServerConfigError('UAG_ENGINES names no engines, so there is nothing to serve.');
    }
    return { app: engineServerApp({ engines, key, uagServer, connect }), engines, uagServer };
}

module.exports = {
    MIN_KEY_LENGTH,
    EngineServerConfigError,
    createEngineServer,
    engineServerApp,
    keyMatches,
    describe,
    root: path.resolve(ROOT),
};
