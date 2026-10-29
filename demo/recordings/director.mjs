/**
 * Records one demo scene as a stream of PNG frames, with a drawn cursor and
 * captions, for encode.py to turn into a GIF.
 *
 * Frames come from Chromium's screencast (CDP Page.startScreencast), which sends
 * a frame only when the screen changes, stamped with its time. The director
 * keeps a timeline of edits beside them: `cut` drops what happens inside it
 * (signing in), and `fastForward` speeds it up (waiting for a model), with a
 * badge that says so. `focus` frames the GIF on part of the screen: encode.py
 * crops every frame to that view and pans between views.
 */
import fs from 'node:fs';
import path from 'node:path';

const CURSOR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8.5-6.2 1.4 3.6 6.6-2.6 1.4-3.6-6.6L3.6 18z" fill="#0c141d" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

// Installed in every document the page loads; only the top document draws.
function installOverlay(cursorSvg) {
    if (window.top !== window) return;
    const mount = () => {
        if (document.getElementById('rec-overlay')) return;
        const style = document.createElement('style');
        style.textContent = `
            #rec-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
            #rec-cursor { position: absolute; width: 22px; height: 22px; transform: translate(-3px, -2px); transition: transform .08s; }
            #rec-cursor.down { transform: translate(-3px, -2px) scale(.85); }
            #rec-ripple { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #69b342; opacity: 0; }
            #rec-ripple.go { animation: rec-ripple .5s ease-out; }
            @keyframes rec-ripple { from { opacity: .9; transform: scale(.3); } to { opacity: 0; transform: scale(1.4); } }
            #rec-frame { position: absolute; left: 0; top: 0; width: 100%; height: 100%; --k: 1;
                transition: left .45s cubic-bezier(.45, 0, .55, 1), top .45s cubic-bezier(.45, 0, .55, 1), width .45s cubic-bezier(.45, 0, .55, 1), height .45s cubic-bezier(.45, 0, .55, 1); }
            #rec-caption { position: absolute; left: 50%; bottom: calc(22px * var(--k)); transform: translateX(-50%) scale(var(--k)); transform-origin: 50% 100%; max-width: 1040px; display: flex; align-items: center; gap: 12px;
                background: rgba(12, 20, 29, .92); color: #fff; padding: 12px 20px 12px 12px; border-radius: 999px; font-size: 18px; font-weight: 600; letter-spacing: -.01em;
                box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transition: opacity .25s; white-space: nowrap; }
            #rec-caption.on { opacity: 1; }
            #rec-caption b { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #69b342; font-size: 15px; flex: none; }
            #rec-caption code { font-family: ui-monospace, Menlo, Consolas, monospace !important; font-size: 16px !important; color: #c9f2b2 !important; background: none !important; border: 0 !important; padding: 0 !important; }
            #rec-speed { position: absolute; top: calc(86px * var(--k)); right: calc(24px * var(--k)); transform: scale(var(--k)); transform-origin: 100% 0; background: #fbbb2c; color: #0c141d; font-size: 14px; font-weight: 700; padding: 6px 12px; border-radius: 999px; opacity: 0; transition: opacity .2s; }
            #rec-speed.on { opacity: 1; }`;
        const root = document.createElement('div');
        root.id = 'rec-overlay';
        root.innerHTML = `<div id="rec-ripple"></div><div id="rec-cursor">${cursorSvg}</div><div id="rec-frame"><div id="rec-caption"></div><div id="rec-speed"></div></div>`;
        document.documentElement.append(style, root);
        const state = window.__recState || { x: -50, y: -50 };
        const cursor = root.querySelector('#rec-cursor');
        cursor.style.left = `${state.x}px`;
        cursor.style.top = `${state.y}px`;
        if (state.caption) window.__rec.caption(state.caption);
        window.__rec.view(state.view, state.scale);
    };
    window.__rec = {
        move(x, y) {
            window.__recState = { ...(window.__recState || {}), x, y };
            const cursor = document.getElementById('rec-cursor');
            if (cursor) { cursor.style.left = `${x}px`; cursor.style.top = `${y}px`; }
        },
        press(down) {
            const cursor = document.getElementById('rec-cursor');
            cursor?.classList.toggle('down', down);
            if (down) {
                const ripple = document.getElementById('rec-ripple');
                const { x, y } = window.__recState || {};
                ripple.style.left = `${x}px`;
                ripple.style.top = `${y}px`;
                ripple.classList.remove('go');
                void ripple.offsetWidth;
                ripple.classList.add('go');
            }
        },
        caption(html) {
            window.__recState = { ...(window.__recState || {}), caption: html };
            const el = document.getElementById('rec-caption');
            if (!el) return;
            if (html) el.innerHTML = html;
            el.classList.toggle('on', Boolean(html));
        },
        // Keep the caption and the badge inside the part of the screen the GIF
        // shows (a view, in fractions of the screen), at the same size in the GIF
        // whatever the view and the screen: `scale` is the screen's width over the
        // recording's full width.
        view(rect, scale = 1) {
            window.__recState = { ...(window.__recState || {}), view: rect, scale };
            const el = document.getElementById('rec-frame');
            if (!el) return;
            const { x = 0, y = 0, w = 1, h = 1 } = rect || {};
            Object.assign(el.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` });
            el.style.setProperty('--k', String(w * scale));
        },
        speed(text) {
            const el = document.getElementById('rec-speed');
            if (!el) return;
            if (text) el.textContent = text;
            el.classList.toggle('on', Boolean(text));
        },
    };
    if (document.documentElement) mount();
    document.addEventListener('DOMContentLoaded', mount);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Call `step(eased progress)` until `duration` ms have passed, however long each step takes. */
async function animate(duration, step) {
    const start = Date.now();
    for (;;) {
        const k = Math.min(1, (Date.now() - start) / duration);
        await step(k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
        if (k >= 1) return;
        await sleep(12);
    }
}

export class Director {
    /** Open a recording page: `width` x `height`, frames written to `dir`. */
    static async open(browser, { width = 1280, height = 880, dir }) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        await context.addInitScript(installOverlay, CURSOR);
        const page = await context.newPage();
        const director = new Director(context, page, dir);
        director.full = { width, height };
        director.viewport = { width, height };
        await director.startCapture(width, height);
        return director;
    }

    constructor(context, page, dir) {
        this.context = context;
        this.page = page;
        this.dir = dir;
        this.frames = [];
        this.edits = [];
        this.marks = [];
        this.views = [];
        this.cursor = { x: 640, y: 440 };
        this.state = { caption: '', view: null };
    }

    async startCapture(width, height) {
        this.cdp = await this.context.newCDPSession(this.page);
        this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
            const file = `${String(this.frames.length).padStart(5, '0')}.png`;
            fs.writeFileSync(path.join(this.dir, file), Buffer.from(data, 'base64'));
            this.frames.push({ file, t: metadata.timestamp });
            this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        });
        await this.cdp.send('Page.startScreencast', { format: 'png', maxWidth: width, maxHeight: height, everyNthFrame: 1 });
    }

    now() {
        return Date.now() / 1000;
    }

    /** Navigate, on the full screen, then put the cursor and caption back on the new document. */
    async goto(url) {
        if (this.viewport.width !== this.full.width) await this.resize(this.full.width);
        await this.page.goto(url, { waitUntil: 'networkidle' });
        await this.restore();
    }

    async restore() {
        await this.page.evaluate(({ x, y, caption, view, scale }) => {
            window.__rec?.move(x, y);
            window.__rec?.caption(caption);
            window.__rec?.view(view, scale);
        }, { ...this.cursor, caption: this.state.caption, view: this.state.view, scale: this.scale }).catch(() => {});
    }

    /** The screen's width over the recording's full width. */
    get scale() {
        return this.viewport.width / this.full.width;
    }

    /**
     * Narrow the screen to `width`, keeping its shape, so the page lays out
     * smaller and reads larger in the GIF, which is scaled to one size.
     */
    async resize(width) {
        const height = Math.round(width * this.full.height / this.full.width);
        this.viewport = { width, height };
        await this.page.setViewportSize(this.viewport);
        await this.restore();
    }

    async caption(step, html) {
        // The GIF starts at the first caption, after the scene has set itself up.
        this.begin ??= this.now();
        this.marks.push({ t: this.now(), step });
        this.state.caption = html ? `<b>${step}</b><span>${html}</span>` : '';
        await this.page.evaluate((c) => window.__rec?.caption(c), this.state.caption);
        await sleep(300);
    }

    async hold(ms) {
        await sleep(ms);
    }

    /** Glide the cursor to an element's center, or to `{ x, y }`. */
    async moveTo(target, { duration = 650, offset = { x: 0, y: 0 } } = {}) {
        let to = target;
        if (typeof target.boundingBox === 'function') {
            await target.waitFor({ state: 'visible' });
            await target.scrollIntoViewIfNeeded().catch(() => {});
            const box = await target.boundingBox();
            to = { x: box.x + box.width / 2 + offset.x, y: box.y + box.height / 2 + offset.y };
        }
        const from = { ...this.cursor };
        await animate(duration, async (e) => {
            const x = from.x + (to.x - from.x) * e;
            const y = from.y + (to.y - from.y) * e;
            await this.page.mouse.move(x, y);
            await this.page.evaluate(([px, py]) => window.__rec?.move(px, py), [x, y]);
        });
        this.cursor = to;
    }

    async click(target, options = {}) {
        await this.moveTo(target, options);
        await this.page.evaluate(() => window.__rec?.press(true));
        await sleep(120);
        await target.click();
        await this.page.evaluate(() => window.__rec?.press(false));
        await sleep(options.after ?? 450);
    }

    /** Click into a field and type into it, a key at a time. */
    async type(target, text, { delay = 32, clear = false } = {}) {
        await this.click(target, { after: 150 });
        if (clear) await target.fill('');
        await target.pressSequentially(text, { delay });
        await sleep(350);
    }

    /** Scroll the top document smoothly to `y`. */
    async scrollTo(y, options) {
        await this.scrollFrame(this.page.mainFrame(), y, options);
    }

    /** Scroll a frame's own document (an app inside an iframe) to `y`. */
    async scrollFrame(frame, y, { duration = 700 } = {}) {
        const start = await frame.evaluate(() => window.scrollY);
        await animate(duration, (e) => frame.evaluate((v) => window.scrollTo(0, v), start + (y - start) * e));
    }

    /**
     * Scroll an element that scrolls on its own (a panel with overflow: auto)
     * to `y`, or by `by` from where it is.
     */
    async scrollElement(target, { y, by, duration = 700 } = {}) {
        await target.waitFor();
        const start = await target.evaluate((el) => el.scrollTop);
        const end = y ?? start + by;
        await animate(duration, (e) => target.evaluate((el, v) => { el.scrollTop = v; }, start + (end - start) * e));
    }

    /**
     * Frame the GIF on `targets` (a locator, or several), with `pad` around
     * them, or on the whole screen with `null`. The view keeps the screen's
     * shape and is never narrower than `minWidth` (the GIF's width, at the full
     * screen), so encode.py never scales text up past its own size; it pans to
     * each new view.
     */
    async focus(targets, { pad = 28, minWidth = 960 } = {}) {
        if (!targets) return this.setView(null);
        const list = Array.isArray(targets) ? targets : [targets];
        for (const target of list) await target.waitFor({ state: 'visible' });
        await list[0].scrollIntoViewIfNeeded().catch(() => {});
        const boxes = [];
        for (const target of list) boxes.push(await target.boundingBox());
        const { width: W, height: H } = this.viewport;
        const minW = minWidth * this.scale;
        const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
        const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
        const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
        const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
        const w = Math.min(W, Math.max(minW, x1 - x0, (y1 - y0) * W / H));
        const h = w * H / W;
        const clamp = (v, max) => Math.min(Math.max(v, 0), max);
        const round = (v) => Math.round(v * 10000) / 10000;
        // In fractions of the screen, as the screen's size can change.
        const view = { x: round(clamp((x0 + x1 - w) / 2, W - w) / W), y: round(clamp((y0 + y1 - h) / 2, H - h) / H), w: round(w / W), h: round(h / H) };
        return this.setView(w >= W ? null : view);
    }

    async setView(view) {
        this.views.push({ t: this.now(), view });
        this.state.view = view;
        await this.page.evaluate(([v, scale]) => window.__rec?.view(v, scale), [view, this.scale]).catch(() => {});
        await sleep(500);
    }

    /** Everything `fn` shows is left out of the GIF. */
    async cut(fn) {
        const start = this.now();
        // The next page starts without the last step's caption, on the whole screen.
        this.state.caption = '';
        await this.page.evaluate(() => window.__rec?.caption('')).catch(() => {});
        if (this.state.view) await this.setView(null);
        try {
            return await fn();
        }
        finally {
            await sleep(200);
            this.edits.push({ kind: 'cut', start, end: this.now() });
        }
    }

    /**
     * Run `fn` (usually a wait for a model) and play it back `factor` times
     * faster, never longer than `max` seconds, with a "sped up" badge.
     */
    async fastForward(fn, { factor = 8, max = 2.5, label = 'Sped up' } = {}) {
        await this.page.evaluate((t) => window.__rec?.speed(`⏩ ${t}`), label);
        await sleep(250);
        const start = this.now();
        let result;
        try {
            result = await fn();
        }
        finally {
            const end = this.now();
            this.edits.push({ kind: 'speed', start, end, factor, max });
            await this.page.evaluate(() => window.__rec?.speed('')).catch(() => {});
            await sleep(300);
        }
        return result;
    }

    async close() {
        this.end = this.now();
        await sleep(400);
        await this.cdp.send('Page.stopScreencast').catch(() => {});
        await sleep(200);
        fs.writeFileSync(path.join(this.dir, 'timeline.json'), JSON.stringify({ begin: this.begin, end: this.end, marks: this.marks, views: this.views, frames: this.frames, edits: this.edits }, null, 2));
        await this.context.close();
    }
}
