'use strict';
const { expect } = require('chai');
const { ENGINE_API_VERSION, defineEngine, isEngineType, EngineError } = require('..');

const valid = () => ({
    type: 'acme',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    settings: {
        apiKey: { env: 'ACME_API_KEY', required: true, secret: true },
        maxTokens: { type: 'number', default: 1000 },
    },
    create: ({ name }) => ({ name, kind: 'agent', model: 'acme-1', extract: async () => ({ model: 'acme-1', values: {} }) }),
});

describe('defineEngine', () => {
    it('returns the definition frozen, with env lists normalised', () => {
        const definition = defineEngine(valid());
        expect(Object.isFrozen(definition)).to.equal(true);
        expect(Object.isFrozen(definition.settings.apiKey)).to.equal(true);
        expect(definition.settings.apiKey.env).to.deep.equal(['ACME_API_KEY']);
        expect(isEngineType(definition)).to.equal(true);
    });

    it('names every problem in a definition', () => {
        const bad = { ...valid(), type: 'Acme', kinds: ['oracle'], apiVersion: 0, create: undefined, settings: { 'api-key': {}, model: { env: 'lower', default: 3, secret: 'yes', colour: 'red' } } };
        expect(() => defineEngine(bad)).to.throw(TypeError)
            .with.property('message')
            .that.includes('"type"').and.includes('"kinds"').and.includes('"apiVersion"').and.includes('"create"')
            .and.includes('setting "api-key"').and.includes('unknown keys: colour').and.includes('"env"')
            .and.includes('"secret"').and.includes('"default" must be a string');
    });

    it('accepts a plain object as an engine type, so packages need not use this copy of the SDK', () => {
        expect(isEngineType(valid())).to.equal(true);
        expect(isEngineType({})).to.equal(false);
        expect(isEngineType(null)).to.equal(false);
    });
});

describe('EngineError', () => {
    it('marks its message safe to show', () => {
        const err = new EngineError('Quota exceeded for this API key');
        expect(err).to.be.instanceOf(Error);
        expect(err.expose).to.equal(true);
        expect(err.message).to.equal('Quota exceeded for this API key');
    });
});
