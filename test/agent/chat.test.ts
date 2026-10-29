import { expect } from 'chai';
import express from 'express';
import http from 'http';
import supertest from 'supertest';
import { EngineRegistry } from '../../src/formflow';
import { AgentRouter, FormAgentRouter, agentCredentials } from '../../src/agent/router';
import { chatTurn, readChatRequest, trimTranscript, chatSettings, CHAT_DEFAULTS, REPLY, CONFIRMED } from '../../src/agent/chat';
import { auth as fullAuth, makeProject } from './fixtures';
import { UAGFormInterface } from '../../src/UAGFormInterface';

http.globalAgent = new http.Agent({ keepAlive: false });

let current: express.Express | null = null;
const shared = http.createServer((req, res) => current!(req, res));
before((done) => { shared.listen(0, '127.0.0.1', done); });
after((done) => { shared.close(() => done()); });
function request(app: express.Express) {
    current = app;
    return supertest(shared);
}

/**
 * A service request: plain fields, a select, a conditional field, a task's
 * input and decision field, an authoritative field, fields a person never
 * enters (hidden, calculated, disabled), a container, and a table.
 */
export const serviceRequest = (properties: Record<string, string> = {}) => ({
    _id: 'serviceRequestId',
    title: 'Service request',
    name: 'servicerequest',
    path: 'servicerequest',
    tags: ['uag'],
    properties: { description: 'Report an outage or request service.', ...properties },
    components: [
        { type: 'textfield', key: 'name', label: 'Your name', input: true, validate: { required: true } },
        { type: 'email', key: 'email', label: 'Email', input: true, validate: { required: true } },
        {
            type: 'select', key: 'issueType', label: 'Issue', input: true, validate: { required: true },
            data: { values: [{ label: 'Outage', value: 'outage' }, { label: 'Billing', value: 'billing' }] }
        },
        {
            type: 'textarea', key: 'outageDetails', label: 'When did it start?', input: true, validate: { required: true },
            conditional: { show: true, conjunction: 'all', conditions: [{ component: 'issueType', operator: 'isEqual', value: 'outage' }] }
        },
        { type: 'textfield', key: 'accountNumber', label: 'Account number', input: true, validate: { pattern: '\\d{8}' } },
        { type: 'textarea', key: 'description', label: 'What happened?', input: true, properties: { uag: 'triage', uagField: 'input' } },
        {
            type: 'radio', key: 'priority', label: 'Priority', input: true,
            values: [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }],
            properties: { uag: 'triage' }
        },
        { type: 'textfield', key: 'ticket', label: 'Ticket', input: true, properties: { uagAuthoritative: 'true' } },
        { type: 'hidden', key: 'source', input: true },
        { type: 'textfield', key: 'computed', label: 'Computed', input: true, calculateValue: 'value = "x";' },
        { type: 'textfield', key: 'locked', label: 'Locked', input: true, disabled: true },
        {
            type: 'container', key: 'contact', label: 'Contact', input: true,
            components: [{ type: 'phoneNumber', key: 'phone', label: 'Phone', input: true }]
        },
        {
            type: 'datagrid', key: 'devices', label: 'Devices', input: true, validate: { required: true },
            components: [{ type: 'textfield', key: 'serial', label: 'Serial', input: true }]
        },
        { type: 'button', key: 'submit', label: 'Submit', input: true }
    ]
});

/** A form for checking values' shapes, with fields kept out of a person's reach by a hidden panel. */
export const shapes = () => ({
    _id: 'shapesId', title: 'Shapes', name: 'shapes', path: 'shapes', tags: ['uag'],
    components: [
        { type: 'number', key: 'count', label: 'Count', input: true },
        { type: 'checkbox', key: 'agree', label: 'Agree', input: true },
        { type: 'selectboxes', key: 'channels', label: 'Channels', input: true, values: [{ label: 'Email', value: 'email' }, { label: 'Phone', value: 'phone' }] },
        { type: 'textarea', key: 'notes', label: 'Notes', input: true },
        { type: 'textfield', key: 'withDefault', label: 'With default', input: true, defaultValue: 'preset' },
        {
            type: 'panel', key: 'internal', title: 'Internal', input: false, hidden: true,
            components: [{ type: 'textfield', key: 'status', label: 'Status', input: true }]
        },
        {
            type: 'container', key: 'box', label: 'Box', input: true, hidden: true,
            components: [{ type: 'textfield', key: 'inner', label: 'Inner', input: true }]
        }
    ]
});

