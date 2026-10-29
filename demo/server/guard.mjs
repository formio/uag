/**
 * Spend protection for the live demos, which call real models on Form.io's keys.
 *
 * Three layers, checked in this order on every request that can reach a model:
 *
 *   1. Verification: when Turnstile keys are configured (they are required in
 *      production), a visitor solves one challenge and may then use the demos
 *      for TURNSTILE_VALID_MINUTES.
 *   2. Rate limits: per client network (an IPv4 address, or an IPv6 /64), then
 *      per session, for each operation; and a daily allowance per network.
 *   3. The daily budget: units per UTC day across every visitor. A request
 *      costs a unit up front, and the chat also pays for the model tokens its
 *      turn actually used (`spendTokens`). Once the budget is spent the demos
 *      say so until midnight UTC, and the rest of the site keeps working.
 *
 * Refusals are JSON `{ error, code }`, which the demo pages turn into a message.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isIPv6 } from 'node:net';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Counters kept at once; past this the oldest go first, so a flood costs no more memory.
const MAX_COUNTERS = 100_000;

/**
 * The key a client is rate limited by: its IPv4 address, or the /64 of its
 * IPv6 address, which a single host can otherwise rotate through freely.
 */
export function networkOf(ip) {
    const address = String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
    if (!isIPv6(address)) return address;
    const [head, tail = ''] = address.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const groups = address.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
    return `${groups.slice(0, 4).map((group) => parseInt(group || '0', 16).toString(16)).join(':')}::/64`;
}

/** Fixed-window counters, keyed by `<operation>:<scope>:<key>`. */
export class Windows {
    constructor(max = MAX_COUNTERS) {
        this.max = max;
        this.counters = new Map();
        this.sweeper = setInterval(() => this.sweep(), 60_000);
        this.sweeper.unref();
    }

    /** Count one hit; answer the seconds to wait when it is over the limit, or 0. */
    hit(key, { limit, windowMs }, amount = 1) {
        const now = Date.now();
        let counter = this.counters.get(key);
        if (!counter || counter.resetAt <= now) {
            if (this.counters.size >= this.max) this.counters.delete(this.counters.keys().next().value);
            counter = { count: 0, resetAt: now + windowMs };
            this.counters.set(key, counter);
        }
        if (counter.count + amount > limit) return Math.max(1, Math.ceil((counter.resetAt - now) / 1000));
        counter.count += amount;
        return 0;
    }

    sweep() {
        const now = Date.now();
        for (const [key, counter] of this.counters) {
            if (counter.resetAt <= now) this.counters.delete(key);
        }
    }

    close() {
        clearInterval(this.sweeper);
    }
}

/** The daily budget, kept in DEMO_STATE_DIR when it is set so a restart does not reset it. */
class Budget {
    constructor({ daily, stateDir }) {
        this.daily = daily;
        this.file = stateDir ? path.join(stateDir, 'budget.json') : '';
        this.state = { day: today(), used: 0 };
        if (this.file) {
            try {
                const stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
                if (stored.day === this.state.day && Number.isFinite(stored.used)) this.state.used = stored.used;
            }
            catch {
                // No state yet.
            }
        }
    }

    roll() {
        const day = today();
        if (this.state.day !== day) this.state = { day, used: 0 };
    }

    /** Whether `units` more fit today. */
    available(units) {
        this.roll();
        return !this.daily || this.state.used + units <= this.daily;
    }

    spend(units) {
        this.roll();
        this.state.used += units;
        this.save();
    }

    /**
     * Write the state, one write at a time: spends made during a write are saved
     * by one more after it. Written aside and renamed into place, so a crash
     * mid-write leaves the last count rather than a file that reads as none.
     */
    save() {
        if (!this.file) return;
        if (this.saving) {
            this.dirty = true;
            return;
        }
        const temporary = `${this.file}.tmp`;
        this.saving = fs.promises.mkdir(path.dirname(this.file), { recursive: true })
            .then(() => fs.promises.writeFile(temporary, JSON.stringify(this.state)))
            .then(() => fs.promises.rename(temporary, this.file))
            .catch((err) => console.error('Could not save the demo budget:', err.message))
            .finally(() => {
                this.saving = null;
                if (this.dirty) {
                    this.dirty = false;
                    this.save();
                }
            });
    }

    /** Wait for the writes in progress, and the ones they queued. */
    async flush() {
        while (this.saving) await this.saving;
    }

