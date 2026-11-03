import { RequestHandler, Response, Router } from 'express';
import { callerKey, FormflowError } from '../formflow';
import { agentEndpoints } from '../agent/router';
import { errorCode, INTERNAL_ERROR } from '../agent/errors';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import type { UAGFormInterface } from '../UAGFormInterface';
import { prepareDocument } from './pipeline';
import { documentsSettings } from './settings';
const debug = require('debug')('formio:uag:documents');

const wantsStream = (accept: string | undefined) => String(accept || '').includes('text/event-stream');

/** The Agent API's error shape, for a failure after the stream opened. */
function errorShape(requestId: string, err: any) {
    const status = err instanceof FormflowError ? err.status : 500;
    return {
        requestId,
        error: status === 500 ? INTERNAL_ERROR : String(err?.message || INTERNAL_ERROR),
        code: (err instanceof FormflowError && err.code) || errorCode(status)
    };
}

/**
 * `POST {project}/{formPath}/document/process`, body `{ path, files, data? }`:
 * process an AI Document's files with its plugin.
 *
 * With `Accept: text/event-stream`, `progress` events, then one `done`
 * (`{ result }`) or `failed` (the Agent API's error shape) on the same
 * response, with a comment line every `documents.heartbeatMs`; otherwise
 * `{ result }` when done. Problems found before processing starts answer with
 * their status code. Closing the connection aborts the plugin and any running
 * conversion; nothing outlives the response.
 */
export function DocumentRouter(project: UAGProjectInterface, credentials: RequestHandler): Router {
    const router = Router();
    const { json, requestId, handle } = agentEndpoints(project);
    // Concurrent requests per identity, on this instance.
    const active = new Map<string, number>();

    router.post('/document/process', credentials, json, requestId, handle('document', async (req, res: Response) => {
        const settings = documentsSettings(project.config?.documents);
        const key = callerKey(req.auth);
        if ((active.get(key) || 0) >= settings.perUser) {
            throw new FormflowError(429, `At most ${settings.perUser} documents are processed at once for one caller (documents.perUser). Wait for one to finish.`, 'too_many_requests');
        }
        active.set(key, (active.get(key) || 0) + 1);
        const controller = new AbortController();
        res.on('close', () => {
            if (!res.writableFinished) controller.abort(new FormflowError(499, 'The client closed the connection.', 'client_closed'));
        });
        let heartbeat: NodeJS.Timeout | undefined;
        try {
            const { path, files, data } = req.body || {};
            const prepared = await prepareDocument({ project, form: req.form as unknown as UAGFormInterface, path, files, data, auth: req.auth });
            if (!wantsStream(req.get('accept'))) {
                const result = await prepared.run({ signal: controller.signal, progress: () => undefined });
                res.json({ result });
                return;
            }
            res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
            res.flushHeaders?.();
            const send = (event: string, value: any) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
            heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': keep-alive\n\n'); }, settings.heartbeatMs);
            let last = -1;
            try {
                const result = await prepared.run({
                    signal: controller.signal,
                    progress: (fraction, message) => {
                        const progress = Math.round(Math.max(0, Math.min(1, fraction)) * 100) / 100;
                        if (progress === last && !message) return;
                        last = progress;
                        send('progress', { progress, ...(message && { message }) });
                    }
                });
                send('done', { result });
            }
            catch (err: any) {
                if (!(err instanceof FormflowError)) debug(`[${req.requestId}] document processing failed: ${err?.message || err}`);
                send('failed', errorShape(req.requestId, err));
            }
            res.end();
        }
        finally {
            clearInterval(heartbeat);
            const count = (active.get(key) || 1) - 1;
            if (count > 0) active.set(key, count); else active.delete(key);
        }
    }));
    return router;
}