type Call = { request: any };

/** An agent engine that answers with `answer(request, call)`, recording each request. */
function engine(name: string, answer: (request: any, n: number) => any, extra: Record<string, any> = {}) {
    const calls: Call[] = [];
    return {
        calls,
        engine: {
            name, kind: 'agent', model: `${name}-model`, ...extra,
            async extract(request: any) {
                calls.push({ request });
                return { model: `${name}-model`, ...(await answer(request, calls.length)) };
            }
        } as any
    };
}

function setup(engines: any[], config: any = {}, properties: Record<string, string> = {}, sources?: Map<any, any>) {
    const project: any = makeProject({ servicerequest: serviceRequest(properties) });
    project.engines = new EngineRegistry(engines, sources);
    // Unlicensed: chat must not need a license.
    project.agentConfig = { license: '', ...config };
    return { project, form: project.forms.servicerequest as UAGFormInterface };
}

function mount(project: any, auth: any, credentials: any) {
    const server = express();
    server.use((_req, res, next) => { res.set('Connection', 'close'); next(); });
    const authenticate = (req: any, _res: any, next: any) => { req.auth = auth; next(); };
    server.use(AgentRouter(project, authenticate));
    server.use('/:form', authenticate, (req: any, res: any, next: any) => {
        req.form = project.forms[req.params.form];
        if (!req.form) return res.status(404).json({ notFound: true });
        next();
    }, FormAgentRouter(project, credentials));
    return server;
}

const open = (_req: any, _res: any, next: any) => next();
const say = (content: string, data: any = {}) => ({ messages: [{ role: 'user', content }], data });

describe('Chat: the fields a person may enter', function () {
    it('lists visible input fields a person enters, leaving out what tasks, the form and the server fill', async () => {
        const { form } = setup([]);
        const fields = await form.chatFields({ data: {} } as any, fullAuth);
        expect(fields.fields.map((field) => field.path)).to.deep.equal(['name', 'email', 'issueType', 'accountNumber', 'description', 'contact.phone']);
        expect(fields.fields.find((field) => field.path === 'email')!.rule).to.contain('valid email');
        expect(fields.unsupported).to.deep.equal([{ path: 'devices', label: 'Devices', required: true, empty: true }]);
    });

    it('shows a conditional field once the data reveals it', async () => {
        const { form } = setup([]);
        const fields = await form.chatFields({ data: { issueType: 'outage' } } as any, fullAuth);
        expect(fields.fields.map((field) => field.path)).to.include('outageDetails');
    });

    it('reports filled fields as not empty, with their value, so they can be corrected', async () => {
        const { form } = setup([]);
        const fields = await form.chatFields({ data: { name: 'Ada' } } as any, fullAuth);
        const name = fields.fields.find((field) => field.path === 'name')!;
        expect(name.empty).to.equal(false);
        expect(name.value).to.equal('Ada');
    });
});

describe('Chat: reading a turn', function () {
    const settings = { ...CHAT_DEFAULTS };

    it('refuses a missing, empty, oversized or malformed conversation', function () {
        const bad: any[] = [
            {},
            { messages: [] },
            { messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'hi' })) },
            { messages: [{ role: 'system', content: 'hi' }] },
            { messages: [{ role: 'user', content: 7 }] },
            { messages: [{ role: 'user', content: 'x'.repeat(2001) }] },
            { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] },
            { messages: [{ role: 'user', content: 'hi' }], data: [] },
            { messages: [{ role: 'user', content: 'hi' }], data: 'x' }
        ];
        for (const body of bad) {
            expect(() => readChatRequest(body, settings), JSON.stringify(body).slice(0, 80)).to.throw().with.property('status', 400);
        }
    });

    it('keeps the newest messages that fit, starting at one the person wrote', function () {
        const messages: any[] = [
            { role: 'user', content: 'a'.repeat(10) },
            { role: 'assistant', content: 'b'.repeat(10) },
            { role: 'user', content: 'c'.repeat(10) },
            { role: 'assistant', content: 'd'.repeat(10) },
            { role: 'user', content: 'e'.repeat(10) }
        ];
        expect(trimTranscript(messages, 100)).to.have.length(5);
        // 40 characters fit four messages, the oldest of them the assistant's: it starts at the next one the person wrote.
        expect(trimTranscript(messages, 40).map((message) => message.content[0])).to.deep.equal(['c', 'd', 'e']);
        expect(trimTranscript(messages, 1).map((message) => message.content[0])).to.deep.equal(['e']);
    });

    it('reads its settings from agentApi.chat, with defaults', function () {
        const { project } = setup([], { agentApi: { chat: { maxMessages: 5, engines: ['fast'] } } });
        const settings = chatSettings(project);
        expect(settings.maxMessages).to.equal(5);
        expect(settings.engines).to.deep.equal(['fast']);
        expect(settings.maxMessageLength).to.equal(2000);
        expect(settings.maxTranscriptChars).to.equal(24000);
    });
});

