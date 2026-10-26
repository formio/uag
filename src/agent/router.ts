import { randomUUID } from "crypto";
import express, { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { SubmissionRequest } from "@formio/appserver";
import { safeRequestId } from "@formio/uag-sdk/protocol";
import { formflow, FormflowError, FormflowService, identityOf, OperationContext, OperationResult, RateLimitError, resolveFormName, resolveTaskName, resultEvent } from "../formflow";
import type { UAGProjectInterface } from "../UAGProjectInterface";
import { withRequestId } from "./requestId";
const debug = require('debug')('formio:uag:agent');

/**
 * The Agent API: HTTP adapters onto Agentic Formflow in @formio/appserver-core.
 * Each endpoint reads its request, calls the service, and writes JSON (or, for
 * extract, a Server-Sent Events stream). Errors answer with the status the
 * service gives.
 *
 * Requests may still name the task with the legacy `persona` (and provide's
 * form with `formName`); they are read here, so the service only sees `task`.
 */

type AgentRequest = SubmissionRequest & { requestId: string };

function wantsStream(req: Request): boolean {
    return String(req.get('accept') || '').includes('text/event-stream');
}

/** Server-Sent Events over the POST response. */
function openStream(res: Response) {
    res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    return (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
}

/** Who is asking, and who the operation runs as. */
function contextOf(req: AgentRequest): OperationContext {
    return { auth: req.auth, requestId: req.requestId, identity: identityOf(req.auth, req.get('authorization')) };
}

/** The request's task, from `task` or the legacy `persona`. */
function taskOf(req: AgentRequest): string | undefined {
    return resolveTaskName(req.body, req.path);
}

/**
 * Answer extract, streaming per-engine results when the client asks for a
 * stream: decision results arrive before slower LLM results.
 */
async function respondWithStream(req: AgentRequest, res: Response, run: (context: OperationContext) => Promise<OperationResult>) {
    const stream = wantsStream(req);
    let send: ((event: string, data: any) => void) | null = null;
    const done = await run({
        ...contextOf(req),
        onStart: () => {
            if (stream) send = openStream(res);
        },
        onResult: (result) => {
            if (!send) return;
            send('result', resultEvent(result));
            if (result.error) send('error', { kind: result.kind, task: result.task, error: result.error, attempts: result.attempts });
        }
    });
    if (send) {
        (send as (event: string, data: any) => void)('done', done);
        res.end();
    }
    else {
        res.json(done);
    }
}

/**
 * The Agent API's endpoints under `/agent`, each behind `authenticate`: the
 * stateless extract, decide and generate, the saving provide, and
 * capabilities. Only these paths are claimed: any other `/agent...` path (a
 * project form at `agent`, for one) falls through to the routes after this router.
 */
export function AgentRouter(project: UAGProjectInterface, authenticate: RequestHandler): Router {
    const router = Router();
    const json = express.json({ limit: '5mb' });

    // Request id, after authentication: refused requests carry none. One that
    // is not a short token is replaced, so it is never echoed, logged or sent on.
    const requestId = (req: any, res: Response, next: NextFunction) => {
        req.requestId = safeRequestId(req.get('x-request-id')) || randomUUID();
        res.set('X-Request-Id', req.requestId);
        next();
    };
    const route = (method: 'get' | 'post', path: string, handler: RequestHandler) => {
        router[method](`/agent${path}`, authenticate, json, requestId, handler);
    };

    const handle = (operation: string, fn: (req: AgentRequest, res: Response, service: FormflowService) => Promise<void>) =>
        async (req: Request, res: Response) => {
            const agentReq = req as AgentRequest;
            const service = formflow(project);
            try {
                service.takeCaller(operation, agentReq.auth);
                // Remote engines send the request id on to the engine server.
                await withRequestId(agentReq.requestId, () => fn(agentReq, res, service));
            }
            catch (err: any) {
                const status = err instanceof FormflowError ? err.status : 500;
                if (status === 500) {
                    debug(`[${agentReq.requestId}] ${operation} failed:`, err);
                }
                if (err instanceof RateLimitError) {
                    res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
                }
                const body = {
                    requestId: agentReq.requestId,
                    error: status === 500 ? 'The request failed. See the UAG logs for this request id.' : err.message,
                    ...(err instanceof FormflowError && err.code && { code: err.code }),
                    ...(err?.edition && { edition: err.edition })
                };
                if (res.headersSent) {
                    // Mid-stream: report the failure as an event and close.
                    res.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
                    res.end();
                }
                else {
                    res.status(status).json(body);
                }
            }
        };

    route('get', '/capabilities', handle('capabilities', async (req, res, service) => {
        res.json({ requestId: req.requestId, ...await service.capabilities() });
    }));

    route('post', '/extract', handle('extract', async (req, res, service) => {
        const { form, text, data, overwrite } = req.body || {};
        const task = taskOf(req);
        await respondWithStream(req, res, (context) => service.extract({ form, task, text, data, overwrite }, context));
    }));

    route('post', '/decide', handle('decide', async (req, res, service) => {
        const { form, data, submissionId, overwrite } = req.body || {};
        res.json(await service.decide({ form, task: taskOf(req), data, submissionId, overwrite }, contextOf(req)));
    }));

    route('post', '/generate', handle('generate', async (req, res, service) => {
        const { form, data, overwrite } = req.body || {};
        res.json(await service.generate({ form, task: taskOf(req), data, overwrite }, contextOf(req)));
    }));

    route('post', '/provide', handle('provide', async (req, res, service) => {
        const body = req.body || {};
        const form = resolveFormName(body, req.path);
        const result = await service.provide({ form, task: taskOf(req), submissionId: body.submissionId }, contextOf(req));
        if (!result.saved) {
            res.status(422).json({ requestId: req.requestId, task: result.task, error: result.error, details: result.details, fields: result.fields });
            return;
        }
        const { saved, ...rest } = result;
        res.json({ requestId: req.requestId, ...rest });
    }));

    return router;
}
