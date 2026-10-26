import { expect } from 'chai';
// The renderer is a browser/CommonJS module outside src; load it with require.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { attach, ExtractionState, SSEParser } = require('../renderer');

/** A minimal stand-in for a rendered Form.io form. */
function fakeForm(data: Record<string, any> = {}) {
    const listeners: Record<string, Function[]> = {};
    const values: Record<string, any> = { ...data };
    const make = (path: string, properties: any = {}) => ({
        path,
        component: { key: path, properties },
        getValue: () => values[path],
        setValue: (value: any) => {
            values[path] = value;
            // Form.io emits change for programmatic writes too, without "modified".
            (listeners.change || []).forEach((fn) => fn({ changed: { instance: { path } } }, {}, false));
        }
    });
    const components: Record<string, any> = {
        description: make('description', { uag: 'triage', uagField: 'input' }),
        'triage.claimType': make('triage.claimType'),
        'triage.lossDate': make('triage.lossDate')
    };
    return {
        values,
        form: { name: 'claim' },
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
            const agent = attach(form, { baseUrl: 'https://uag.test/', getToken: () => 'tok', fetch, trigger: 'button' });
            await agent.extract().done;
            expect(fetch.calls[0].url).to.equal('https://uag.test/agent/extract');
            expect(fetch.calls[0].init.headers).to.include({ Authorization: 'Bearer tok', Accept: 'text/event-stream' });
            expect(JSON.parse(fetch.calls[0].init.body)).to.deep.include({ form: 'claim', data: { description: 'Someone stole my car yesterday' } });
            expect(form.values['triage.claimType']).to.equal('theft');
            expect(form.values['triage.lossDate']).to.equal('2026-10-19');
            expect(agent.state.source('triage.claimType')).to.equal('agent');
        });

        it('sends the configured task, and reads the legacy persona option as the task', async () => {
            const form = fakeForm({ description: 'x' });
            const fetch = fakeFetch(sse([['done', {}]]));
            await attach(form, { baseUrl: 'https://uag.test', fetch, trigger: 'button', task: 'triage' }).extract().done;
            expect(JSON.parse(fetch.calls[0].init.body)).to.include({ task: 'triage' });
            const legacy = fakeFetch(sse([['done', {}]]));
            await attach(fakeForm({ description: 'x' }), { baseUrl: 'https://uag.test', fetch: legacy, trigger: 'button', persona: 'triage' }).extract().done;
            const body = JSON.parse(legacy.calls[0].init.body);
            expect(body).to.include({ task: 'triage' });
            expect(body).to.not.have.property('persona');
        });

        it('refuses task and persona options that disagree', () => {
            expect(() => attach(fakeForm(), { baseUrl: 'https://uag.test', fetch: fakeFetch(''), trigger: 'button', task: 'triage', persona: 'finance' }))
                .to.throw(/"task" and "persona"/);
        });

        it('never overwrites a value the user entered or changed', async () => {
            const form = fakeForm({ description: 'x' });
            form.userTypes('triage.claimType', 'autoCollision');
            const agent = attach(form, { baseUrl: 'https://uag.test', fetch: fakeFetch(sse([['result', decision]])), trigger: 'button' });
            await agent.extract().done;
            expect(form.values['triage.claimType']).to.equal('autoCollision');
        });

        it('updates its own earlier values on re-extraction, but not ones the user then edited', async () => {
            const form = fakeForm({ description: 'x' });
            const first = attach(form, { baseUrl: 'https://uag.test', fetch: fakeFetch(sse([['result', decision], ['result', value]])), trigger: 'button' });
            await first.extract().done;
            form.userTypes('triage.lossDate', '2026-10-01');
            first.detach();

            // Same state object would be kept by a long-lived attachment; simulate with a second run on it.
            const again = { ...decision, patch: { 'triage.claimType': 'autoGlass' } };
            const lossAgain = { ...value, patch: { 'triage.lossDate': '2026-10-18' } };
            const agent = attach(form, { baseUrl: 'https://uag.test', fetch: fakeFetch(sse([['result', again], ['result', lossAgain]])), trigger: 'button' });
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
                baseUrl: 'https://uag.test', trigger: 'button', fetch,
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
            const agent = attach(form, { baseUrl: 'https://uag.test', trigger: 'button', fetch: fakeFetch('', 503), onDone: (summary: any) => { finished = summary; } });
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
                const agent = attach(form, { baseUrl: 'https://uag.test', trigger: 'button', fetch: fakeFetch(sse([['result', value]])) });
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
            const agent = attach(form, { baseUrl: 'https://uag.test', fetch: fakeFetch('', 503), trigger: 'button', onError: (err: any) => { reported = err; } });
            await agent.extract().done;
            expect(form.values['triage.claimType']).to.equal(undefined);
            expect(reported.message).to.contain('503');
        });

        it('on wizard Next, waits for decision results before moving on', async () => {
            const form = fakeForm({ description: 'x' });
            const order: string[] = [];
            attach(form, {
                baseUrl: 'https://uag.test',
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
            attach(form, { baseUrl: 'https://uag.test', trigger: 'next', fetch });
            await new Promise<void>((resolve) => form.options.hooks.beforeNext({}, {}, () => { order.push('next'); resolve(); }));
            expect(order).to.deep.equal(['checkData:theft', 'establishPages', 'next']);
        });

        it('starts over when the input changes, keeping what the user changed', async () => {
            const form: any = fakeForm({ description: 'Someone stole my car' });
            const fetch = fakeFetch(sse([['result', { engine: 'stub', kind: 'decision', fields: {}, patch: { 'triage.claimType': 'theft', 'triage.lossDate': '2026-01-02' } }]]));
            const agent = attach(form, { baseUrl: 'https://uag.test', trigger: 'button', fetch });
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
            const agent = attach(form, { baseUrl: 'https://uag.test', trigger: 'button', fetch, onStart: (info: any) => starts.push(info) });
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
            const agent = attach(form, { baseUrl: 'https://uag.test', trigger: 'button', fetch });
            await agent.extract().done;
            expect(fetch.calls).to.have.lengthOf(1);
        });

        it('on wizard Next, moves on after the timeout if decisions are slow', async () => {
            const form = fakeForm({ description: 'x' });
            const slow: any = async () => new Promise(() => { });
            attach(form, { baseUrl: 'https://uag.test', trigger: 'next', fetch: slow, nextTimeoutMs: 20 });
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
        attach(form, { baseUrl: 'https://uag.test', fetch, trigger: 'blur' });
        blurs.forEach((fn) => fn(form.getComponent('triage.lossDate')));
        expect(fetch.calls).to.have.length(0);
        blurs.forEach((fn) => fn(form.getComponent('description')));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(fetch.calls).to.have.length(1);
    });

    it('extracts after a pause in typing into an input', async () => {
        const form = fakeForm({ description: 'x' });
        const fetch = fakeFetch(sse([['result', decision]]));
        attach(form, { baseUrl: 'https://uag.test', fetch, trigger: 'pause', pauseMs: 15 });
        form.userTypes('description', 'a');
        form.userTypes('description', 'ab');
        expect(fetch.calls).to.have.length(0);
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(fetch.calls).to.have.length(1);
    });
});