describe('Chat: a turn', function () {
    it('asks one engine with the collectable fields, the reply and the confirmation, and the form\'s own instructions', async () => {
        const fake = engine('agent1', () => ({ values: { [REPLY]: 'What is your name?', [CONFIRMED]: false } }));
        const { project, form } = setup([fake.engine], {}, { uagChatInstructions: 'Always ask for the account number first.' });
        await chatTurn(project, form, say('Hi, my internet is down'), { auth: fullAuth });
        expect(fake.calls).to.have.length(1);
        const sent = fake.calls[0].request;
        expect(sent.fields.map((field: any) => field.path)).to.deep.equal(['name', 'email', 'issueType', 'accountNumber', 'description', 'contact.phone', REPLY, CONFIRMED]);
        expect(Object.keys(sent.schema.properties)).to.deep.equal(sent.fields.map((field: any) => field.path));
        expect(sent.schema.properties.issueType).to.deep.equal({ enum: ['outage', 'billing'] });
        expect(sent.instructions).to.contain('Always ask for the account number first.');
        expect(sent.instructions).to.contain('Service request');
        expect(sent.state.input.Conversation).to.equal('Person: Hi, my internet is down');
        expect(sent.state.context['Still needed']).to.contain('Your name');
        expect(sent.state.context['Finished in the form, not in this chat']).to.contain('Devices');
        expect(sent.tools).to.equal(undefined);
    });

    it('takes valid values, puts back invalid ones, and drops fields a person may not enter', async () => {
        const fake = engine('agent1', (_request, n) => n === 1
            ? { values: { name: 'Ada', email: 'ada at example', issueType: 'outage', priority: 'high', ticket: 'T-1', source: 'x', [REPLY]: 'Got it!' } }
            : { values: { [REPLY]: 'That email does not look right. Could you type it again?' } });
        const { project, form } = setup([fake.engine]);
        const res = await chatTurn(project, form, say('I am Ada, ada at example, my internet is out'), { auth: fullAuth });
        expect(res.patch).to.deep.equal({ name: 'Ada', issueType: 'outage' });
        expect(res.data).to.deep.equal({ name: 'Ada', issueType: 'outage' });
        expect(res.fields.email.status).to.equal('invalid');
        expect(res.fields.email.error).to.be.a('string').and.not.equal('');
        expect(res.fields).to.not.have.any.keys('priority', 'ticket', 'source');
        // The outage revealed its conditional field.
        expect(res.remaining.required.map((field) => field.path)).to.deep.equal(['email', 'outageDetails']);
        expect(res.complete).to.equal(false);
        // The reply was rewritten once, knowing the email was not accepted.
        expect(fake.calls).to.have.length(2);
        expect(fake.calls[1].request.fields.map((field: any) => field.path)).to.deep.equal([REPLY]);
        expect(fake.calls[1].request.state.context['Not accepted (ask again for these)']).to.contain('Email');
        expect(res.reply).to.equal('That email does not look right. Could you type it again?');
    });

    it('refuses an option outside the field\'s list', async () => {
        const fake = engine('agent1', () => ({ values: { issueType: 'gardening', [REPLY]: 'ok' } }));
        const { project, form } = setup([fake.engine]);
        const res = await chatTurn(project, form, say('my garden is overgrown'), { auth: fullAuth });
        expect(res.patch).to.deep.equal({});
        expect(res.fields.issueType.status).to.equal('invalid');
        expect(res.fields.issueType.error).to.contain('Outage, Billing');
    });

    it('lets an in-process engine with toolUse check values first, and then asks nothing more', async () => {
        const fake = engine('agent1', async (request) => {
            const checked = await request.callTool('check_values', { values: { email: 'nope' } });
            expect(checked.content[0].text).to.contain('Not accepted').and.contain('Email');
            const refused = await request.callTool('submit_completed_form', {});
            expect(refused.isError).to.equal(true);
            return { values: { email: 'nope', [REPLY]: 'Could you check your email?' }, toolCalls: [{ name: 'check_values', isError: false }] };
        }, { toolUse: true });
        const { project, form } = setup([fake.engine]);
        const res = await chatTurn(project, form, say('nope is my email'), { auth: fullAuth });
        expect(fake.calls).to.have.length(1);
        expect(fake.calls[0].request.tools.map((tool: any) => tool.name)).to.deep.equal(['check_values']);
        expect(fake.calls[0].request.maxIterations).to.equal(3);
        expect(res.fields.email.status).to.equal('invalid');
        expect(res.reply).to.equal('Could you check your email?');
        expect(res.engine.toolCalls).to.deep.equal([{ name: 'check_values', isError: false }]);
    });

    it('gives no tool to a remote engine', async () => {
        const fake = engine('agent1', () => ({ values: { [REPLY]: 'Hi' } }), { toolUse: true });
        const { project, form } = setup([fake.engine], {}, {}, new Map([[fake.engine, { type: 'remote' }]]));
        await chatTurn(project, form, say('hi'), { auth: fullAuth });
        expect(fake.calls[0].request.tools).to.equal(undefined);
    });

    it('is complete only when every required field is filled, and confirmed only on complete, unchanged data', async () => {
        const complete = { name: 'Ada', email: 'ada@example.com', issueType: 'billing', devices: [{ serial: 'S1' }] };
        const confirm = engine('agent1', () => ({ values: { [REPLY]: 'Submitting now.', [CONFIRMED]: true } }));
        const { project, form } = setup([confirm.engine]);
        const yes = await chatTurn(project, form, say('Yes, submit it', complete), { auth: fullAuth });
        expect(yes.complete).to.equal(true);
        expect(yes.confirmed).to.equal(true);

        // Saying yes with a change is not a confirmation of what was shown.
        const change = engine('agent1', () => ({ values: { email: 'ada@example.org', [REPLY]: 'Updated.', [CONFIRMED]: true } }));
        const second = setup([change.engine]);
        const changed = await chatTurn(second.project, second.form, say('Yes, but my email is ada@example.org', complete), { auth: fullAuth });
        expect(changed.patch).to.deep.equal({ email: 'ada@example.org' });
        expect(changed.confirmed).to.equal(false);

        // Without the required table, it is never complete.
        const { devices, ...withoutTable } = complete;
        const third = setup([confirm.engine]);
        const partial = await chatTurn(third.project, third.form, say('Yes', withoutTable), { auth: fullAuth });
        expect(partial.complete).to.equal(false);
        expect(partial.confirmed).to.equal(false);
        expect(partial.remaining.unsupported).to.deep.equal([{ path: 'devices', label: 'Devices', required: true, empty: true }]);
    });

    it('tries the next engine when one fails or times out, and reports the engine that answered', async () => {
        const broken = engine('broken', () => { throw new Error('provider exploded: secret detail'); });
        const slow = engine('slow', () => new Promise((resolve) => setTimeout(() => resolve({ values: {} }), 500)));
        const good = engine('good', () => ({ values: { name: 'Ada', [REPLY]: 'Thanks Ada.' }, usage: { inputTokens: 10, outputTokens: 2 } }));
        const { project, form } = setup([broken.engine, slow.engine, good.engine], { agentApi: { chat: { timeout: 50 } } });
        const res = await chatTurn(project, form, say('I am Ada'), { auth: fullAuth });
        expect(res.engine.name).to.equal('good');
        expect(res.engine.usage).to.deep.equal({ inputTokens: 10, outputTokens: 2 });
        expect(res.reply).to.equal('Thanks Ada.');
    });

    it('answers 502 without the engines\' error details when every engine fails, and 503 with none enabled', async () => {
        const broken = engine('broken', () => { throw new Error('provider exploded: secret detail'); });
        const { project, form } = setup([broken.engine]);
        const failed = await chatTurn(project, form, say('hi'), { auth: fullAuth }).catch((err) => err);
        expect(failed.status).to.equal(502);
        expect(failed.message).to.not.contain('secret detail');
        const none = setup([]);
        const unavailable = await chatTurn(none.project, none.form, say('hi'), { auth: fullAuth }).catch((err) => err);
        expect(unavailable.status).to.equal(503);
    });

    it('answers 429 when every engine is over its rate limit', async () => {
        const fake = engine('agent1', () => ({ values: { [REPLY]: 'hi' } }));
        const { project, form } = setup([fake.engine], { agentApi: { rateLimits: { engine: { agent1: { limit: 1 } } } } });
        await chatTurn(project, form, say('hi'), { auth: fullAuth });
        const limited = await chatTurn(project, form, say('hi again'), { auth: fullAuth }).catch((err) => err);
        expect(limited.status).to.equal(429);
        expect(limited.retryAfterMs).to.be.greaterThan(0);
    });

    it('writes a reply of its own when the engine returns none', async () => {
        const fake = engine('agent1', () => ({ values: { name: 'Ada' } }));
        const { project, form } = setup([fake.engine]);
        const res = await chatTurn(project, form, say('Ada'), { auth: fullAuth });
        expect(res.reply).to.contain('Email');
    });
});

