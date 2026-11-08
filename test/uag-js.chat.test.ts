import { expect } from 'chai';
import { JSDOM } from 'jsdom';

/**
 * The chat display of @formio/uag-js, on the real formio.js 5 in a DOM. The
 * UAG is a fake `fetch` given to the chat; Form.io is formio.js's own fetch,
 * replaced, so the form loads from its URL and submissions are seen.
 */
describe('@formio/uag-js chat', function () {
    this.timeout(20000);

    const FORM_URL = 'https://forms.test/myproject/servicerequest';
    const UAG_URL = 'https://uag.test';
    const CHAT_URL = `${UAG_URL}/project/p1/form/f1/agent/chat`;

    const definition = (extra: Record<string, any> = {}) => ({
        _id: 'f1', project: 'p1', title: 'Service request', name: 'servicerequest', path: 'servicerequest',
        tags: ['uag'], display: 'form',
        components: [
            { type: 'textfield', key: 'name', label: 'Your name', input: true, validate: { required: true } },
            {
                type: 'select', key: 'issueType', label: 'Issue', input: true, validate: { required: true },
                data: { values: [{ label: 'Outage', value: 'outage' }, { label: 'Billing', value: 'billing' }] }
            },
            {
                type: 'textarea', key: 'outageDetails', label: 'When did it start?', input: true,
                conditional: { show: true, conjunction: 'all', conditions: [{ component: 'issueType', operator: 'isEqual', value: 'outage' }] }
            },
            { type: 'button', key: 'submit', label: 'Submit', input: true, action: 'submit' }
        ],
        ...extra
    });

    let dom: JSDOM;
    let Formio: any;
    let uag: any;
    const added: string[] = [];
    const saved: Record<string, any> = {};
    let formioRequests: { url: string; method: string; body: any }[] = [];
    let served: any = definition();
    let submitGate: Promise<void> = Promise.resolve();

    before(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/', pretendToBeVisual: true });
        const win: any = dom.window;
        win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } }));
        win.scrollTo = () => { };
        // DOM classes are replaced even when something already defined them
        // (formio.js checks `instanceof HTMLElement`); the originals come back after.
        const isDom = (key: string) => /^(HTML|SVG)|Event$|^(Element|Node|Text|Document|DocumentFragment|EventTarget|MutationObserver|getComputedStyle)$/.test(key);
        for (const key of [...Object.getOwnPropertyNames(win), 'window', 'document']) {
            const exists = key in globalThis;
            if (exists && !isDom(key) && key !== 'window' && key !== 'document') continue;
            try {
                if (exists) saved[key] = (globalThis as any)[key];
                (globalThis as any)[key] = key === 'window' ? win : win[key];
                added.push(key);
            }
            catch {
                // Read-only in Node.
            }
        }
        // formio.js sanitizes with DOMPurify, which binds to the window it is
        // first loaded with: give formio.js its own copy, bound to this DOM.
        const purify = require.resolve('dompurify');
        const earlier = require.cache[purify];
        delete require.cache[purify];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        Formio = require('@formio/js').Formio;
        if (earlier) require.cache[purify] = earlier;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        uag = require('../packages/uag-js');
        Formio.use(uag.UAG(UAG_URL));
        Formio.fetch = async (url: string, init: any = {}) => {
            const method = (init.method || 'GET').toUpperCase();
            formioRequests.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
            const json = (status: number, body: any) => ({
                ok: status < 400, status, url,
                headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null), forEach() { } },
                json: async () => body, text: async () => JSON.stringify(body)
            });
            if (method === 'GET' && url.split('?')[0].startsWith('https://forms.test/myproject/')) return json(200, served);
            if (/\/submission(\/[^/?]+)?$/.test(url.split('?')[0]) && (method === 'POST' || method === 'PUT')) {
                await submitGate;
                return json(method === 'POST' ? 201 : 200, { _id: 's1', data: JSON.parse(init.body).data });
            }
            return json(404, { error: 'not found' });
        };
    });

    after(async () => {
        created.forEach((chat) => chat.destroy(true));
        // formio.js debounces change handling: let its timers run while the DOM is still here.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        for (const key of added) {
            if (key in saved) (globalThis as any)[key] = saved[key];
            else delete (globalThis as any)[key];
        }
        dom.window.close();
    });

    beforeEach(() => {
        formioRequests = [];
        submitGate = Promise.resolve();
        served = definition();
        Formio.clearCache?.();
        Formio.cache = {};
    });

    function element() {
        const div = document.createElement('div');
        document.body.appendChild(div);
        return div;
    }

    type Turn = { url: string; headers: any; body: any };

    /** A fake UAG chat: answers each turn with the next response, recording the turns. */
    function uagChat(responses: any[], status = 200) {
        const turns: Turn[] = [];
        let gate: Promise<void> = Promise.resolve();
        const fetch = async (url: string, init: any) => {
            turns.push({ url, headers: init.headers, body: JSON.parse(init.body) });
            await gate;
            const body = responses.shift() || {};
            return { ok: status < 400, status, text: async () => JSON.stringify(body) };
        };
        return Object.assign(fetch, { turns, hold: (promise: Promise<void>) => { gate = promise; } });
    }

    const reply = (extra: Record<string, any> = {}) => ({
        reply: 'Got it.', patch: {}, data: {}, fields: {}, errors: [],
        remaining: { required: [], optional: [], unsupported: [] }, complete: false, confirmed: false,
        engine: { name: 'claude', model: 'm', latencyMs: 1, toolCalls: [] }, ...extra
    });

    const created: any[] = [];

    async function chatWith(fetch: any, options: Record<string, any> = {}, url = FORM_URL) {
        const chat = await Formio.createChat(element(), url, { fetch, ...options });
        created.push(chat);
        chat.formio.getToken = () => 'formio-token';
        return chat;
    }

    const text = (chat: any) => chat.element.textContent.replace(/\s+/g, ' ');
    const click = (node: any) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    it('renders a form from its URL as a chat, with a greeting, through Formio.createChat', async () => {
        expect(Formio.createChat).to.equal(uag.createChat);
        const chat = await chatWith(uagChat([]));
        expect(chat.constructor.name).to.equal('ChatForm');
        expect(chat.element.querySelector('.uag-chat')).to.not.equal(null);
        expect(text(chat)).to.contain('Hi! I can help you fill in Service request.');
        // The form is there, hidden until the person opens it.
        expect(chat.refs.uagChatForm.hidden).to.equal(true);
        expect(chat.getComponent('name')).to.not.equal(undefined);
    });

    it('renders a definition whose display is chat through Formio.createForm', async () => {
        const chat = await Formio.createForm(element(), definition({ display: 'chat' }), { fetch: uagChat([]) });
        expect(chat.constructor.name).to.equal('ChatForm');
    });

    it('sends the conversation and the form\'s data to the form\'s chat on the UAG with the Form.io token', async () => {
        const fetch = uagChat([reply({ reply: 'Thanks Ada. What is the issue?', patch: { name: 'Ada' } })]);
        const chat = await chatWith(fetch);
        const replies: any[] = [];
        chat.on('chatReply', (response: any) => replies.push(response));
        await chat.send('I am Ada');
        expect(fetch.turns).to.have.length(1);
        expect(fetch.turns[0].url).to.equal(CHAT_URL);
        expect(fetch.turns[0].headers).to.include({ 'x-jwt-token': 'formio-token', 'Content-Type': 'application/json' });
        // The greeting is the chat's own, not part of the conversation.
        expect(fetch.turns[0].body.messages).to.deep.equal([{ role: 'user', content: 'I am Ada' }]);
        expect(fetch.turns[0].body.data).to.be.an('object');
        expect(chat.getComponent('name').getValue()).to.equal('Ada');
        expect(replies).to.have.length(1);
        expect(text(chat)).to.contain('Thanks Ada. What is the issue?');
        expect(chat.messages).to.deep.equal([{ role: 'user', content: 'I am Ada' }, { role: 'assistant', content: 'Thanks Ada. What is the issue?' }]);
    });

    it('lets the form\'s conditionals react to the values, and never overwrites a value the person changed', async () => {
        const fetch = uagChat([
            reply({ patch: { issueType: 'outage' } }),
            reply({ patch: { name: 'Bob', outageDetails: 'Last night' } })
        ]);
        const chat = await chatWith(fetch);
        await chat.send('my internet is out');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(chat.getComponent('outageDetails').visible).to.equal(true);
        // The person types their name in the form.
        chat.getComponent('name').setValue('Ada', { modified: true });
        chat.getComponent('name').triggerChange({ modified: true });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await chat.send('it started last night');
        expect(fetch.turns[1].body.data).to.include({ name: 'Ada', issueType: 'outage' });
        // The UAG is told the person set it, so the conversation never changes it.
        expect(fetch.turns[1].body.locked).to.deep.equal(['name']);
        expect(fetch.turns[0].body.locked).to.deep.equal([]);
        expect(chat.getComponent('name').getValue()).to.equal('Ada');
        expect(chat.getComponent('outageDetails').getValue()).to.equal('Last night');
    });

    it('shows a summary when complete, and submits through the UAG only when the person presses Submit', async () => {
        const fetch = uagChat([reply({ reply: 'Ready to submit?', patch: { name: 'Ada', issueType: 'billing' }, complete: true })]);
        const chat = await chatWith(fetch);
        let completed = 0;
        chat.on('chatComplete', () => completed++);
        await chat.send('I am Ada, my bill is wrong');
        expect(completed).to.equal(1);
        expect(text(chat)).to.contain('Please check your answers');
        expect(text(chat)).to.contain('Your name').and.contain('Ada');
        expect(formioRequests.filter((req) => req.method === 'POST')).to.have.length(0);
        click(chat.element.querySelector('[ref="uagChatSubmit"]'));
        await new Promise((resolve) => setTimeout(resolve, 300));
        const posts = formioRequests.filter((req) => req.method === 'POST');
        expect(posts).to.have.length(1);
        // The routing plugin sends the uag form's submission to the UAG, by id.
        expect(posts[0].url).to.equal(`${UAG_URL}/project/p1/form/f1/submission`);
        expect(posts[0].body.data).to.include({ name: 'Ada', issueType: 'billing' });
        expect(text(chat)).to.contain('Thanks! Your form was submitted.');
        expect(chat.refs.uagChatInput.disabled).to.equal(true);
    });

    it('submits when a turn reports the person confirmed', async () => {
        const fetch = uagChat([
            reply({ patch: { name: 'Ada', issueType: 'billing' }, complete: true }),
            reply({ reply: 'Submitting.', complete: true, confirmed: true })
        ]);
        const chat = await chatWith(fetch);
        await chat.send('Ada, billing');
        await chat.send('yes, submit it');
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(formioRequests.filter((req) => req.method === 'POST')).to.have.length(1);
    });

    it('drops the reply to a turn started before reset, and clears the values the chat wrote', async () => {
        let release: () => void = () => { };
        const fetch = uagChat([reply({ patch: { name: 'Ada' } }), reply({ reply: 'late', patch: { issueType: 'outage' } })]);
        const chat = await chatWith(fetch);
        await chat.send('I am Ada');
        expect(chat.getComponent('name').getValue()).to.equal('Ada');
        fetch.hold(new Promise<void>((resolve) => { release = resolve; }));
        const pending = chat.send('outage');
        chat.reset();
        release();
        await pending;
        expect(chat.getComponent('name').getValue()).to.equal('');
        expect(chat.getComponent('issueType').getValue()).to.equal('');
        expect(text(chat)).to.not.contain('late');
        expect(chat.messages).to.deep.equal([]);
        expect(text(chat)).to.contain('Hi! I can help you fill in Service request.');
    });

    it('shows a failed turn as a notice, emits chatError, and lets the person send again', async () => {
        const fetch = uagChat([{ error: 'Every engine that could answer this chat is over its rate limit.' }], 429);
        const chat = await chatWith(fetch);
        const errors: any[] = [];
        chat.on('chatError', (err: any) => errors.push(err));
        await chat.send('hello');
        expect(errors).to.have.length(1);
        expect(errors[0].status).to.equal(429);
        expect(text(chat)).to.contain('over its rate limit');
        expect(chat.refs.uagChatSend.disabled).to.equal(false);
    });

    it('shows a reply as text, and markdown only through the sanitizer', async () => {
        const evil = 'Hi <img src=x onerror="window.pwned=1"> **there**';
        const plain = await chatWith(uagChat([reply({ reply: evil })]));
        await plain.send('hi');
        const messages = plain.element.querySelectorAll('.uag-chat__message--assistant');
        expect(messages[messages.length - 1].textContent).to.contain('<img src=x');
        expect(plain.element.querySelector('.uag-chat__log img')).to.equal(null);

        const markdown = (value: string) => value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        const rich = await chatWith(uagChat([reply({ reply: evil })]), { markdown });
        await rich.send('hi');
        expect(rich.element.querySelector('.uag-chat__log strong').textContent).to.equal('there');
        const img = rich.element.querySelector('.uag-chat__log img');
        expect(img === null || !img.hasAttribute('onerror')).to.equal(true);
    });

    it('takes templates from options.templates and from the framework, keeping the behaviour', async () => {
        const fetch = uagChat([reply({ reply: 'Custom!' })]);
        const chat = await chatWith(fetch, {
            templates: { uagChatMessage: { form: '<div class="my-msg {{ ctx.role }}">{{ ctx.html }}</div>' } }
        });
        await chat.send('hi');
        expect(chat.element.querySelectorAll('.my-msg.assistant')).to.have.length(2);
        expect(chat.element.querySelector('.my-msg.user').textContent).to.equal('hi');

        const framework = Formio.Templates.framework || 'bootstrap';
        Formio.Templates.extendTemplate(framework, { uagChatNotice: { form: '<p class="fw-notice">{{ ctx.text }}</p>' } });
        try {
            const failing = await chatWith(uagChat([{ error: 'nope' }], 500));
            await failing.send('hi');
            expect(failing.element.querySelector('.fw-notice').textContent).to.equal('nope');
        }
        finally {
            delete Formio.Templates.templates[framework].uagChatNotice;
            delete Formio.Templates.current.uagChatNotice;
        }
    });

    it('translates its strings through options.i18n', async () => {
        const chat = await chatWith(uagChat([]), { language: 'es', i18n: { es: { Send: 'Enviar', 'Start over': 'Empezar de nuevo' } } });
        expect(chat.refs.uagChatSend.textContent).to.equal('Enviar');
        expect(chat.refs.uagChatReset.textContent).to.equal('Empezar de nuevo');
    });

    it('opens the form for a required field the chat cannot collect', async () => {
        const fetch = uagChat([reply({ remaining: { required: [], optional: [], unsupported: [{ path: 'devices', label: 'Devices', required: true, empty: true }] } })]);
        const chat = await chatWith(fetch);
        await chat.send('hi');
        expect(text(chat)).to.contain('Please finish these in the form: Devices');
        expect(chat.refs.uagChatForm.hidden).to.equal(false);
        expect(chat.refs.uagChatLog.hidden).to.equal(true);
        click(chat.refs.uagChatClose);
        expect(chat.refs.uagChatLog.hidden).to.equal(false);
    });

    it('starts a new request after Start over, rather than updating the one just saved', async () => {
        const fetch = uagChat([
            reply({ patch: { name: 'Ada', issueType: 'billing' }, complete: true }),
            reply({ patch: { name: 'Bob', issueType: 'outage' }, complete: true })
        ]);
        const chat = await chatWith(fetch);
        await chat.send('Ada, billing');
        await chat.submitChat();
        chat.reset();
        expect(chat.getComponent('name').getValue()).to.equal('');
        await chat.send('Bob, outage');
        await chat.submitChat();
        const saves = formioRequests.filter((req) => req.method === 'POST' || req.method === 'PUT');
        expect(saves.map((req) => req.method)).to.deep.equal(['POST', 'POST']);
        expect(saves[1].body.data).to.include({ name: 'Bob' });
        expect(saves[1].body).to.not.have.property('_id');
    });

    it('ignores a save that finishes after Start over', async () => {
        let release: () => void = () => { };
        submitGate = new Promise<void>((resolve) => { release = resolve; });
        const chat = await chatWith(uagChat([reply({ patch: { name: 'Ada', issueType: 'billing' }, complete: true })]));
        await chat.send('Ada, billing');
        const saving = chat.submitChat();
        await new Promise((resolve) => setTimeout(resolve, 50));
        chat.reset();
        release();
        await saving;
        expect(chat.chat.submitted).to.equal(false);
        expect(text(chat)).to.not.contain('Your form was submitted');
        expect(chat.refs.uagChatInput.disabled).to.equal(false);
    });

    it('says once which fields to finish in the form, and opens it once', async () => {
        const remaining = { required: [], optional: [], unsupported: [{ path: 'devices', label: 'Devices', required: true, empty: true }] };
        const chat = await chatWith(uagChat([reply({ remaining }), reply({ remaining })]));
        await chat.send('hi');
        chat.closeForm();
        await chat.send('again');
        expect(chat.refs.uagChatLog.hidden).to.equal(false);
        expect(chat.element.querySelectorAll('.uag-chat__notice')).to.have.length(1);
    });

    it('keeps one person\'s conversation from another on the same browser', async () => {
        localStorage.clear();
        const token = (id: string) => `x.${Buffer.from(JSON.stringify({ user: { _id: id } })).toString('base64url')}.y`;
        const ada = await Formio.createChat(element(), FORM_URL, { fetch: uagChat([reply({ reply: 'Hello Ada', patch: { name: 'Ada' } })]), storage: 'local' });
        ada.formio.getToken = () => token('ada');
        await ada.send('I am Ada');
        const original = Formio.getToken;
        Formio.getToken = () => token('bob');
        try {
            const bob = await Formio.createChat(element(), FORM_URL, { fetch: uagChat([]), storage: 'local' });
            // A kept conversation is restored once formio.js has attached the form.
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(bob.chat.restored).to.equal(true);
            expect(bob.messages).to.deep.equal([]);
            expect(bob.getComponent('name').getValue()).to.equal('');
        }
        finally {
            Formio.getToken = original;
            localStorage.clear();
        }
    });

    it('does not restore a kept conversation over a submission the form loaded', async () => {
        sessionStorage.clear();
        const first = await chatWith(uagChat([reply({ reply: 'Hello Ada', patch: { name: 'Ada' } })]), { storage: 'session' });
        await first.send('I am Ada');
        // Created without storage, so nothing is restored on its own; then asked to restore.
        const chat = await chatWith(uagChat([]));
        await new Promise((resolve) => setTimeout(resolve, 100));
        chat.options.storage = 'session';
        chat.chat.restored = false;
        chat.setValue({ _id: 'existing', data: { name: 'Zed' } });
        chat.restoreChat();
        expect(chat.getComponent('name').getValue()).to.equal('Zed');
        expect(chat.messages).to.deep.equal([]);
        sessionStorage.clear();
    });

    it('keeps the conversation with storage: "session", and nothing without it', async () => {
        sessionStorage.clear();
        const first = await chatWith(uagChat([reply({ reply: 'Hello Ada', patch: { name: 'Ada' } })]), { storage: 'session' });
        await first.send('I am Ada');
        const again = await chatWith(uagChat([]), { storage: 'session' });
        expect(again.messages).to.deep.equal([{ role: 'user', content: 'I am Ada' }, { role: 'assistant', content: 'Hello Ada' }]);
        expect(again.getComponent('name').getValue()).to.equal('Ada');
        sessionStorage.clear();
        const plain = await chatWith(uagChat([reply({ patch: { name: 'Ada' } })]));
        await plain.send('I am Ada');
        expect(sessionStorage.length).to.equal(0);
    });

    it('says a form without the uag tag is not available, and sends nothing', async () => {
        served = definition({ _id: 'f2', name: 'plain', path: 'plain', tags: [] });
        const fetch = uagChat([]);
        const chat = await chatWith(fetch, {}, 'https://forms.test/myproject/plain');
        expect(text(chat)).to.contain('This form is not available for chat.');
        await chat.send('hello');
        expect(fetch.turns).to.have.length(0);
        expect(chat.refs.uagChatInput.disabled).to.equal(true);
    });
});
