import { randomUUID } from "crypto";
import { NextFunction, Request, RequestHandler, Response } from "express";
import { safeRequestId } from "@formio/uag-sdk/protocol";

/**
 * The Agent API's one error shape. Every error a form's agent operation or
 * `/agent/capabilities` answers is JSON
 *
 *     { "requestId": "...", "error": "a message for people", "code": "a_stable_code", ... }
 *
 * with the same id in `X-Request-Id`, whatever refused it: the UAG, the
 * project's authentication, the portal's team access, the body parser.
 * Clients branch on `code`; `error` is for people. A 500 never carries details:
 * those are in the UAG's log under the request id.
 */

/** A form's agent operations, and the capabilities. */
const OPERATION = /\/agent\/(extract|decide|generate|chat)\/?$/i;
const CAPABILITIES = /^\/agent\/capabilities\/?$/i;

export function isAgentApiRequest(req: Request): boolean {
    return (req.method === 'POST' && OPERATION.test(req.path)) || (req.method === 'GET' && CAPABILITIES.test(req.path));
}

/** The code for a status, when the error names none. */
export function errorCode(status: number): string {
    switch (status) {
        case 400: return 'invalid_request';
        case 401: return 'unauthorized';
        case 403: return 'forbidden';
        case 404: return 'not_found';
        case 409: return 'conflict';
        case 413: return 'payload_too_large';
        case 429: return 'rate_limited';
        case 502: return 'engines_failed';
        case 503: return 'unavailable';
        case 504: return 'timeout';
        default: return status >= 500 ? 'internal_error' : 'invalid_request';
    }
}

export const INTERNAL_ERROR = 'The request failed. See the UAG logs for this request id.';

/** The request's id, assigned once: the caller's, when it is a short token, or a new one. */
export function requestIdOf(req: Request, res: Response): string {
    const request = req as any;
    if (!request.requestId) {
        request.requestId = safeRequestId(req.get('x-request-id')) || randomUUID();
    }
    if (!res.headersSent) res.set('X-Request-Id', request.requestId);
    return request.requestId;
}

/** The error body for a status and whatever a handler sent: an object, JSON text, plain text or nothing. */
export function errorBody(requestId: string, status: number, sent: unknown): Record<string, any> {
    let value: any = sent;
    if (Buffer.isBuffer(value)) value = value.toString('utf8');
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { value = { error: value }; }
    }
    const given = value && typeof value === 'object' ? value : {};
    const text = [given.error, given.detail, given.message].find((part) => typeof part === 'string' && part.trim());
    // A 500's own message may carry internals: only the UAG's fixed sentence goes out.
    const error = status >= 500 && status !== 502 && status !== 503 && status !== 504 ? INTERNAL_ERROR : (text || defaultMessage(status));
    return {
        requestId,
        error,
        code: typeof given.code === 'string' && given.code ? given.code : errorCode(status),
        ...(typeof given.edition === 'string' && { edition: given.edition })
    };
}

function defaultMessage(status: number): string {
    switch (status) {
        case 401: return 'Unauthorized.';
        case 403: return 'Forbidden.';
        case 404: return 'Not found.';
        case 413: return 'The request body is too large.';
        case 429: return 'Too many requests. Try again shortly.';
        default: return 'The request could not be completed.';
    }
}

/**
 * Mounted ahead of every route: for an Agent API request, assigns the request
 * id and rewrites any error response into the one shape, so refusals from
 * middleware the UAG does not own (the project's authentication answers plain
 * text, the portal's team access an empty 401) look like every other.
 */
export function agentErrorShape(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!isAgentApiRequest(req)) return next();
        const requestId = requestIdOf(req, res);
        const send = res.send.bind(res);
        let shaped = false;
        res.send = ((body?: any) => {
            // An event stream writes its own error events; only whole responses are shaped.
            if (shaped || res.statusCode < 400) return send(body);
            shaped = true;
            res.type('application/json');
            return send(JSON.stringify(errorBody(requestId, res.statusCode, body)));
        }) as any;
        next();
    };
}