describe('Chat: what a turn trusts', function () {
    function setupShapes(engines: any[]) {
        const project: any = makeProject({ shapes: shapes() });
        project.engines = new EngineRegistry(engines);
        project.agentConfig = { license: '' };
        return { project, form: project.forms.shapes as UAGFormInterface };
    }

    it('leaves fields inside a hidden panel or container out', async () => {
        const fake = engine('agent1', () => ({ values: { status: 'approved', 'box.inner': 'z', notes: 'ok', [REPLY]: 'Noted.' } }));
        const { project, form } = setupShapes([fake.engine]);
        const fields = await form.chatFields({ data: {} } as any, fullAuth);
        expect(fields.fields.map((field) => field.path)).to.not.include.members(['status', 'box.inner']);
        const res = await chatTurn(project, form, say('anything'), { auth: fullAuth });
        expect(res.patch).to.deep.equal({ notes: 'ok' });
    });

    it('refuses a number that is not one, coerces a boolean, and refuses select boxes the field does not have', async () => {
        const fake = engine('agent1', () => ({ values: { count: 'abc', agree: 'true', channels: { email: true, evil: true }, [REPLY]: 'ok' } }));
        const { project, form } = setupShapes([fake.engine]);
        const res = await chatTurn(project, form, say('three, yes, email'), { auth: fullAuth });
        expect(res.fields.count).to.include({ status: 'invalid' });
        expect(res.fields.channels).to.include({ status: 'invalid' });
        expect(res.patch).to.deep.equal({ agree: true });
        expect(res.data).to.not.have.property('count');
    });

    it('returns the request\'s data with the patch, not what the form\'s processors added to it', async () => {
        const fake = engine('agent1', () => ({ values: { notes: 'ok', [REPLY]: 'ok' } }));
        const { project, form } = setupShapes([fake.engine]);
        const body = say('ok', { count: 2 });
        const res = await chatTurn(project, form, body, { auth: fullAuth });
        expect(res.data).to.deep.equal({ count: 2, notes: 'ok' });
        expect(body.data).to.deep.equal({ count: 2 });
    });

    it('shows the engine only the collectable fields\' values, each bounded', async () => {
        const fake = engine('agent1', () => ({ values: { [REPLY]: 'ok' } }));
        const { project, form } = setupShapes([fake.engine]);
        await chatTurn(project, form, say('ok', { notes: 'n'.repeat(5000), status: 'secret-internal' }), { auth: fullAuth });
        const collected = fake.calls[0].request.state.context['Collected so far'];
        // The value is shown, cut short.
        expect(collected).to.contain('n'.repeat(400));
        expect(collected.length).to.be.lessThan(1000);
        expect(collected).to.not.contain('secret-internal');
    });

    it('keeps a reply within the message limit, so the next turn can carry it', async () => {
        const fake = engine('agent1', () => ({ values: { [REPLY]: 'x'.repeat(3000) } }));
        const { project, form } = setupShapes([fake.engine]);
        const res = await chatTurn(project, form, say('hi'), { auth: fullAuth });
        expect(res.reply.length).to.be.at.most(2000);
        expect(() => readChatRequest({ messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: res.reply }, { role: 'user', content: 'again' }] }, { ...CHAT_DEFAULTS })).to.not.throw();
    });
});

