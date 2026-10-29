/**
 * The flow viewer's back end: reads the flow proxy's event stream and hands
 * each visitor the events of their own runs, and nothing else.
 *
 * An event belongs to a visitor when its X-Request-Id is one the demo made for
 * them (`demo.<tag>.<random>`): their chat turns, their form's extractions, and
 * the runs their submissions start (the UAG passes the submission's request id
 * on to them), including the engine and research legs the UAG and the engine
 * server forwarded it on.
 */
import { networkOf } from './guard.mjs';

const MAX_EVENTS_PER_SESSION = 400;
// What one visitor's buffer may hold, and how much of each event's body is kept.
const MAX_BYTES_PER_SESSION = 1024 * 1024;
const MAX_DETAIL = 4096;

export class FlowHub {
    constructor({ url, key, streamsPerNetwork = 10 }, sessions, fetch = globalThis.fetch) {
        this.url = url;
        this.streamsPerNetwork = streamsPerNetwork;
        // Open streams, by client network.
        this.streams = new Map();
        this.key = key;
        this.sessions = sessions;
        this.fetch = fetch;
        // Each buffered event's serialized size, so dropping one need not serialize it again.
        this.sizes = new WeakMap();
        this.lastEventId = 0;
        this.connected = false;
        this.stopped = false;
    }

    get enabled() {
        return !!this.url;
    }

    /** Record that `session` made submission `id`, so the runs that start from it are theirs. */
    own(session, id, form) {
        session.submissions.set(id, { form, created: Date.now() });
    }

    start() {
        if (!this.enabled) return;
        const loop = async () => {
            while (!this.stopped) {
                try {
                    await this.read();
                }
                catch (err) {
                    if (!this.stopped) console.error(`The flow stream dropped (${err.message}); reconnecting.`);
                }
                this.connected = false;
                if (!this.stopped) await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        };
        loop();
    }

    async read() {
        this.abort = new AbortController();
        const response = await this.fetch(`${this.url}/flow/events`, {
            headers: { Accept: 'text/event-stream', 'x-flow-key': this.key, ...(this.lastEventId && { 'Last-Event-ID': String(this.lastEventId) }) },
            signal: this.abort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        this.connected = true;
        const decoder = new TextDecoder();
        let pending = '';
        for await (const chunk of response.body) {
            pending += decoder.decode(chunk, { stream: true });
            let index;
            while ((index = pending.indexOf('\n\n')) >= 0) {
                const frame = pending.slice(0, index);
                pending = pending.slice(index + 2);
                const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
                if (!data) continue;
                try {
                    this.route(JSON.parse(data));
                }
                catch (err) {
                    console.error('Unreadable flow event:', err.message);
                }
            }
        }
    }

    /** The session an event belongs to, or null. */
    ownerOf(event) {
        return this.sessions.fromRequestId(event.requestId);
    }

    route(event) {
        if (event.id) this.lastEventId = event.id;
        const session = this.ownerOf(event);
        if (!session) return;
        const shown = { ...event, run: event.requestId };
        delete shown.requestId;
        if (typeof shown.detail === 'string' && shown.detail.length > MAX_DETAIL) shown.detail = `${shown.detail.slice(0, MAX_DETAIL)}… [truncated]`;
        const json = JSON.stringify(shown);
        const buffer = session.flow.events;
        buffer.push(shown);
        this.sizes.set(shown, json.length);
        session.flow.bytes += json.length;
        while (buffer.length > 1 && (buffer.length > MAX_EVENTS_PER_SESSION || session.flow.bytes > MAX_BYTES_PER_SESSION)) {
            session.flow.bytes -= this.sizes.get(buffer.shift());
        }
        const frame = `data: ${json}\n\n`;
        for (const client of session.flow.clients) client.write(frame);
    }

    /** GET /api/flow/stream: this visitor's events, then the new ones as they happen. */
    stream() {
        return (req, res) => {
            const network = networkOf(req.ip);
            const open = this.streams.get(network) || 0;
            if (open >= this.streamsPerNetwork) {
                res.status(429).json({ error: 'Too many open flow views from your network.', code: 'rate_limited' });
                return;
            }
            this.streams.set(network, open + 1);
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                // Ask proxies in front of the site not to buffer the stream.
                'X-Accel-Buffering': 'no',
            });
            res.write(`event: hello\ndata: ${JSON.stringify({ enabled: this.enabled, connected: this.connected })}\n\n`);
            for (const event of req.session.flow.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
            const clients = req.session.flow.clients;
            // A visitor with many tabs open gets a stream per tab, up to a few.
            if (clients.size >= 6) clients.values().next().value.end();
            clients.add(res);
            const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
            req.on('close', () => {
                clearInterval(heartbeat);
                clients.delete(res);
                const left = (this.streams.get(network) || 1) - 1;
                if (left > 0) this.streams.set(network, left);
                else this.streams.delete(network);
            });
        };
    }

    clear(session) {
        session.flow.events.length = 0;
        session.flow.bytes = 0;
    }

    stop() {
        this.stopped = true;
        this.abort?.abort();
    }
}
