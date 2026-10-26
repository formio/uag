/**
 * uag-flow: a logging reverse proxy that makes every leg of an agentic run visible.
 *
 * It sits in front of the UAG and the engine server, on the private network:
 *
 *   /v1/engines*   -> the engine server  (what the UAG asks each remote engine)
 *   /flow/*        -> served here        (the event stream, for the demo site)
 *   everything else -> the UAG          (the Agent API and its webhooks, MCP from
 *                                         the demo and from engine research, auth)
 *
 * Every request carries an X-Request-Id. The UAG forwards it to the engine
 * server, and the engine server forwards it on its research calls to /mcp, so
 * all the legs of one run share it. Requests that arrive without one (Form.io
 * webhooks) are given one here. The demo site reads the stream and shows each
 * visitor only the runs that are theirs.
 *
 * Bodies are kept, truncated, so a visitor can see what their own run sent.
 * Token exchanges are redacted, and no header is ever recorded. The stream
 * needs FLOW_KEY when it is set, and the port must stay on the private network.
 *
 * No dependencies.
 */
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

const PORT = parseInt(process.env.PORT || '3250', 10);
const UAG = new URL(process.env.UAG_URL || 'http://formio-uag:3200');
const ENGINES = new URL(process.env.ENGINES_URL || 'http://uag-engines:3300');
const FLOW_KEY = process.env.FLOW_KEY || '';
const MAX_BUFFER = 1000;
const MAX_DETAIL = 8 * 1024;
const MAX_CHUNK_EVENTS = 20;
// The same rule the UAG applies to an incoming X-Request-Id.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const events = [];
const clients = new Set();
let nextId = 1;
// Legs are numbered as they arrive, apart from the events: a leg emits its first only once its body is in.
let nextLeg = 1;

function emit(event) {
    event.id = nextId++;
    event.ts = new Date().toISOString();
    events.push(event);
    if (events.length > MAX_BUFFER) events.shift();
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(frame);
}