    status() {
        this.roll();
        return { daily: this.daily, used: this.state.used, remaining: this.daily ? Math.max(0, this.daily - this.state.used) : null };
    }
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60_000;

export class Guard {
    constructor(config, { fetch = globalThis.fetch } = {}) {
        this.config = config;
        this.fetch = fetch;
        this.windows = new Windows();
        this.budget = new Budget({ daily: config.budget.daily, stateDir: config.stateDir });
    }

    get verificationRequired() {
        return !!(this.config.turnstile.siteKey && this.config.turnstile.secretKey);
    }

    isVerified(session) {
        return !this.verificationRequired || session.verifiedUntil > Date.now();
    }

    /** Check a Turnstile token with Cloudflare, and mark the session verified when it passes. */
    async verify(session, token, ip) {
        if (!this.verificationRequired) return true;
        if (typeof token !== 'string' || !token || token.length > 4096) return false;
        // Each check is a call to Cloudflare, so a network gets a few a minute.
        if (this.windows.hit(`verify:ip:${networkOf(ip)}`, { limit: 10, windowMs: 60_000 })) return false;
        const body = new URLSearchParams({ secret: this.config.turnstile.secretKey, response: token });
        if (ip) body.set('remoteip', ip);
        try {
            const response = await this.fetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
            const result = await response.json();
            if (!result.success) return false;
        }
        catch (err) {
            console.error('Turnstile verification failed:', err.message);
            return false;
        }
        session.verifiedUntil = Date.now() + this.config.turnstile.validMs;
        return true;
    }

    /**
     * Middleware for an operation that reaches a model. `units` is what one
     * request costs, or a function of the request. Mount it after validating
     * the request, so a request that would be refused anyway costs nothing.
     */
    protect(operation, units = this.config.budget.costs[operation] ?? 1) {
        return (req, res, next) => {
            const refusal = this.check(req, operation, typeof units === 'function' ? units(req) : units);
            if (refusal) {
                if (refusal.retryAfter) res.set('Retry-After', String(refusal.retryAfter));
                res.status(refusal.status).json({ error: refusal.error, code: refusal.code });
                return;
            }
            next();
        };
    }

    /** The refusal for one request, or null after counting it. */
    check(req, operation, units) {
        if (!this.isVerified(req.session)) {
            return { status: 403, code: 'verification_required', error: 'Please confirm you are human to use the live demo.' };
        }
        const network = networkOf(req.ip);
        const limits = this.config.limits[operation] || {};
        // The network first: a refusal there creates no per-session counter.
        for (const [scope, key] of [['ip', network], ['session', req.session.id]]) {
            if (!limits[scope]) continue;
            const wait = this.windows.hit(`${operation}:${scope}:${key}`, limits[scope]);
            if (wait) return this.tooFast(wait);
        }
        if (this.config.budget.perNetwork && this.windows.hit(`budget:ip:${network}`, { limit: this.config.budget.perNetwork, windowMs: DAY_MS }, units)) {
            return this.tooFast(null, 'You have used the live demo a lot today. Please come back tomorrow, or run the UAG yourself.');
        }
        if (!this.budget.available(units)) return this.exhausted();
        this.budget.spend(units);
        return null;
    }

    /**
     * Charge the model tokens a request used, on top of the unit it paid up
     * front. Answers whether the budget still has room, so a long chat turn can
     * stop between model calls.
     */
    spendTokens(req, tokens) {
        const units = Math.ceil(Math.max(0, tokens) / this.config.budget.tokensPerUnit);
        if (units) {
            this.budget.spend(units);
            if (this.config.budget.perNetwork) {
                this.windows.hit(`budget:ip:${networkOf(req.ip)}`, { limit: Number.MAX_SAFE_INTEGER, windowMs: DAY_MS }, units);
            }
        }
        return this.budget.available(1);
    }

    tooFast(wait, error) {
        return {
            status: 429, code: 'rate_limited', ...(wait && { retryAfter: wait }),
            error: error || `You're going a little fast for the demo. Try again in ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`,
        };
    }

    exhausted() {
        return {
            status: 503, code: 'budget_exhausted',
            error: 'The live demo has reached its limit for today. It resets at midnight UTC, or run the UAG yourself in a few minutes.',
        };
    }

    /** What the pages need to know: whether to show the challenge, and whether the demos are available today. */
    status(session) {
        const budget = this.budget.status();
        return {
            turnstileSiteKey: this.verificationRequired ? this.config.turnstile.siteKey : '',
            verified: this.isVerified(session),
            available: budget.remaining === null || budget.remaining > 0,
        };
    }

    close() {
        this.windows.close();
    }
}
