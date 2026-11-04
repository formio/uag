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
        error: status === 500 ? INTERNAL_ERROR : String(err?.message || INTERNAL_ERROR),
        code: (err instanceof FormflowError && err.code) || errorCode(status)
    };
}

/** Run a streamed endpoint: JSON `{ result }`, or server-sent progress, then done or failed. */
async function stream(endpoint: FeatureEndpoint, api: FeatureApi, req: FeatureRequest, res: Response) {
    // 1. Check the request: anything thrown here is answered with its status, as JSON.
    const run = await endpoint.handler(req, res, api);
    if (res.headersSent) return;
    if (typeof run !== 'function') throw new Error(`The streamed endpoint "${endpoint.name}" of feature ${api.name} did not return its run`);
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableFinished) controller.abort(new FormflowError(499, 'The client closed the connection.', 'client_closed'));
    });
    const context = (progress: FeatureRunContext['progress']): FeatureRunContext => ({ signal: controller.signal, progress });
    // 2. Run.
    if (!wantsStream(req.get('accept'))) {
        const result = await run(context(() => undefined));
        res.json({ result });
        return;
    }
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const send = (event: string, value: any) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
    const every = typeof endpoint.heartbeatMs === 'function' ? endpoint.heartbeatMs(api.settings) : endpoint.heartbeatMs;
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, Number(every) > 0 ? Number(every) : 15000);
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
        if (!(err instanceof FormflowError)) debug(`[${req.requestId}] ${api.name} ${endpoint.name} failed: ${err?.message || err}`);
        send('failed', errorShape(req.requestId, err));
    }
    finally {
        clearInterval(heartbeat);
        res.end();
    }
}

/**
 * One feature's form routes for a project, as the router appserver mounts on
 * every form: each endpoint behind the UAG's caller authentication for agent
 * operations, its JSON body limit, a request id, the named operation's rate
 * limits and its error shape.
 */
export function featureFormRouter(project: UAGProjectInterface, api: FeatureApi, routes: Record<string, FeatureEndpoint>): Router {
    const router = Router();
    const credentials = agentCredentials(project);
    const { json, requestId, handle } = agentEndpoints(project);
    for (const [key, endpoint] of Object.entries(routes)) {
        const [, method, path] = ROUTE.exec(key) as RegExpExecArray;
        const run = handle(endpoint.name, async (req: any, res: Response) => {
            if (endpoint.stream) return stream(endpoint, api, req as FeatureRequest, res);
            const answer = await endpoint.handler(req as FeatureRequest, res, api);
            if (!res.headersSent && answer !== undefined) res.json(answer);
        });
        (router as any)[method.toLowerCase()](path, credentials, json, requestId, run);
    }
    return router;
}

/** The form's project, for a form route. */
export const projectOf = (form: FormInterface) => (form as any).project as UAGProjectInterface;
