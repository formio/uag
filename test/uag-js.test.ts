import { expect } from 'chai';
// @formio/uag-js is a browser/CommonJS module outside src; load it with require.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { UAG, attach, uagFormUrl, routingPlugin, ExtractionState, SSEParser } = require('../packages/uag-js');

/** A minimal stand-in for a rendered Form.io form. */
function fakeForm(data: Record<string, any> = {}, extra: Record<string, any> = {}, normalize: Record<string, (value: any) => any> = {}) {
    const listeners: Record<string, Function[]> = {};
    const values: Record<string, any> = { ...data };
    const make = (path: string, properties: any = {}) => ({
        path,
        component: { key: path, properties },
        getValue: () => values[path],
        setValue: (value: any) => {
            values[path] = normalize[path] ? normalize[path](value) : value;
            // Form.io emits change for programmatic writes too, without "modified".
            (listeners.change || []).forEach((fn) => fn({ changed: { instance: { path } } }, {}, false));
        }
    });
    const components: Record<string, any> = {
        description: make('description', { uag: 'triage', uagField: 'input' }),
        'triage.claimType': make('triage.claimType'),
        'triage.lossDate': make('triage.lossDate')
    };
    for (const [path, properties] of Object.entries(extra)) components[path] = make(path, properties);
    return {
        values,
        form: { _id: 'f1', project: 'p1', name: 'claim', tags: ['uag'], display: 'form' } as any,
        formio: { formUrl: 'https://forms.test/myproject/claim', getToken: () => 'formio-token' } as any,
        options: {} as any,
        get submission() { return { data: { ...values } }; },
        everyComponent: (cb: Function) => Object.values(components).forEach((c) => cb(c)),
        getComponent: (path: string) => components[path],
        on: (name: string, fn: Function) => { (listeners[name] ||= []).push(fn); },
        off: () => { },
        /** Simulate the user typing into a field. */
        userTypes: (path: string, value: any) => {
            values[path] = value;
            (listeners.change || []).forEach((fn) => fn({ changed: { instance: { path } } }, {}, true));
        }
    };
}

