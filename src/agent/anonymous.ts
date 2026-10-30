import { NextFunction, Request, Response } from 'express';
import type { SubmissionRequest } from '@formio/appserver';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import { flagOn } from '../formflow';
const debug = require('debug')('formio:uag:agent');

const WINDOW_MS = 60000;

/** A number from the configuration, else the environment, else the default. */
function limitOf(configured: unknown, env: string | undefined, fallback: number): number {
    for (const value of [configured, env]) {
        if (value === undefined || value === null || value === '') continue;
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) return Math.floor(number);
    }
    return fallback;
}

/** The anonymous limits in force: a per-address and a total count per minute. */
export function anonymousLimits(project: UAGProjectInterface) {
    const configured = (project.formflowConfig() as any)?.agentApi?.anonymous || {};
    return {
        perAddress: limitOf(configured.rateLimit, process.env.AGENT_ANONYMOUS_RATE_LIMIT, 10),
        total: limitOf(configured.totalRateLimit, process.env.AGENT_ANONYMOUS_TOTAL_RATE_LIMIT, 100)
    };
}

/**
 * Counts anonymous requests in fixed one-minute windows, per client address and
 * in total. Addresses are counted only while the total allows, so a window never
 * holds more addresses than the total limit.
 */
export class AnonymousLimiter {
    private windowStart = 0;
    private total = 0;
    private addresses = new Map<string, number>();

    /** Count a request, or say how many seconds remain until one would be allowed. */
    take(address: string, limits: { perAddress: number; total: number }, now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
        if (now - this.windowStart >= WINDOW_MS) {
            this.windowStart = now;
            this.total = 0;
            this.addresses.clear();
        }
        const retryAfter = Math.max(1, Math.ceil((this.windowStart + WINDOW_MS - now) / 1000));
        if (this.total >= limits.total) return { allowed: false, retryAfter };
        const count = this.addresses.get(address) || 0;
        if (count >= limits.perAddress) return { allowed: false, retryAfter };
        this.addresses.set(address, count + 1);
        this.total++;
        return { allowed: true };
    }
}

const limiters = new WeakMap<UAGProjectInterface, AnonymousLimiter>();

function limiterFor(project: UAGProjectInterface): AnonymousLimiter {
    let limiter = limiters.get(project);
    if (!limiter) {
        limiter = new AnonymousLimiter();
        limiters.set(project, limiter);
    }
    return limiter;
}

/**
 * Admits a caller with no credential to a form's agent operations only when
 * the form opts in (`uagAnonymous: "true"` in its custom properties), both
 * limits allow it, and the form lets the Anonymous role create submissions.
 * Every refusal comes before any engine is called.
 */
export function anonymousGate(project: UAGProjectInterface) {
    return (req: Request, res: Response, next: NextFunction) => {
        const request = req as SubmissionRequest;
        const form: any = request.form;
        const limits = anonymousLimits(project);
        if (limits.perAddress === 0 || limits.total === 0 || !flagOn(form?.form?.properties?.uagAnonymous)) {
            return res.status(401).json({ detail: 'Sign in to use this form\'s agent operations.' });
        }
        const taken = limiterFor(project).take(String(req.ip || req.socket?.remoteAddress || ''), limits);
        if (!taken.allowed) {
            debug(`Refused an anonymous ${req.method} ${req.path}: over the anonymous rate limit.`);
            res.set('Retry-After', String(taken.retryAfter));
            return res.status(429).json({ detail: 'Too many requests. Try again shortly.' });
        }
        let permissions: Record<string, boolean> = {};
        try {
            permissions = (request.auth as any)?.formPermissions?.(form) || {};
        }
        catch {
            permissions = {};
        }
        if (!permissions.create) {
            return res.status(403).json({ detail: 'Anonymous visitors may not submit this form.' });
        }
        next();
    };
}