describe('Chat: fields the person set in the form', function () {
    it('never changes a locked field, so the person can still confirm', async () => {
        const complete = { name: 'Ada', email: 'b@example.com', issueType: 'billing', devices: [{ serial: 'S1' }] };
        // The engine keeps re-reading the email the person first typed in the chat.
        const fake = engine('agent1', () => ({ values: { email: 'a@example.com', [REPLY]: 'Submitting.', [CONFIRMED]: true } }));
        const { project, form } = setup([fake.engine]);
        const res = await chatTurn(project, form, { ...say('yes, submit', complete), locked: ['email'] }, { auth: fullAuth });
        expect(res.patch).to.deep.equal({});
        expect(res.data.email).to.equal('b@example.com');
        expect(res.confirmed).to.equal(true);
        expect(fake.calls[0].request.fields.map((field: any) => field.path)).to.not.include('email');
        expect(fake.calls[0].request.state.context['Collected so far']).to.contain('b@example.com');
    });

    it('refuses a malformed locked list', function () {
        for (const locked of ['email', [1], Array.from({ length: 501 }, () => 'a')]) {
            expect(() => readChatRequest({ messages: [{ role: 'user', content: 'hi' }], locked }, { ...CHAT_DEFAULTS })).to.throw().with.property('status', 400);
        }
    });
});