function sse(events: [string, any][]) {
    return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function fakeFetch(body: string, status = 200) {
    const calls: any[] = [];
    const fn = async (url: string, init: any) => {
        calls.push({ url, init });
        return { ok: status < 400, status, text: async () => body };
    };
    return Object.assign(fn, { calls });
}

const decision = { kind: 'decision', patch: { 'triage.claimType': 'theft' }, fields: { 'triage.claimType': { path: 'triage.claimType', status: 'confident', confidence: 0.9 } } };
const value = { kind: 'value', patch: { 'triage.lossDate': '2026-10-19' }, fields: { 'triage.lossDate': { path: 'triage.lossDate', status: 'suggested' } } };

describe('Agent Input renderer', () => {
    describe('ExtractionState', () => {
        it('applies to empty fields and to its own untouched values only', () => {
            const state = new ExtractionState();
            expect(state.canApply('a', '')).to.equal(true);
            expect(state.canApply('a', false)).to.equal(true);
            expect(state.canApply('a', 'typed')).to.equal(false);
            state.recordAgent('a', 'x');
            expect(state.canApply('a', 'x')).to.equal(true);
            state.recordUser('a');
            expect(state.canApply('a', 'x')).to.equal(false);
            expect(state.canApply('a', '')).to.equal(false);
        });
    });

    describe('SSEParser', () => {
        it('parses events split across chunks', () => {
            const seen: any[] = [];
            const parser = new SSEParser((name: string, data: any) => seen.push([name, data]));
            const text = sse([['result', { a: 1 }], ['done', { b: 2 }]]);
            parser.push(text.slice(0, 10));
            parser.push(text.slice(10, 30));
            parser.push(text.slice(30));
            expect(seen).to.deep.equal([['result', { a: 1 }], ['done', { b: 2 }]]);
        });
    });

    describe('attach', () => {
        it('sends the form data and token, and fills empty fields', async () => {
            const form = fakeForm({ description: 'Someone stole my car yesterday' });
            const fetch = fakeFetch(sse([['result', decision], ['result', value], ['done', {}]]));
            const agent = attach(form, { uagUrl: 'https://uag.test/', fetch, trigger: 'button' });
            await agent.extract().done;
            expect(fetch.calls[0].url).to.equal('https://uag.test/project/p1/form/f1/agent/extract');
            expect(fetch.calls[0].init.headers).to.include({ 'x-jwt-token': 'formio-token', Accept: 'text/event-stream' });
            expect(fetch.calls[0].init.headers).to.not.have.property('Authorization');
            const sent = JSON.parse(fetch.calls[0].init.body);
            expect(sent).to.deep.include({ data: { description: 'Someone stole my car yesterday' } });
            expect(sent).to.not.have.property('form');
            expect(form.values['triage.claimType']).to.equal('theft');
            expect(form.values['triage.lossDate']).to.equal('2026-10-19');
            expect(agent.state.source('triage.claimType')).to.equal('agent');
        });

        it('sends the configured task', async () => {
            const form = fakeForm({ description: 'x' });
            const fetch = fakeFetch(sse([['done', {}]]));
            await attach(form, { uagUrl: 'https://uag.test', fetch, trigger: 'button', task: 'triage' }).extract().done;
            expect(JSON.parse(fetch.calls[0].init.body)).to.include({ task: 'triage' });
        });

        it('calls a relay of your own when given the form\'s URL there', async () => {
            const fetch = fakeFetch(sse([['done', {}]]));
            await attach(fakeForm({ description: 'x' }), { formUrl: '/api/formflow/', fetch, trigger: 'button' }).extract().done;
            expect(fetch.calls[0].url).to.equal('/api/formflow/agent/extract');
        });

        it('addresses a form on Open Source (no project id) at the UAG\'s root', () => {
            expect(uagFormUrl('https://uag.test/', { _id: 'f1' })).to.equal('https://uag.test/form/f1');
            expect(uagFormUrl('https://uag.test', { _id: 'f1', project: 'p1' })).to.equal('https://uag.test/project/p1/form/f1');
            expect(uagFormUrl('https://uag.test', { name: 'no id' })).to.equal('');
        });

        it('never overwrites a value the user entered or changed', async () => {
            const form = fakeForm({ description: 'x' });
            form.userTypes('triage.claimType', 'autoCollision');
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch: fakeFetch(sse([['result', decision]])), trigger: 'button' });
            await agent.extract().done;
            expect(form.values['triage.claimType']).to.equal('autoCollision');
        });

        it('updates its own earlier values on re-extraction, but not ones the user then edited', async () => {
            const form = fakeForm({ description: 'x' });
            const first = attach(form, { uagUrl: 'https://uag.test', fetch: fakeFetch(sse([['result', decision], ['result', value]])), trigger: 'button' });
            await first.extract().done;
            form.userTypes('triage.lossDate', '2026-10-01');
            first.detach();

            // Same state object would be kept by a long-lived attachment; simulate with a second run on it.
            const again = { ...decision, patch: { 'triage.claimType': 'autoGlass' } };
            const lossAgain = { ...value, patch: { 'triage.lossDate': '2026-10-18' } };
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch: fakeFetch(sse([['result', again], ['result', lossAgain]])), trigger: 'button' });
            agent.state.recordAgent('triage.claimType', 'theft');
            agent.state.recordUser('triage.lossDate');
            await agent.extract().done;
            expect(form.values['triage.claimType']).to.equal('autoGlass');
            expect(form.values['triage.lossDate']).to.equal('2026-10-01');
        });

        it('reports when a request starts and finishes, with the final summary', async () => {
            const form = fakeForm({ description: 'x' });
            const events: string[] = [];
            const fetch = fakeFetch(sse([['result', decision], ['done', { data: { triage: { claimType: 'theft' } }, engines: [] }]]));
            const agent = attach(form, {
                uagUrl: 'https://uag.test', trigger: 'button', fetch,
                onStart: () => events.push('start'),
                onResult: (event: any) => events.push(`result:${event.kind}`),
                onDone: (summary: any) => events.push(`done:${summary.data.triage.claimType}`)
            });
            await agent.extract().done;
            expect(events).to.deep.equal(['start', 'result:decision', 'done:theft']);
        });

        it('finishes with no summary when the API fails', async () => {
            const form = fakeForm({ description: 'x' });
            let finished: any;
            const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'button', fetch: fakeFetch('', 503), onDone: (summary: any) => { finished = summary; } });
            await agent.extract().done;
            expect(finished).to.equal(null);
        });

        it('annotates a field drawn after its result arrived, such as a later wizard page', async () => {
            const node = (): any => {
                const children: any[] = [];
                return {
                    children,
                    appendChild(child: any) { children.push(child); child.parentNode = this; },
                    removeChild(child: any) { children.splice(children.indexOf(child), 1); },
                    contains: (child: any) => children.includes(child),
                    addEventListener() { }
                };
            };
            (global as any).document = { createElement: node };
            try {
                const form: any = fakeForm({ description: 'x' });
                const renders: Function[] = [];
                const on = form.on;
                form.on = (name: string, fn: Function) => (name === 'render' ? renders.push(fn) : on(name, fn));
                const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'button', fetch: fakeFetch(sse([['result', value]])) });
                await agent.extract().done;
                const field = form.getComponent('triage.lossDate');
                field.element = node();
                renders.forEach((fn) => fn());
                renders.forEach((fn) => fn());
                expect(field.element.children.map((child: any) => child.className)).to.deep.equal(['uag-chip uag-suggested']);
            }
            finally {
                delete (global as any).document;
            }
        });

        it('leaves the form untouched and reports the error when the API fails', async () => {
            const form = fakeForm({ description: 'x' });
            let reported: any = null;
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch: fakeFetch('', 503), trigger: 'button', onError: (err: any) => { reported = err; } });
            await agent.extract().done;
            expect(form.values['triage.claimType']).to.equal(undefined);
            expect(reported.message).to.contain('503');
        });

        it('on wizard Next, waits for decision results before moving on', async () => {
            const form = fakeForm({ description: 'x' });
            const order: string[] = [];
            attach(form, {
                uagUrl: 'https://uag.test',
                trigger: 'next',
                fetch: fakeFetch(sse([['result', decision], ['result', value]])),
                onResult: (event: any) => order.push(`result:${event.kind}`)
            });
            await new Promise<void>((resolve) => form.options.hooks.beforeNext({}, {}, () => { order.push('next'); resolve(); }));
            expect(order.indexOf('result:decision')).to.be.lessThan(order.indexOf('next'));
            expect(form.values['triage.claimType']).to.equal('theft');
        });

        it('on wizard Next, recomputes the pages from the results before moving on', async () => {
            const form: any = fakeForm({ description: 'Someone stole my car' });
            const order: string[] = [];
            form.checkData = () => order.push(`checkData:${form.values['triage.claimType']}`);
            form.establishPages = () => order.push('establishPages');
            const fetch = fakeFetch(sse([
                ['result', { engine: 'stub', kind: 'decision', fields: {}, patch: { 'triage.claimType': 'theft' } }],
                ['done', {}]
            ]));
            attach(form, { uagUrl: 'https://uag.test', trigger: 'next', fetch });
            await new Promise<void>((resolve) => form.options.hooks.beforeNext({}, {}, () => { order.push('next'); resolve(); }));
            expect(order).to.deep.equal(['checkData:theft', 'establishPages', 'next']);
        });

        it('starts over when the input changes, keeping what the user changed', async () => {
            const form: any = fakeForm({ description: 'Someone stole my car' });
            const fetch = fakeFetch(sse([['result', { engine: 'stub', kind: 'decision', fields: {}, patch: { 'triage.claimType': 'theft', 'triage.lossDate': '2026-01-02' } }]]));
            const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'button', fetch });
            await agent.extract().done;
            // Asking again about the same input sends what was filled.
            await agent.extract().done;
            expect(JSON.parse(fetch.calls[1].init.body).data['triage.claimType']).to.equal('theft');

            form.userTypes('triage.lossDate', '2026-01-03');
            form.userTypes('description', 'A pipe burst in the kitchen');
            await agent.extract().done;
            const sent = JSON.parse(fetch.calls[2].init.body).data;
            expect(sent['triage.claimType']).to.equal('');
            expect(sent['triage.lossDate']).to.equal('2026-01-03');
            expect(sent.description).to.equal('A pipe burst in the kitchen');
            expect(form.values['triage.claimType']).to.equal('theft');
        });

        it('asks once more when the decisions show fields the form was hiding', async () => {
            const form: any = fakeForm({ description: 'Rear-ended, my passenger was hurt' });
            const starts: any[] = [];
            const fetch = fakeFetch(sse([
                ['result', { engine: 'stub', kind: 'decision', fields: {}, patch: { 'triage.claimType': 'autoCollision' } }],
                ['done', { data: {}, fields: {}, excluded: [{ path: 'injuredName', reason: 'hidden by the form\'s conditionals' }], engines: [] }]
            ]));
            const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'button', fetch, onStart: (info: any) => starts.push(info) });
            await agent.extract().done;
            expect(fetch.calls).to.have.lengthOf(2);
            expect(JSON.parse(fetch.calls[1].init.body).data['triage.claimType']).to.equal('autoCollision');
            expect(starts).to.deep.equal([{ followUp: false }, { followUp: true }]);
        });

        it('does not ask again when no decision changed the form', async () => {
            const form: any = fakeForm({ description: 'x', 'triage.claimType': 'theft' });
            const fetch = fakeFetch(sse([
                ['result', { engine: 'stub', kind: 'decision', fields: {}, patch: {} }],
                ['done', { data: {}, fields: {}, excluded: [{ path: 'injuredName', reason: 'hidden by the form\'s conditionals' }], engines: [] }]
            ]));
            const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'button', fetch });
            await agent.extract().done;
            expect(fetch.calls).to.have.lengthOf(1);
        });

        it('sends the task of the input that triggered it, on a form with several tasks', async () => {
            const form: any = fakeForm({ description: 'x', notes: 'y' }, { notes: { uag: 'followUp', uagField: 'input' } });
            const blurs: Function[] = [];
            const on = form.on;
            form.on = (name: string, fn: Function) => { if (name === 'blur') blurs.push(fn); else on(name, fn); };
            const fetch = fakeFetch(sse([['done', {}]]));
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch, trigger: 'blur' });
            blurs.forEach((fn) => fn(form.getComponent('notes')));
            await new Promise((resolve) => setTimeout(resolve, 10));
            blurs.forEach((fn) => fn(form.getComponent('description')));
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(fetch.calls.map((call) => JSON.parse(call.init.body).task)).to.deep.equal(['followUp', 'triage']);
            // Run by hand with no task configured: every task with an input.
            await agent.extract().done;
            expect(JSON.parse(fetch.calls[2].init.body)).to.not.have.property('task');
        });

        it('recognizes its own value after formio.js normalizes it, so it can update it later', async () => {
            const options = (value: any) => ({ water: false, fire: false, ...value });
            const form = fakeForm({ description: 'x' }, { 'triage.causes': {} }, { 'triage.causes': options });
            const first = { kind: 'decision', fields: {}, patch: { 'triage.causes': { water: true } } };
            const second = { kind: 'decision', fields: {}, patch: { 'triage.causes': { fire: true } } };
            let body = sse([['result', first]]);
            const fetch = async () => ({ ok: true, status: 200, text: async () => body });
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch, trigger: 'button' });
            await agent.extract().done;
            expect(agent.state.source('triage.causes')).to.equal('agent');
            body = sse([['result', second]]);
            await agent.extract().done;
            expect(form.values['triage.causes']).to.deep.equal({ water: false, fire: true });
        });

        it('reports an error event in the stream, for a failed group and for a failed request', async () => {
            const form = fakeForm({ description: 'x' });
            const reported: any[] = [];
            const fetch = fakeFetch(sse([
                ['result', { kind: 'value', fields: {}, patch: {}, error: 'timeout' }],
                ['error', { kind: 'value', task: 'triage', error: 'timeout', attempts: 1 }],
                ['error', { requestId: 'r1', error: 'The request failed. See the UAG logs for this request id.' }]
            ]));
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch, trigger: 'button', onError: (err: any) => reported.push(err) });
            await agent.extract().done;
            expect(reported.map((err) => err.event)).to.deep.equal([
                { kind: 'value', task: 'triage', error: 'timeout', attempts: 1 },
                { requestId: 'r1', error: 'The request failed. See the UAG logs for this request id.' }
            ]);
            expect(reported[1].message).to.contain('UAG logs');
        });

        it('reports that fetch is unavailable as a failed request, with the usual shape', async () => {
            const original = (globalThis as any).fetch;
            (globalThis as any).fetch = undefined;
            try {
                let reported: any = null;
                const agent = attach(fakeForm({ description: 'x' }), { uagUrl: 'https://uag.test', trigger: 'button', onError: (err: any) => { reported = err; } });
                const pending = agent.extract();
                await pending.decided;
                await pending.done;
                expect(reported.message).to.contain('fetch is not available');
            }
            finally {
                (globalThis as any).fetch = original;
            }
        });

        it('on wizard Next, keeps the hooks other forms share, and calls the earlier hook on the form', async () => {
            let calledOn: any = null;
            const appHook = function (this: any, page: any, submission: any, next: Function) { calledOn = this; next(); };
            const shared = { beforeNext: appHook };
            const first: any = fakeForm({ description: 'x' });
            const second: any = fakeForm({ description: 'y' });
            first.options = { hooks: shared };
            second.options = { hooks: shared };
            const firstFetch = fakeFetch(sse([['result', decision]]));
            const secondFetch = fakeFetch(sse([['result', decision]]));
            attach(first, { uagUrl: 'https://uag.test', trigger: 'next', fetch: firstFetch });
            const agent = attach(second, { uagUrl: 'https://uag.test', trigger: 'next', fetch: secondFetch });
            expect(shared.beforeNext).to.equal(appHook);
            await new Promise<void>((resolve) => second.options.hooks.beforeNext.call(second, {}, {}, () => resolve()));
            expect(calledOn).to.equal(second);
            expect(firstFetch.calls).to.have.length(0);
            expect(secondFetch.calls).to.have.length(1);
            agent.detach();
            expect(second.options.hooks).to.equal(shared);
        });

        it('replaces an earlier attachment to the same form, so it extracts once', async () => {
            const form: any = fakeForm({ description: 'x' });
            const blurs: Function[] = [];
            const on = form.on;
            form.on = (name: string, fn: Function) => { if (name === 'blur') blurs.push(fn); else on(name, fn); };
            form.off = (name: string, fn: Function) => { if (name === 'blur') blurs.splice(blurs.indexOf(fn), 1); };
            const firstFetch = fakeFetch(sse([['done', {}]]));
            const secondFetch = fakeFetch(sse([['done', {}]]));
            attach(form, { uagUrl: 'https://uag.test', fetch: firstFetch });
            const agent = attach(form, { uagUrl: 'https://uag.test', fetch: secondFetch });
            expect(form.uagAgent).to.equal(agent);
            blurs.forEach((fn) => fn(form.getComponent('description')));
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(firstFetch.calls).to.have.length(0);
            expect(secondFetch.calls).to.have.length(1);
        });

        it('on wizard Next, moves on after the timeout if decisions are slow', async () => {
            const form = fakeForm({ description: 'x' });
            const slow: any = async () => new Promise(() => { });
            attach(form, { uagUrl: 'https://uag.test', trigger: 'next', fetch: slow, nextTimeoutMs: 20 });
            const started = Date.now();
            await new Promise<void>((resolve) => form.options.hooks.beforeNext({}, {}, () => resolve()));
            expect(Date.now() - started).to.be.lessThan(1000);
        });
    });
});

