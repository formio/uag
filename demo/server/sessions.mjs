/**
 * Visitor sessions.
 *
 * A visitor is identified by a signed cookie holding a random id. Everything
 * the live demos keep about a visitor lives in memory against that id: the
 * conversation, the submissions they created, and the flow events of their own
 * runs. The site runs as a single instance, so a Map is enough; restarting it
 * starts every visitor afresh.
 *
 * Each session also has a short `tag`, derived from its id, which the demo puts
 * in the X-Request-Id of every call it makes on the visitor's behalf. The flow
 * viewer uses it to show a visitor only their own runs, without the id itself
 * ever appearing in a request or a log.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// `__Host-` keeps a sibling subdomain from planting the cookie; it needs HTTPS.
const COOKIE = 'uagdemo';
const SECURE_COOKIE = '__Host-uagdemo';
const IDLE_MS = 6 * 60 * 60_000;
const MAX_SESSIONS = 20_000;

export class Sessions {
    constructor({ secret, secure }) {
        this.secret = secret;
        this.secure = secure;
        this.cookie = secure ? SECURE_COOKIE : COOKIE;
        this.byId = new Map();
        this.byTag = new Map();
        this.sweeper = setInterval(() => this.sweep(), 10 * 60_000);
        this.sweeper.unref();
    }

    sign(value) {
        return createHmac('sha256', this.secret).update(value).digest('base64url');
    }

    /** The session id in a signed cookie value, when the signature holds. */
    verify(cookie) {
        const [id, signature] = String(cookie || '').split('.');
        if (!id || !signature || !/^[A-Za-z0-9_-]{22,64}$/.test(id)) return null;
        const expected = Buffer.from(this.sign(id));
        const actual = Buffer.from(signature);
        return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
    }

    create(id = randomBytes(18).toString('base64url')) {
        if (this.byId.size >= MAX_SESSIONS) this.evictOldest();
        const tag = this.sign(`tag:${id}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toLowerCase();
        const session = {
            id,
            tag,
            created: Date.now(),
            lastSeen: Date.now(),
            verifiedUntil: 0,
            chat: { messages: [], turns: 0 },
            // Submission id -> { form, created }, for the submissions this visitor made.
            submissions: new Map(),
            // X-Request-Ids of runs started on this visitor's behalf by something else (a webhook).
            requestIds: new Set(),
            flow: { events: [], bytes: 0, clients: new Set() },
        };
        this.byId.set(id, session);
        this.byTag.set(tag, session);
        return session;
    }

    /**
     * Express middleware: attach `req.session`, issuing the cookie on a
     * visitor's first request. `allowNew(req)` may refuse to start a session,
     * so a flood of cookieless requests cannot push real visitors out.
     */
    middleware({ allowNew = () => true } = {}) {
        return (req, res, next) => {
            const id = this.verify(readCookie(req.headers.cookie, this.cookie));
            let session = id && this.byId.get(id);
            if (!session) {
                if (!allowNew(req)) {
                    res.status(429).set('Retry-After', '600').json({ error: 'Too many new visitors from your network. Please try again in a few minutes.', code: 'rate_limited' });
                    return;
                }
                session = this.create(id || undefined);
                res.append('Set-Cookie', [
                    `${this.cookie}=${session.id}.${this.sign(session.id)}`,
                    'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${IDLE_MS / 1000}`,
                    ...(this.secure ? ['Secure'] : []),
                ].join('; '));
            }
            session.lastSeen = Date.now();
            req.session = session;
            next();
        };
    }

    /** A new X-Request-Id for a call made on this session's behalf. */
    requestId(session) {
        return `demo.${session.tag}.${randomBytes(6).toString('hex')}`;
    }

    /** The session a demo request id belongs to. */
    fromRequestId(requestId) {
        const match = /^demo\.([a-z0-9]{12})\./.exec(String(requestId || ''));
        return match ? this.byTag.get(match[1]) || null : null;
    }

    remove(session) {
        this.byId.delete(session.id);
        this.byTag.delete(session.tag);
        for (const client of session.flow.clients) client.end();
        this.onRemove?.(session);
    }

    /**
     * At the cap, make room by removing the longest-idle session that has
     * nothing to lose (not verified, no submissions, no open stream). Only
     * when every session has something is the longest-idle one removed.
     */
    evictOldest() {
        let idle = null;
        let oldest = null;
        for (const session of this.byId.values()) {
            if (!oldest || session.lastSeen < oldest.lastSeen) oldest = session;
            const disposable = !session.verifiedUntil && !session.submissions.size && !session.flow.clients.size;
            if (disposable && (!idle || session.lastSeen < idle.lastSeen)) idle = session;
        }
        if (idle || oldest) this.remove(idle || oldest);
    }

    sweep() {
        const cutoff = Date.now() - IDLE_MS;
        for (const session of [...this.byId.values()]) {
            if (session.lastSeen < cutoff && !session.flow.clients.size) this.remove(session);
        }
    }

    close() {
        clearInterval(this.sweeper);
    }
}

export function readCookie(header, name) {
    for (const part of String(header || '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return '';
}
