'use strict';
const { expect } = require('chai');
const protocol = require('../protocol');

const state = { input: { Notes: 'x' }, today: '2026-10-22' };

describe('remote engine protocol', () => {
    it('refuses another version, naming both', () => {
        for (const body of [{ protocol: 2 }, { protocol: '1' }, {}]) {
            expect(() => protocol.checkVersion(body)).to.throw(protocol.ProtocolError, 'protocol 1');
        }
        expect(() => protocol.checkVersion({ protocol: 2 })).to.throw(/protocol 1; the request used protocol 2/);
        expect(() => protocol.checkVersion({}, 'response')).to.throw(/the response used no version/);
        expect(() => protocol.checkVersion('text')).to.throw(/not a JSON object/);
    });

    it('accepts only a short token as a request id', () => {
        for (const id of ['demo.ab12cd.x9Y', '0b5e7c1a-3f2d-4e8b-9a6c-1d2e3f4a5b6c', 'a:b_c-d.e', 'x'.repeat(128)]) {
            expect(protocol.safeRequestId(id), id).to.equal(id);
        }
        for (const id of ['x'.repeat(129), '', 'a b', 'a,b', 'id\r\nX: 1', 'caf\u00e9', undefined, 42, ['a']]) {
            expect(protocol.safeRequestId(id), String(id)).to.equal(undefined);
        }
    });

    it('reads a decide request', () => {
        const questions = { q: { type: 'noul', instructions: 'Urgent?' } };
        expect(protocol.checkDecideRequest({ protocol: 1, state, questions, extra: true })).to.deep.equal({ state, questions });
        expect(() => protocol.checkDecideRequest({ protocol: 1, state, questions: { q: { type: 'essay', instructions: 'x' } } })).to.throw(/"q"/);
        expect(() => protocol.checkDecideRequest({ protocol: 1, state: {}, questions })).to.throw(/"state"/);
    });

    it('reads an extract request, with research only when tools are given with a limit', () => {
        const base = { protocol: 1, instructions: 'Fill', state, fields: [{ path: 'a' }], schema: { type: 'object' } };
        expect(protocol.checkExtractRequest(base)).to.deep.equal({ instructions: 'Fill', state, fields: [{ path: 'a' }], schema: { type: 'object' } });
        const tools = [{ name: 'get_forms', description: 'List', inputSchema: {} }];
        expect(protocol.checkExtractRequest({ ...base, tools, maxIterations: 3 })).to.include({ maxIterations: 3 });
        expect(() => protocol.checkExtractRequest({ ...base, tools })).to.throw(/maxIterations/);
        expect(() => protocol.checkExtractRequest({ ...base, tools: [{ name: 'x' }], maxIterations: 1 })).to.throw(/tool definitions/);
        expect(() => protocol.checkExtractRequest({ ...base, fields: 'a' })).to.throw(/"fields"/);
    });

    it('reads a description, keeping only what the protocol defines', () => {
        const engines = protocol.checkDescription({ protocol: 1, engines: [
            { name: 'jev', kind: 'decision', model: 'jev-1', maxOptions: 255, apiKey: 'leak' },
            { name: 'claude', kind: 'agent', model: 'c-1', toolUse: true },
            { name: 'local', kind: 'agent', model: 'l-1' },
        ] });
        expect(engines).to.deep.equal([
            { name: 'jev', kind: 'decision', model: 'jev-1', maxOptions: 255 },
            { name: 'claude', kind: 'agent', model: 'c-1', toolUse: true },
            { name: 'local', kind: 'agent', model: 'l-1', toolUse: false },
        ]);
        expect(() => protocol.checkDescription({ protocol: 1, engines: [{ name: '../x', kind: 'agent', model: 'm' }] })).to.throw(/valid name/);
        expect(() => protocol.checkDescription({ protocol: 1, engines: [{ name: 'jev', kind: 'decision', model: 'm' }] })).to.throw(/maxOptions/);
    });

    it('reads responses', () => {
        expect(protocol.checkDecisionResponse({ protocol: 1, model: 'm', answers: {}, usage: { inputTokens: 3 } }))
            .to.deep.equal({ model: 'm', answers: {}, usage: { inputTokens: 3, outputTokens: null } });
        expect(protocol.checkExtractResponse({ protocol: 1, model: 'm', values: { a: 1 }, toolCalls: [{ name: 't', isError: 'yes' }] }))
            .to.deep.equal({ model: 'm', values: { a: 1 }, toolCalls: [{ name: 't', isError: false }] });
        expect(() => protocol.checkExtractResponse({ protocol: 1, model: 'm', values: [] })).to.throw(/"values"/);
    });

    it('builds error bodies that are hidden unless marked safe', () => {
        expect(protocol.errorBody('boom')).to.deep.equal({ protocol: 1, error: 'boom', expose: false });
        expect(protocol.errorBody('boom', 'yes').expose).to.equal(false);
        expect(protocol.errorBody('boom', undefined).expose).to.equal(false);
        expect(protocol.errorBody('Quota exceeded.', true)).to.deep.equal({ protocol: 1, error: 'Quota exceeded.', expose: true });
        expect(protocol.SCOPED_TOKEN_HEADER).to.equal('x-uag-scoped-token');
    });
});