function truncate(text) {
    if (!text) return '';
    return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}… [+${text.length - MAX_DETAIL} bytes]` : text;
}

function tryJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}

/** The data of one server-sent event frame: its `data:` lines, joined. */
function frameData(frame) {
    return frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
}

/** Pull the parts of a request worth showing out of its path and body. */
export function describeRequest(url, body) {
    const pathname = url.split('?')[0];
    if (pathname.startsWith('/v1/engines')) {
        const [, , , name, operation] = pathname.split('/');
        if (!name) return { kind: 'engine', label: 'engines: describe', summary: '' };
        const json = tryJson(body);
        const fields = Array.isArray(json?.fields) ? json.fields.map((field) => field.path) : [];
        const questions = json?.questions ? Object.keys(json.questions) : [];
        const tools = Array.isArray(json?.tools) ? json.tools.map((tool) => tool.name) : [];
        return {
            kind: 'engine',
            engine: name,
            operation: operation || '',
            label: `${name} ${operation || ''}`.trim(),
            summary: [
                fields.length ? `${fields.length} field${fields.length === 1 ? '' : 's'}: ${fields.join(', ')}` : '',
                questions.length ? `${questions.length} question${questions.length === 1 ? '' : 's'}` : '',
                tools.length ? `may research with ${tools.join(', ')}` : '',
            ].filter(Boolean).join(' · ').slice(0, 240),
        };
    }
    if (pathname.startsWith('/agent/')) {
        const operation = pathname.split('/').pop();
        const json = tryJson(body);
        const form = json?.form || json?.formName || undefined;
        const task = json?.task || json?.persona || undefined;
        return {
            kind: 'agent',
            operation,
            form,
            task,
            submissionId: typeof json?.submissionId === 'string' ? json.submissionId : undefined,
            label: `/agent/${operation}`,
            summary: json ? [
                form ? `form ${form}` : '',
                task ? `task ${task}` : '',
                json.submissionId ? `submission ${json.submissionId}` : '',
            ].filter(Boolean).join(' · ') : '',
        };
    }
    if (pathname.endsWith('/mcp')) {
        const json = tryJson(body);
        if (json?.method === 'tools/call') {
            const args = json.params?.arguments;
            return {
                kind: 'mcp', tool: json.params?.name,
                label: json.params?.name || 'tools/call',
                summary: args ? JSON.stringify(args).slice(0, 240) : '',
            };
        }
        return { kind: 'mcp', label: json?.method || (json ? 'notification' : 'stream'), summary: '' };
    }
    if (pathname.includes('/auth/token')) return { kind: 'auth', label: 'token', summary: '', redact: true };
    if (pathname.includes('/.well-known/')) return { kind: 'auth', label: pathname.split('/').pop(), summary: '' };
    return { kind: 'other', label: pathname.slice(0, 80), summary: '' };
}

/** A short summary of a finished response. */
export function describeResponse(body, contentType) {
    if (!body) return '';
    if (String(contentType || '').includes('text/event-stream')) {
        const frames = body.split(/\n\n/).map(frameData).filter(Boolean);
        const last = tryJson(frames[frames.length - 1] || '');
        if (last?.result?.content) {
            return last.result.content.map((block) => block.text || '').join(' ').replace(/\s+/g, ' ').slice(0, 300);
        }
        if (last && Array.isArray(last.fields || last.data?.fields)) return 'done';
        return `${frames.length} event${frames.length === 1 ? '' : 's'}`;
    }
    const json = tryJson(body);
    if (!json) return '';
    if (json.protocol && json.values) {
        const calls = (json.toolCalls || []).map((call) => `${call.name}${call.isError ? ' (refused)' : ''}`);
        const answered = Object.keys(json.values);
        return `${json.model}: ${answered.length ? answered.join(', ') : 'no values'}${calls.length ? ` · researched with ${calls.join(', ')}` : ''}`.slice(0, 300);
    }
    if (json.protocol && json.answers) return `${json.model}: ${Object.keys(json.answers).length} answer(s)`;
    if (json.written) {
        const written = Object.keys(json.written);
        return written.length ? `saved ${written.join(', ')}`.slice(0, 300) : 'nothing to save';
    }
    if (json.error) return String(json.error).slice(0, 300);
    return '';
}

function keyMatches(given) {
    if (!FLOW_KEY) return true;
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(FLOW_KEY);
    return a.length === b.length && timingSafeEqual(a, b);
}

function serveStream(req, res) {
    if (!keyMatches(req.headers['x-flow-key'])) {
        res.writeHead(401);
        res.end();
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    // A reconnecting reader asks only for what it missed.
    const after = parseInt(req.headers['last-event-id'] || '0', 10) || 0;
    for (const event of events) {
        if (event.id > after) res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    clients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
    });
}

function proxy(req, res, { uag, engines }) {
    const url = req.url || '/';
    const target = url.startsWith('/v1/engines') ? engines : uag;
    const reqId = `r${nextLeg++}`;
    const started = Date.now();
    const incoming = String(req.headers['x-request-id'] || '');
    const requestId = SAFE_ID.test(incoming) ? incoming : `flow-${randomUUID()}`;

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        const text = body.toString('utf8');
        const description = describeRequest(url, text);
        const { redact, ...shown } = description;
        // Health checks and the stream channel's keep-alive GETs are noise.
        const quiet = req.method === 'GET' && (shown.kind === 'mcp' || url === '/' || url.startsWith('/health'));
        if (!quiet) {
            emit({ reqId, requestId, phase: 'request', method: req.method, path: url.split('?')[0].slice(0, 200), ...shown, detail: redact ? '[redacted]' : truncate(text) });
        }

        // What every event after the request repeats, to tie it to its leg.
        const leg = { reqId, requestId, kind: shown.kind, label: shown.label };
        const headers = { ...req.headers, host: target.host, 'x-request-id': requestId };
        if (body.length) headers['content-length'] = String(body.length);
        const upstream = http.request({
            protocol: target.protocol, hostname: target.hostname, port: target.port, path: url, method: req.method, headers,
        }, (up) => {
            res.writeHead(up.statusCode || 502, up.headers);
            const streaming = String(up.headers['content-type'] || '').includes('text/event-stream');
            let captured = '';
            let chunkEvents = 0;
            let pending = '';
            // A character split across chunks is decoded whole.
            const decoder = new StringDecoder('utf8');
            up.on('data', (chunk) => {
                res.write(chunk);
                // A quiet request is never shown, and past the caps nothing more is read.
                if (quiet) return;
                const capturing = captured.length < MAX_DETAIL * 4;
                const parsing = streaming && chunkEvents < MAX_CHUNK_EVENTS;
                if (!capturing && !parsing) return;
                const piece = decoder.write(chunk);
                if (capturing) captured += piece;
                if (!parsing) return;
                pending += piece;
                let index;
                while ((index = pending.indexOf('\n\n')) >= 0 && chunkEvents < MAX_CHUNK_EVENTS) {
                    const frame = pending.slice(0, index);
                    pending = pending.slice(index + 2);
                    const eventName = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
                    const data = frameData(frame);
                    if (!data) continue;
                    chunkEvents++;
                    const json = tryJson(data);
                    emit({
                        ...leg, phase: 'chunk', event: eventName,
                        summary: eventName === 'result' && json?.engines
                            ? json.engines.map((engine) => `${engine.engine} answered in ${engine.latencyMs ?? '?'} ms`).join(' · ')
                            : json?.method ? `↦ ${json.method}` : eventName || '',
                        detail: redact ? '' : truncate(data),
                    });
                }
            });
            up.on('end', () => {
                res.end();
                if (quiet) return;
                emit({
                    ...leg, phase: 'response',
                    status: up.statusCode, ms: Date.now() - started,
                    summary: redact ? (up.statusCode === 200 ? 'token issued' : '') : describeResponse(captured, up.headers['content-type']),
                    detail: redact ? '[redacted]' : truncate(captured),
                });
            });
        });
        upstream.on('error', (err) => {
            // The reason stays in this log: the viewer shows visitors no internal addresses.
            console.error(`uag-flow: ${req.method} ${url.split('?')[0]} failed: ${err.message}`);
            if (!quiet) {
                emit({ ...leg, phase: 'response', status: 502, ms: Date.now() - started, summary: 'the service did not answer' });
            }
            if (!res.headersSent) res.writeHead(502);
            res.end('uag-flow: upstream error');
        });
        upstream.end(body);
    });
}

export function createServer({ uag = UAG, engines = ENGINES } = {}) {
    return http.createServer((req, res) => {
        const pathname = (req.url || '/').split('?')[0];
        if (pathname === '/flow/events') return serveStream(req, res);
        if (pathname === '/flow/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
            return;
        }
        proxy(req, res, { uag, engines });
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    createServer().listen(PORT, () => console.log(`uag-flow listening on ${PORT} (uag ${UAG.origin}, engines ${ENGINES.origin})`));
}
