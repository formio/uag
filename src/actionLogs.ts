import { Actions } from '@formio/appserver';
import { Request, Response, Router } from 'express';
import { escapeRegExp } from 'lodash';
import { taskRunner } from './runner';
import type { TaskRunRecord, TaskRunStatus } from './runs';
import type { UAGProjectInterface } from './UAGProjectInterface';
const debug = require('debug')('formio:uag:actionLogs');

/**
 * Action Logs in a portal stage connected to the UAG. The portal asks the
 * stage's URL for `/action` (Form.io Enterprise's action items). The UAG asks
 * Form.io with the caller's own credential, so Form.io decides who may see the
 * logs, and adds its Run task records to Form.io's entries, newest first.
 *
 * Without the UAG's database there are no records, and these requests pass
 * through to Form.io unchanged.
 */

const STATES: Record<TaskRunStatus, string> = { pending: 'new', running: 'inprogress', done: 'complete', failed: 'error' };
const STATUSES: Record<string, TaskRunStatus> = { new: 'pending', inprogress: 'running', complete: 'done', error: 'failed' };
const MAX_PAGE = 1000;

/** The caller's credential, as sent, for Form.io. */
function credential(req: Request): Record<string, string> {
    return Object.fromEntries(Object.entries(req.headers)
        .filter(([name, value]) => Actions.CREDENTIAL_HEADERS.includes(name.toLowerCase()) && typeof value === 'string')) as Record<string, string>;
}

/** A run record as a Form.io action item. */
export function actionItem(record: TaskRunRecord) {
    const messages: { datetime: string; info: string; data: any }[] = [
        { datetime: record.created.toISOString(), info: `Run task "${record.task}" ${record.durable ? 'queued' : 'started'} (${record.answer === 'decisions' ? 'decision fields only' : 'the whole task'}).`, data: {} }
    ];
    if (record.started) {
        messages.push({ datetime: record.started.toISOString(), info: `Started (attempt ${record.attempts}).`, data: {} });
    }
    if (record.finished) {
        const written = record.written || [];
        const cleared = record.cleared || [];
        const info = record.status === 'failed'
            ? `Failed: ${record.error || 'unknown error'}`
            : record.saved
                ? `Saved ${written.length} field(s)${written.length ? `: ${written.join(', ')}` : ''}${cleared.length ? `; cleared ${cleared.join(', ')}` : ''}.`
                : 'Nothing changed, so nothing was saved.';
        messages.push({ datetime: record.finished.toISOString(), info, data: { engines: record.engines || [], written, cleared } });
    }
    return {
        _id: String(record._id),
        title: record.action,
        action: 'agentRunTask',
        project: record.project,
        form: record.form,
        ...(record.submission && { submission: record.submission }),
        handler: record.handler,
        method: record.method,
        state: STATES[record.status],
        messages,
        data: {
            task: record.task,
            answer: record.answer,
            durable: record.durable,
            ...(record.actingFor?._id && { actingFor: { _id: record.actingFor._id, ...(record.actingFor.email && { email: record.actingFor.email }) } }),
            ...(record.agentRole && { agentRole: record.agentRole })
        },
        created: record.created.toISOString(),
        modified: record.modified.toISOString()
    };
}

/** The records filter for the portal's query (`form`, `submission`, `handler`, `method`, `state`, `title__regex`). */
function filterOf(project: UAGProjectInterface, query: Record<string, any>): Record<string, any> {
    const filter: Record<string, any> = { project: String(project.project?._id || '') };
    for (const field of ['form', 'submission', 'handler', 'method']) {
        if (typeof query[field] === 'string' && query[field]) filter[field] = query[field];
    }
    if (typeof query.state === 'string' && query.state) filter.status = STATUSES[query.state] || '__none__';
    // Matched as text: a portal filter is never run as a regular expression against the database.
    if (typeof query.title__regex === 'string' && query.title__regex) filter.action = { $regex: escapeRegExp(query.title__regex), $options: 'i' };
    return filter;
}

const number = (value: any, fallback: number) => {
    const parsed = parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function ActionLogRouter(project: UAGProjectInterface): Router {
    const router = Router();

    /** Ask Form.io, as the caller, for its action items. */
    const ask = (req: Request, path: string, query: URLSearchParams) =>
        fetch(`${project.endpoint}${path}${query.toString() ? `?${query}` : ''}`, { headers: { ...credential(req), Accept: 'application/json' } });

    /** Relay Form.io's answer as it is. */
    const relay = async (res: Response, response: globalThis.Response) => {
        const range = response.headers.get('content-range');
        if (range) res.set('Content-Range', range);
        res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(await response.text());
    };

    router.get('/action', async (req: Request, res: Response, next) => {
        const records = taskRunner(project).records;
        if (!records || !project.endpoint) return next();
        try {
            const skip = number(req.query.skip, 0);
            // A limit of 0 is the default page, not every record.
            const limit = Math.min(number(req.query.limit, 10) || 10, MAX_PAGE);
            // Both lists are sorted the same way, so the page is among the first skip + limit of each.
            const query = new URLSearchParams(Object.entries(req.query).filter(([, value]) => typeof value === 'string') as [string, string][]);
            query.set('skip', '0');
            query.set('limit', String(Math.min(skip + limit, MAX_PAGE)));
            query.set('sort', '-modified');
            const response = await ask(req, '/action', query);
            if (!response.ok) return relay(res, response);
            const formio: any[] = await response.json();
            const formioTotal = Number((response.headers.get('content-range') || '').split('/')[1]) || formio.length;
            const own = await records.list(filterOf(project, req.query as any), Math.min(skip + limit, MAX_PAGE));
            const merged = [...formio, ...own.items.map(actionItem)]
                .sort((a, b) => Date.parse(b.modified || b.created) - Date.parse(a.modified || a.created));
            const page = merged.slice(skip, skip + limit);
            const total = formioTotal + own.total;
            res.set('Content-Range', page.length ? `${skip}-${skip + page.length - 1}/${total}` : `*/${total}`);
            res.json(page);
        }
        catch (err: any) {
            debug(`Action Logs failed: ${err?.message || err}`);
            next(err);
        }
    });

    router.get('/action/:id', async (req: Request, res: Response, next) => {
        const records = taskRunner(project).records;
        if (!records || !project.endpoint) return next();
        try {
            const record = await records.get(String(req.params.id));
            if (!record || record.project !== String(project.project?._id || '')) {
                return relay(res, await ask(req, `/action/${encodeURIComponent(String(req.params.id))}`, new URLSearchParams()));
            }
            // Form.io decides who may read Action Logs.
            const allowed = await ask(req, '/action', new URLSearchParams({ limit: '1' }));
            if (!allowed.ok) return relay(res, allowed);
            res.json(actionItem(record));
        }
        catch (err: any) {
            next(err);
        }
    });

    return router;
}
