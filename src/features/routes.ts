import { Response, Router } from 'express';
import type { FormInterface } from '@formio/appserver';
import { FormflowError } from '../formflow';
import { agentCredentials, agentEndpoints } from '../agent/router';
import { errorCode, INTERNAL_ERROR } from '../agent/errors';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import type { FeatureApi, FeatureEndpoint, FeatureRequest, FeatureRunContext } from './types';
const debug = require('debug')('formio:uag:features');

export const ROUTE = /^(GET|POST|PUT|PATCH|DELETE) (\/[A-Za-z0-9_\-/.]*)$/;
const wantsStream = (accept: string | undefined) => String(accept || '').includes('text/event-stream');

function errorShape(requestId: string, err: any) {
    const status = err instanceof FormflowError ? err.status : 500;
    return {
        requestId,
        status,
        error: status === 500 ? INTERNAL_ERROR : String(err?.message || INTERNAL_ERROR),
        code: (err instanceof FormflowError && err.code) || errorCode(status)
    };
}

/**
 * Answer with what `run` returns: `{ result }` as JSON, or, to a client that
 * accepts text/event-stream, progress events and then `done` or `failed`. The
 * run's signal aborts when the client goes away. `api.stream` is this.
 */
export async function streamAnswer(feature: string, req: FeatureRequest, res: Response, run: (context: FeatureRunContext) => any, options: { heartbeatMs?: number } = {}): Promise<void> {
    const signal = req.signal || requestSignal(req, res);
    // The client went away while the request was being prepared: nothing to answer.
    if (signal.aborted) return;
    const context = (progress: FeatureRunContext['progress']): FeatureRunContext => ({ signal, progress });
    if (!wantsStream(req.get('accept'))) {
        const result = await run(context(() => undefined));
        res.json({ result });
        return;
    }
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const send = (event: string, value: any) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, Number(options.heartbeatMs) > 0 ? Number(options.heartbeatMs) : 15000);
    let last = -1;
    try {
        const result = await run(context((fraction, message) => {
            const progress = Math.round(Math.max(0, Math.min(1, Number(fraction) || 0)) * 100) / 100;
            if (progress === last && !message) return;
            last = progress;
            send('progress', { progress, ...(message && { message }) });
        }));
        send('done', { result });
    }
    catch (err: any) {
        if (!(err instanceof FormflowError)) debug(`[${req.requestId}] ${feature} failed: ${err?.message || err}`);
        send('failed', errorShape(req.requestId, err));
    }
    finally {
        clearInterval(heartbeat);
        res.end();
    }
}

/** A signal that aborts when the client closes the connection before the answer is sent. */
export function requestSignal(req: any, res: Response): AbortSignal {
    const controller = new AbortController();
    const abort = () => {
        if (!res.writableFinished) controller.abort(new FormflowError(499, 'The client closed the connection.', 'client_closed'));
    };
    // (A request is destroyed once its body is read: the response and the socket say whether the client is gone.)
    if (res.destroyed || res.socket?.destroyed) abort();
    else res.on('close', abort);
    return controller.signal;
}

/**
 * One feature's form routes for a project: each endpoint behind the UAG's
 * caller authentication for agent operations, its JSON body limit, a request
 * id, the named operation's rate limits, its error shape, and (unless the
 * endpoint says `access: false`) the caller's access to the form. Each request
 * gets `req.signal`, which aborts when the client goes away.
 */
export function featureFormRouter(project: UAGProjectInterface, api: FeatureApi, routes: Record<string, FeatureEndpoint>): Router {
    const router = Router();
    const credentials = agentCredentials(project);
    const { json, requestId, handle } = agentEndpoints(project);
    for (const [key, endpoint] of Object.entries(routes)) {
        const [, method, path] = ROUTE.exec(key) as RegExpExecArray;
        const access = endpoint.access === undefined ? ['create', 'update'] : endpoint.access;
        const run = handle(endpoint.name, async (req: any, res: Response) => {
            // Node's own request signal (a getter) aborts when the request ends: this one, when the client goes away first.
            Object.defineProperty(req, 'signal', { value: requestSignal(req, res), configurable: true, enumerable: true });
            if (access) api.requireAccess(req.auth, req.form, access);
            const answer = await endpoint.handler(req as FeatureRequest, res, api);
            if (!res.headersSent && answer !== undefined) res.json(answer);
        });
        (router as any)[method.toLowerCase()](path, credentials, json, requestId, run);
    }
    return router;
}

/** The form's project, for a form route. */
export const projectOf = (form: FormInterface) => (form as any).project as UAGProjectInterface;
