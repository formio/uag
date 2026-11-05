import type { Request } from 'express';
import type { ModuleRouteHandlers } from '@formio/appserver';
import { agentCredentials, agentEndpoints } from '../agent/router';
import { agentError } from '../agent/errors';
import type { UAGProjectInterface } from '../UAGProjectInterface';

/**
 * What runs around each module route in the UAG, as around the agent
 * operations: the caller check, the agent operations' JSON body limit and a
 * request id before it; the named operation's rate limits and the Agent API's
 * error shape around its run.
 */
export function uagRouteHandlers(project: UAGProjectInterface, name: string): ModuleRouteHandlers {
    const { json, requestId, handle } = agentEndpoints(project);
    return { before: [agentCredentials(project), json, requestId], wrap: (run) => handle(name, run as any) };
}

/** A module route's `failed` event: the Agent API's error shape, with the status the event cannot carry otherwise. */
export function uagErrorBody(req: Request, err: unknown): Record<string, any> & { status: number } {
    const { status, body } = agentError((req as any).requestId, err);
    return { status, ...body };
}
