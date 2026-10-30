import { escapeRegExp } from "lodash";
import express, { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { SubmissionRequest } from "@formio/appserver";
import { errorCode, INTERNAL_ERROR, requestIdOf } from "./errors";
import { bearerOf, flagOff, formflow, FormflowError, FormflowService, callerIdentity, isScopedToken, OperationContext, OperationResult, RateLimitError, resultEvent } from "../formflow";
import type { UAGProjectInterface } from "../UAGProjectInterface";
import { withRequestId } from "./requestId";
import { anonymousGate } from "./anonymous";
import { chatEngines, chatTurn } from "./chat";
import type { UAGFormInterface } from "../UAGFormInterface";
const debug = require('debug')('formio:uag:agent');

/**
 * The Agent API: HTTP adapters onto Agentic Formflow in @formio/appserver-core.
 * Each endpoint reads its request, calls the service, and writes JSON (or, for
 * extract, a Server-Sent Events stream). Errors answer with the status the
 * service gives.
 *
 * The operations belong to a form, `{form}/agent/{operation}`, as its
 * submissions do: the form comes from the URL and the caller from the
 * project's own authentication. Capabilities describe the deployment, at
 * `/agent/capabilities`.
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
    return { auth: req.auth, requestId: req.requestId, identity: callerIdentity(req.auth, req) };
}

/**
 * The task the request names, if any. A request that still names a 1.x
 * `persona` is refused: ignoring it would run every task, an engine call each.
 */
function taskOf(req: AgentRequest): string | undefined {
    const named = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
    const task = req.body?.task;
    if (named(req.body?.persona) && !named(task)) {
        throw new FormflowError(400, 'UAG 2.0 renamed "persona" to "task". Send "task" instead.');
    }
    return named(task) ? task : undefined;
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

/** The largest request body an agent operation takes, in bytes. */
export const AGENT_BODY_LIMIT = 5 * 1024 * 1024;

type Handler = (req: AgentRequest, res: Response, service: FormflowService) => Promise<void>;

/** The parts every Agent API endpoint shares: the request id, and errors answered as JSON (or as an event mid-stream). */
function agentEndpoints(project: UAGProjectInterface) {
    const parse = express.json({ limit: AGENT_BODY_LIMIT });
    // The server parses JSON bodies first, with its own larger limit, so the
    // agent operations' limit is checked here on a body already read.
    const json = (req: Request, res: Response, next: NextFunction) => {
        if (req.body === undefined) return parse(req, res, next);
        const length = Number(req.get('content-length')) || Buffer.byteLength(JSON.stringify(req.body ?? null));
        if (length > AGENT_BODY_LIMIT) {
            return res.status(413).json({ error: `The request body is larger than the agent operations' limit of ${AGENT_BODY_LIMIT / (1024 * 1024)} MB.`, code: 'payload_too_large' });
        }
        next();
    };

    // The request id, usually assigned already by agentErrorShape, ahead of every
    // refusal. One that is not a short token is replaced, so it is never echoed,
    // logged or sent on.
    const requestId = (req: any, res: Response, next: NextFunction) => {
        requestIdOf(req, res);
        next();
    };

    const handle = (operation: string, fn: Handler) =>
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
                    error: status === 500 ? INTERNAL_ERROR : err.message,
                    code: (err instanceof FormflowError && err.code) || errorCode(status),
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
    return { json, requestId, handle };
}

/**
 * `GET /agent/capabilities`, behind `authenticate`. Only this path is claimed:
 * any other `/agent...` path (a project form at `agent`, for one) falls through
 * to the routes after this router.
 */
export function AgentRouter(project: UAGProjectInterface, authenticate: RequestHandler): Router {
    const router = Router();
    const { json, requestId, handle } = agentEndpoints(project);
    router.get('/agent/capabilities', authenticate, json, requestId, handle('capabilities', async (req, res, service) => {
        const capabilities = await service.capabilities();
        // Chat is part of conversation forms: it needs an agent engine, never a license.
        const engines = chatEngines(project).map((engine) => engine.name);
        capabilities.operations.chat = { available: engines.length > 0, engines };
        res.json({ requestId: req.requestId, ...capabilities });
    }));
    return router;
}

/**
 * A form's agent operation for a path that names no form of the project (the
 * old root operations, a deleted form): answered 404 here, so it is never
 * passed through to Form.io. A form that exists goes on to its own routes,
 * which answer 404 themselves when it is not tagged `uag`.
 */
export function agentNotFound(project: UAGProjectInterface): RequestHandler {
    // Express matches routes ignoring case, so this does too.
    const operation = /^(.*)\/agent\/(extract|decide|generate|chat)\/?$/i;
    return async (req: Request, res: Response, next: NextFunction) => {
        const match = req.method === 'POST' ? operation.exec(req.path) : null;
        if (!match) return next();
        // The form's path under the project's mount: the root on Open Source,
        // otherwise `/{name}` or `/project/{id}`, and nothing else.
        const mounts = [/^\/project\/[0-9a-fA-F]{24}(?=\/|$)/i];
        if (project.name) mounts.push(new RegExp(`^/${escapeRegExp(project.name)}(?=/|$)`, 'i'));
        let formPath = match[1];
        const mount = mounts.find((pattern) => pattern.test(formPath));
        if (mount) formPath = formPath.replace(mount, '');
        else if (!project.oss) formPath = '';
        formPath = formPath.replace(/^\/+/, '');
        const byId = /^form\/([0-9a-fA-F]{24})$/i.exec(formPath);
        const forms = Object.values(project.forms || {}) as any[];
        const known = byId
            ? forms.some((form) => String(form.form?._id || '') === byId[1]) || !!(await (project as any).getKnownFormById?.(byId[1]))
            : !!formPath && forms.some((form) => String(form.path || '').toLowerCase() === formPath.toLowerCase());
        if (known) return next();
        res.status(404).json({ error: `The form "${byId ? byId[1] : formPath}" does not exist or is not tagged "uag".`, code: 'form_not_found' });
    };
}

function refuse(res: Response, error: string) {
    return res.status(401).json({ error, code: 'unauthorized' });
}

/**
 * Who may call a form's agent operations, on top of the project's own
 * authentication (Form.io user tokens, portal remote tokens, server keys):
 * scoped tokens never (they are for /mcp), server keys only from servers, and
 * UAG bearer tokens, verified here. A caller with no credential gets through
 * only where the form allows anonymous use (see anonymousGate).
 */
export function agentCredentials(project: UAGProjectInterface): RequestHandler {
    const anonymous = anonymousGate(project);
    return (req: Request, res: Response, next: NextFunction) => {
        const request = req as SubmissionRequest;
        const authorization = req.get('authorization');
        const bearer = bearerOf(authorization);
        // Scoped tokens are for a task's calls back into /mcp. They must never
        // start new work: an admin scoped token would otherwise grant full
        // admin access to the agent operations for its lifetime.
        if (bearer && isScopedToken(bearer)) {
            return refuse(res, 'Scoped tokens can only be used on /mcp.');
        }
        if (req.get('x-token') !== undefined || req.get('x-admin-key') !== undefined) {
            // Browsers send Origin on cross-origin requests, and Sec-Fetch-Site on all
            // of them. (Node's fetch sends Sec-Fetch-Mode but not Sec-Fetch-Site.)
            if (req.get('origin') || req.get('sec-fetch-site')) {
                return refuse(res, 'Admin credentials cannot be used from a browser. Use a bearer token.');
            }
            return request.auth?.admin ? next() : refuse(res, 'Invalid admin credential.');
        }
        if (request.auth?.admin || request.auth?.user) {
            return next();
        }
        if (bearer) {
            const form = request.form;
            return project.authorizeRequest(request, res, () => {
                if (request.auth) request.auth.form = form || null;
                next();
            });
        }
        return anonymous(req, res, next);
    };
}

/**
 * A form's agent operations, `POST /agent/extract|decide|generate|chat`, mounted on
 * the form's own routes (see UAGFormInterface.router), so `req.form` is the
 * form of the URL.
 */
export function FormAgentRouter(project: UAGProjectInterface, credentials: RequestHandler): Router {
    const router = Router();
    const { json, requestId, handle } = agentEndpoints(project);
    const route = (path: string, operation: string, fn: Handler) => {
        router.post(`/agent/${path}`, credentials, json, requestId, handle(operation, fn));
    };
    const formOf = (req: AgentRequest) => (req.form as any)?.name as string;

    route('extract', 'extract', async (req, res, service) => {
        const { text, data, overwrite } = req.body || {};
        const task = taskOf(req);
        await respondWithStream(req, res, (context) => service.extract({ form: formOf(req), task, text, data, overwrite }, context));
    });

    route('decide', 'decide', async (req, res, service) => {
        const { data, submissionId, overwrite } = req.body || {};
        res.json(await service.decide({ form: formOf(req), task: taskOf(req), data, submissionId, overwrite }, contextOf(req)));
    });

    route('generate', 'generate', async (req, res, service) => {
        const { data, overwrite } = req.body || {};
        res.json(await service.generate({ form: formOf(req), task: taskOf(req), data, overwrite }, contextOf(req)));
    });

    // A turn of the form's chat. Not Agentic Formflow: no license check, as for the MCP tools.
    route('chat', 'chat', async (req, res, service) => {
        const form = await project.formflowForm(formOf(req)) as UAGFormInterface | null;
        if (!form) {
            throw new FormflowError(404, `The form "${formOf(req)}" does not exist or is not tagged "uag".`, 'form_not_found');
        }
        if (flagOff(form.form?.properties?.uagChat)) {
            throw new FormflowError(403, `Chat is turned off for the form "${form.formflowName}".`, 'chat_disabled');
        }
        service.requireAccess(req.auth, form, ['create']);
        res.json(await chatTurn(project, form, req.body, { auth: req.auth as any, requestId: req.requestId }));
    });

    return router;
}