describe('Chat: the route', function () {
    const reply = () => engine('agent1', () => ({ values: { [REPLY]: 'Hello!' } }));

    it('answers a turn on an unlicensed project, where extract is refused for the license', async () => {
        const fake = reply();
        const { project } = setup([fake.engine]);
        const app = mount(project, fullAuth, open);
        const res = await request(app).post('/servicerequest/agent/chat').send(say('hi'));
        expect(res.status, res.text).to.equal(200);
        expect(res.body.reply).to.equal('Hello!');
        expect(res.body.requestId).to.be.a('string');
        const extract = await request(app).post('/servicerequest/agent/extract').send({ text: 'hi' });
        expect(extract.status).to.equal(403);
    });

    it('refuses a bad body, a reader, and a form with chat turned off, calling no engine', async () => {
        const fake = reply();
        const { project } = setup([fake.engine]);
        const bad = await request(mount(project, fullAuth, open)).post('/servicerequest/agent/chat').send({ messages: [] });
        expect(bad.status).to.equal(400);
        const reader = { user: { _id: 'r' }, formPermissions: () => ({ read: true }) };
        const refused = await request(mount(project, reader, open)).post('/servicerequest/agent/chat').send(say('hi'));
        expect(refused.status).to.equal(403);
        const off = setup([fake.engine], {}, { uagChat: 'false' });
        const turnedOff = await request(mount(off.project, fullAuth, open)).post('/servicerequest/agent/chat').send(say('hi'));
        expect(turnedOff.status).to.equal(403);
        expect(turnedOff.body.error).to.contain('turned off');
        expect(fake.calls).to.have.length(0);
    });

    it('admits anonymous visitors only on forms that opt in', async () => {
        const fake = reply();
        const anonymous = { formPermissions: () => ({ create: true }) };
        const closed = setup([fake.engine]);
        const refused = await request(mount(closed.project, anonymous, agentCredentials(closed.project))).post('/servicerequest/agent/chat').send(say('hi'));
        expect(refused.status).to.equal(401);
        const opened = setup([fake.engine], {}, { uagAnonymous: 'true' });
        const allowed = await request(mount(opened.project, anonymous, agentCredentials(opened.project))).post('/servicerequest/agent/chat').send(say('hi'));
        expect(allowed.status, allowed.text).to.equal(200);
        expect(fake.calls).to.have.length(1);
    });

    it('counts turns against the caller\'s chat limit', async () => {
        const fake = reply();
        const { project } = setup([fake.engine], { agentApi: { rateLimits: { caller: { chat: { limit: 1 } } } } });
        const app = mount(project, fullAuth, open);
        expect((await request(app).post('/servicerequest/agent/chat').send(say('hi'))).status).to.equal(200);
        const limited = await request(app).post('/servicerequest/agent/chat').send(say('hi'));
        expect(limited.status).to.equal(429);
        expect(limited.headers['retry-after']).to.be.a('string');
        expect(fake.calls).to.have.length(1);
    });

    it('reports chat in capabilities as available without a license', async () => {
        const fake = reply();
        const { project } = setup([fake.engine], { auth: { adminKey: 'k' } });
        const admin = { admin: true };
        const res = await request(mount(project, admin, open)).get('/agent/capabilities');
        expect(res.status, res.text).to.equal(200);
        expect(res.body.operations.chat).to.deep.equal({ available: true, engines: ['agent1'] });
        expect(res.body.operations.extract.available).to.equal(false);
    });
});