describe('Agent Input triggers', () => {
    it('extracts on blur of an input, and not of other fields', async () => {
        const form: any = fakeForm({ description: 'x' });
        const blurs: Function[] = [];
        const on = form.on;
        form.on = (name: string, fn: Function) => { if (name === 'blur') blurs.push(fn); else on(name, fn); };
        const fetch = fakeFetch(sse([['result', decision]]));
        attach(form, { uagUrl: 'https://uag.test', fetch, trigger: 'blur' });
        blurs.forEach((fn) => fn(form.getComponent('triage.lossDate')));
        expect(fetch.calls).to.have.length(0);
        blurs.forEach((fn) => fn(form.getComponent('description')));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(fetch.calls).to.have.length(1);
    });

    it('extracts after a pause in typing into an input', async () => {
        const form = fakeForm({ description: 'x' });
        const fetch = fakeFetch(sse([['result', decision]]));
        attach(form, { uagUrl: 'https://uag.test', fetch, trigger: 'pause', pauseMs: 15 });
        form.userTypes('description', 'a');
        form.userTypes('description', 'ab');
        expect(fetch.calls).to.have.length(0);
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(fetch.calls).to.have.length(1);
    });
});

describe('@formio/uag-js registration', () => {
    const claim = { _id: 'f1', project: 'p1', name: 'claim', tags: ['uag'], display: 'form', components: [] };
    const plain = { _id: 'f2', project: 'p1', name: 'contact', tags: [], display: 'form', components: [] };

    /** formio.js's request pipeline, as far as the plugin sees it: preRequest, then the request, then wrapRequestPromise. */
    function pipeline(plugin: any, sent: string[], respond: (url: string) => Promise<any>) {
        return async (formio: any, type: string, url: string) => {
            const args: any = { formio, type, url, method: 'GET', opts: {} };
            await plugin.preRequest(args);
            sent.push(args.url);
            return plugin.wrapRequestPromise(respond(args.url), args);
        };
    }

    async function loaded(definition: any, responses: Record<string, any> = {}) {
        const plugin = routingPlugin('https://uag.test');
        const sent: string[] = [];
        const formio = { formUrl: `https://forms.test/myproject/${definition.name}` };
        const request = pipeline(plugin, sent, async (url) => responses[url] ?? (url === formio.formUrl ? definition : {}));
        await request(formio, 'form', formio.formUrl);
        return { formio, request, sent };
    }

    it('sends the submission requests of a uag form to the UAG, by id', async () => {
        const { formio, request, sent } = await loaded(claim);
        await request(formio, 'submission', `${formio.formUrl}/submission`);
        await request(formio, 'submission', `${formio.formUrl}/submission/s1`);
        await request(formio, 'submissions', `${formio.formUrl}/submission?limit=10`);
        expect(sent.slice(1)).to.deep.equal([
            'https://uag.test/project/p1/form/f1/submission',
            'https://uag.test/project/p1/form/f1/submission/s1',
            'https://uag.test/project/p1/form/f1/submission?limit=10'
        ]);
    });

    it('leaves the form definition, other request types and forms without the tag on Form.io', async () => {
        const uag = await loaded(claim);
        await uag.request(uag.formio, 'form', uag.formio.formUrl);
        await uag.request(uag.formio, 'file', `${uag.formio.formUrl}/storage/s3`);
        expect(uag.sent.every((url) => url.startsWith('https://forms.test/'))).to.equal(true);
        const other = await loaded(plain);
        await other.request(other.formio, 'submission', `${other.formio.formUrl}/submission`);
        expect(other.sent.every((url) => url.startsWith('https://forms.test/'))).to.equal(true);
    });

    it('sends the submissions of a form loaded at a revision to the form, not the revision', async () => {
        const revision = { ...claim, _id: 'rev1', _rid: 'f1', _vid: 3 };
        const { formio, request, sent } = await loaded({ ...claim, revisions: 'original' }, { 'https://forms.test/myproject/claim/v/3': revision });
        await request(formio, 'form', `${formio.formUrl}/v/3`);
        // Only the revision seen: its `_rid` is the form.
        const plugin = routingPlugin('https://uag.test');
        const alone: string[] = [];
        const revisionOnly = pipeline(plugin, alone, async () => revision);
        await revisionOnly(formio, 'form', `${formio.formUrl}/v/3`);
        await revisionOnly(formio, 'submission', `${formio.formUrl}/submission`);
        await request(formio, 'submission', `${formio.formUrl}/submission`);
        expect(sent.pop()).to.equal('https://uag.test/project/p1/form/f1/submission');
        expect(alone.pop()).to.equal('https://uag.test/project/p1/form/f1/submission');
    });

    it('does not reroute a form it never saw loaded, such as one rendered from a definition', async () => {
        const plugin = routingPlugin('https://uag.test');
        const args: any = { formio: { formUrl: 'https://forms.test/myproject/claim' }, type: 'submission', url: 'https://forms.test/myproject/claim/submission' };
        await plugin.preRequest(args);
        expect(args.url).to.equal('https://forms.test/myproject/claim/submission');
    });

    it('never retries a failed UAG request at Form.io', async () => {
        const plugin = routingPlugin('https://uag.test');
        const sent: string[] = [];
        const formio = { formUrl: 'https://forms.test/myproject/claim' };
        const request = pipeline(plugin, sent, async (url) => {
            if (url.startsWith('https://uag.test')) throw new Error('Failed to fetch');
            return claim;
        });
        await request(formio, 'form', formio.formUrl);
        let failed: any = null;
        await request(formio, 'submission', `${formio.formUrl}/submission`).catch((err: any) => { failed = err; });
        expect(failed).to.be.an('error');
        expect(sent).to.deep.equal([formio.formUrl, 'https://uag.test/project/p1/form/f1/submission']);
    });

    describe('Agent Input on uag forms', () => {
        class Webform {
            form: any; formio: any; listeners: Record<string, Function[]> = {}; options: any = {}; submission = { data: {} };
            components: any[];
            constructor(definition: any, inputs: string[] = []) {
                this.form = definition;
                this.formio = { formUrl: 'https://forms.test/myproject/claim', getToken: () => 'formio-token' };
                this.components = inputs.map((key) => ({ path: key, key, component: { key, properties: { uag: 'triage', uagField: 'input' } }, getValue: () => '' }));
            }
            attach() { return Promise.resolve('attached'); }
            destroy() { return 'destroyed'; }
            everyComponent(cb: Function) { this.components.forEach((c) => cb(c)); }
            getComponent(path: string) { return this.components.find((c) => c.path === path); }
            on(name: string, fn: Function) { (this.listeners[name] ||= []).push(fn); }
            off() { }
        }
        class Wizard extends Webform { }
        const fakeFormio = () => ({ Displays: { displays: { webform: Webform, wizard: Wizard, pdf: class { } } }, getToken: () => 'formio-token' });

        it('registers a fetch plugin and displays that attach Agent Input', async () => {
            const mod = UAG('https://uag.test')(fakeFormio());
            expect(mod.fetch.uag).to.have.property('preRequest');
            expect(Object.keys(mod.displays)).to.have.members(['webform', 'wizard', 'chat']);
            const form = new mod.displays.webform(claim, ['description']);
            expect(await form.attach()).to.equal('attached');
            expect(form.uagAgent).to.have.property('extract');
            // Rendering again attaches nothing more.
            const agent = form.uagAgent;
            await form.attach();
            expect(form.uagAgent).to.equal(agent);
            form.destroy();
            expect(form.uagAgent).to.equal(null);
        });

        it('waits for decisions on wizard Next by default', async () => {
            const mod = UAG('https://uag.test')(fakeFormio());
            const form = new mod.displays.wizard({ ...claim, display: 'wizard' }, ['description']);
            await form.attach();
            expect(form.options.hooks.beforeNext).to.be.a('function');
        });

        it('attaches nothing to a uag form with no input, or to a form without the tag', async () => {
            const mod = UAG('https://uag.test')(fakeFormio());
            const noInput = new mod.displays.webform(claim, []);
            await noInput.attach();
            expect(noInput.uagAgent).to.equal(undefined);
            const untagged = new mod.displays.webform(plain, ['description']);
            await untagged.attach();
            expect(untagged.uagAgent).to.equal(undefined);
        });

        it('attaches Agent Input to a definition Form.io returned, and not to one with no id', async () => {
            const mod = UAG('https://uag.test')(fakeFormio());
            const fromDefinition = new mod.displays.webform(claim, ['description']);
            await fromDefinition.attach();
            expect(fromDefinition.uagAgent).to.have.property('extract');
            const { _id, ...noId } = claim;
            const unknown = new mod.displays.webform(noId, ['description']);
            await unknown.attach();
            expect(unknown.uagAgent).to.equal(undefined);
        });

        it('attaches nothing with agentInput: false, and still routes submissions', () => {
            const mod = UAG('https://uag.test', { agentInput: false })(fakeFormio());
            // Only the chat display: the form and wizard displays stay formio.js's own.
            expect(Object.keys(mod.displays)).to.deep.equal(['chat']);
            expect(mod.fetch.uag).to.have.property('preRequest');
        });

        it('requires the UAG\'s URL', () => {
            expect(() => UAG('')).to.throw(/UAG's URL/);
        });
    });
});

describe('Agent Input review of uncertain values', () => {
    const uncertain = {
        kind: 'decision',
        patch: { 'triage.claimType': 'theft' },
        fields: { 'triage.claimType': { path: 'triage.claimType', status: 'uncertain', alternatives: [{ label: 'Auto glass', value: 'autoGlass', confidence: 0.4 }] } }
    };

    /** A DOM node with just what the annotations use. */
    const node = (): any => {
        const children: any[] = [];
        const listeners: Record<string, Function[]> = {};
        return {
            children,
            focused: false,
            appendChild(child: any) { children.push(child); child.parentNode = this; },
            removeChild(child: any) { children.splice(children.indexOf(child), 1); },
            contains: (child: any) => children.includes(child),
            addEventListener(name: string, fn: Function) { (listeners[name] ||= []).push(fn); },
            fire(name: string) { (listeners[name] || []).forEach((fn) => fn()); },
            focus() { this.focused = true; }
        };
    };

    async function reviewing(options: Record<string, any> = {}) {
        const form: any = fakeForm({ description: 'x' });
        const field = form.getComponent('triage.claimType');
        field.element = node();
        field.component.label = 'Kind of claim';
        const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'button', fetch: fakeFetch(sse([['result', uncertain]])), requireReview: true, ...options });
        await agent.extract().done;
        const note = field.element.children[0];
        const label = note.children.find((child: any) => child.className === 'uag-review');
        return { form, agent, field, note, box: label.children[0] };
    }

    function beforeNext(form: any) {
        return new Promise<any>((resolve) => form.options.hooks.beforeNext.call(form, {}, {}, (err: any) => resolve(err)));
    }

    function beforeSubmit(form: any, submission: any = { data: {} }) {
        return new Promise<any[]>((resolve) => form.options.hooks.beforeSubmit.call(form, submission, (err: any, data: any) => resolve([err, data])));
    }

    beforeEach(() => { (global as any).document = { createElement: node }; });
    afterEach(() => { delete (global as any).document; });

    it('installs no hooks unless asked', async () => {
        const form: any = fakeForm({ description: 'x' });
        attach(form, { uagUrl: 'https://uag.test', trigger: 'button' });
        expect(form.options.hooks).to.equal(undefined);
    });

    it('stops Next and Submit while an uncertain value is unchecked, marking its note and focusing its checkbox', async () => {
        const { form, note, box } = await reviewing();
        expect(note.className).to.equal('uag-chip uag-uncertain');
        const err = await beforeNext(form);
        expect(err).to.deep.equal([{ level: 'error', message: 'Kind of claim: tick "Yes, this looks right", or change the answer.' }]);
        expect(note.className).to.equal('uag-chip uag-uncertain uag-review-needed');
        expect(note.children[0].textContent).to.equal('Please check this before you continue. ');
        expect(box.focused).to.equal(true);
        const [submitErr] = await beforeSubmit(form);
        expect(submitErr).to.have.length(1);
    });

    it('moves on once the value is ticked as right, turning the note green and clearing the error', async () => {
        const { form, note, box } = await reviewing();
        await beforeNext(form);
        box.checked = true;
        box.fire('change');
        expect(note.className).to.equal('uag-chip uag-uncertain uag-reviewed');
        expect(note.children[0].textContent).to.equal('Thanks for checking. ');
        expect(await beforeNext(form)).to.equal(undefined);
        const submission = { data: { a: 1 } };
        expect(await beforeSubmit(form, submission)).to.deep.equal([null, submission]);
        box.checked = false;
        box.fire('change');
        expect(note.className).to.equal('uag-chip uag-uncertain');
        expect(await beforeNext(form)).to.have.length(1);
    });

    it('moves on once the user changes the value, or picks an alternative', async () => {
        const typed = await reviewing();
        typed.form.userTypes('triage.claimType', 'autoCollision');
        expect(typed.note.className).to.equal('uag-chip uag-uncertain uag-reviewed');
        expect(await beforeNext(typed.form)).to.equal(undefined);

        const picked = await reviewing();
        picked.note.children.find((child: any) => child.className === 'uag-alternative').fire('click');
        expect(picked.form.values['triage.claimType']).to.equal('autoGlass');
        expect(await beforeNext(picked.form)).to.equal(undefined);
    });

    it('checks only the current page on Next, skips hidden fields, and shows the first unchecked page on Submit', async () => {
        const { form, field } = await reviewing();
        const pages = [{ id: 'p0' }, { id: 'p1' }];
        form.pages = pages;
        form.page = 0;
        field.parent = pages[1];
        expect(await beforeNext(form)).to.equal(undefined);
        form.setPage = async (page: number) => { form.page = page; };
        const [err] = await beforeSubmit(form);
        expect(form.page).to.equal(1);
        expect(err).to.have.length(1);
        field.visible = false;
        expect((await beforeSubmit(form))[0]).to.equal(null);
    });

    it('runs before the Next trigger, so nothing is extracted until the page is checked, and detaching restores the hooks', async () => {
        const shared = {};
        const form: any = fakeForm({ description: 'x' });
        form.options = { hooks: shared };
        const fetch = fakeFetch(sse([['done', {}]]));
        const agent = attach(form, { uagUrl: 'https://uag.test', trigger: 'next', fetch, requireReview: true });
        expect(await beforeNext(form)).to.equal(undefined);
        expect(fetch.calls).to.have.length(1);
        agent.detach();
        expect(form.options.hooks).to.equal(shared);
    });
});
