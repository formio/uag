'use strict';
const { expect } = require('chai');
const { requiredSchema, parseJsonObject, toolResultText, EngineError } = require('..');

describe('requiredSchema', () => {
    const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
            name: { type: 'string' },
            age: { type: 'number' },
            insured: { type: 'boolean' },
            colour: { enum: ['red', 'blue'] },
            rating: { enum: [1, 2, 3] },
            tags: { type: 'array', items: { type: 'string' } },
            perils: { type: 'object', properties: { fire: { type: 'boolean' }, flood: { type: 'boolean' } } },
        },
    };

    it('sends every field as required, with an empty value for "not stated"', () => {
        const { schema: sent } = requiredSchema(schema);
        expect(sent.required).to.deep.equal(Object.keys(schema.properties));
        expect(sent.additionalProperties).to.equal(false);
        expect(sent.properties.age).to.deep.equal({ type: 'string', description: 'Answer in digits only, such as 4250 or -3.5, with no currency or units.' });
        expect(sent.properties.insured).to.deep.equal({ enum: ['true', 'false', ''] });
        expect(sent.properties.colour.enum).to.deep.equal(['red', 'blue', '']);
        expect(sent.properties.rating.enum).to.deep.equal(['1', '2', '3', '']);
        expect(sent.properties.perils.required).to.deep.equal(['fire', 'flood']);
        expect(sent.properties.perils.properties.fire).to.deep.equal({ type: 'boolean' });
    });

    it('decodes an answer back to the UAG\'s types, leaving out what was not stated', () => {
        const { decode } = requiredSchema(schema);
        expect(decode({ name: 'Ada', age: '36', insured: 'false', colour: '', rating: '2', tags: [], perils: { fire: true, flood: false } }))
            .to.deep.equal({ name: 'Ada', age: 36, insured: false, rating: 2, perils: { fire: true, flood: false } });
        expect(decode({ name: '', age: 'unknown', insured: '', rating: '' })).to.deep.equal({});
        expect(decode(null)).to.deep.equal({});
        expect(decode(['not', 'an', 'object'])).to.deep.equal({});
    });

    it('keeps a number or boolean field\'s title and description', () => {
        const { schema: sent } = requiredSchema({ type: 'object', properties: {
            estimate: { type: 'number', title: 'Damage estimate', description: 'The repair estimate.' },
            towed: { type: 'boolean', description: 'Was the car towed?' },
        } });
        expect(sent.properties.estimate).to.include({ type: 'string', title: 'Damage estimate' });
        expect(sent.properties.estimate.description).to.match(/^The repair estimate\. Answer in digits only/);
        expect(sent.properties.towed).to.deep.equal({ enum: ['true', 'false', ''], description: 'Was the car towed?' });
    });

    it('reads numbers written as amounts, and nothing else', () => {
        const { decode } = requiredSchema({ type: 'object', properties: { n: { type: 'number' } } });
        const read = (n) => decode({ n }).n;
        expect(read('$4,250')).to.equal(4250);
        expect(read('4,250.50')).to.equal(4250.5);
        expect(read(' -3.5 ')).to.equal(-3.5);
        expect(read('-$12')).to.equal(-12);
        expect(read('1200€')).to.equal(1200);
        expect(read('.5')).to.equal(0.5);
        expect(read(42)).to.equal(42);
        for (const text of ['1,5', '12,34,567', 'about 40', '4250 dollars', '1e5', 'Infinity', '$', '4.2.1']) {
            expect(read(text), text).to.equal(undefined);
        }
    });

    it('keeps a typed enum\'s values, and drops an answer outside them', () => {
        const { schema: sent, decode } = requiredSchema({ type: 'object', properties: { level: { type: 'number', enum: [1, 2] }, flag: { type: 'boolean', enum: [true] } } });
        expect(sent.properties.level).to.deep.equal({ type: 'string', enum: ['1', '2', ''] });
        expect(sent.properties.flag).to.deep.equal({ type: 'string', enum: ['true', ''] });
        expect(decode({ level: '2', flag: 'true' })).to.deep.equal({ level: 2, flag: true });
        expect(decode({ level: 'one', flag: '3' })).to.deep.equal({});
    });
});

describe('parseJsonObject', () => {
    it('finds the object in fenced or wrapped text', () => {
        expect(parseJsonObject('```json\n{"a": 1}\n```')).to.deep.equal({ a: 1 });
        expect(parseJsonObject('Here you go: {"a": {"b": 2}} Hope that helps.')).to.deep.equal({ a: { b: 2 } });
    });

    it('throws a safe engine error when there is no object', () => {
        for (const text of ['no json here', '[1, 2]', '{not json}', '', undefined]) {
            expect(() => parseJsonObject(text), String(text)).to.throw(EngineError, 'did not return a JSON object');
        }
    });
});

describe('toolResultText', () => {
    it('joins text blocks and writes other blocks as JSON', () => {
        expect(toolResultText({ content: [{ type: 'text', text: 'one' }, { type: 'image', data: 'x' }] })).to.equal('one\n{"type":"image","data":"x"}');
        expect(toolResultText({ content: [] })).to.equal('(no output)');
        expect(toolResultText(undefined)).to.equal('(no output)');
    });
});
