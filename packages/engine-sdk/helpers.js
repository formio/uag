'use strict';
const { EngineError } = require('./errors');

/**
 * Helpers shared by agent engines built on model APIs with structured outputs.
 */

/**
 * The extraction schema with every field required, for strict structured
 * outputs: providers limit how many optional properties and union types a
 * strict schema may have, and OpenAI's strict mode needs every property in
 * `required`. An empty value stands for "not stated": "" for text and options,
 * [] for lists. Numbers and booleans travel as strings. `decode` maps an answer
 * back to the UAG's schema, leaving the "not stated" fields out.
 *
 *   const { schema, decode } = requiredSchema(request.schema);
 *   // ... ask the model for `schema` ...
 *   return { model, values: decode(answer) };
 */
function requiredSchema(schema) {
    const { schema: sent, decoders } = encodeObject(schema, false);
    return { schema: sent, decode: (values) => decodeValues(values, decoders) };
}

function encodeObject(schema, nested) {
    const properties = {};
    const decoders = {};
    for (const [path, property] of Object.entries((schema && schema.properties) || {})) {
        const { sent, decode } = encodeProperty(property, nested);
        properties[path] = sent;
        if (decode) decoders[path] = decode;
    }
    return { schema: { ...schema, properties, required: Object.keys(properties) }, decoders };
}

function encodeProperty(property, nested) {
    if (property.type === 'number' || property.type === 'integer') {
        return {
            sent: { type: 'string' },
            decode: (value) => (value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value)),
        };
    }
    // Inside an object (select boxes) false already means "not selected".
    if (property.type === 'boolean' && !nested) {
        return { sent: { enum: ['true', 'false', ''] }, decode: (value) => (value === 'true' ? true : value === 'false' ? false : undefined) };
    }
    if (Array.isArray(property.enum)) {
        if (property.enum.every((value) => typeof value === 'string')) {
            return { sent: { ...property, enum: [...new Set([...property.enum, ''])] } };
        }
        return {
            sent: { ...property, enum: [...property.enum.map((value) => JSON.stringify(value)), ''] },
            decode: (value) => (value === '' ? undefined : JSON.parse(value)),
        };
    }
    if (property.type === 'object' && property.properties) {
        const inner = encodeObject(property, true);
        return {
            sent: inner.schema,
            decode: (value) => {
                const decoded = decodeValues(value, inner.decoders);
                return Object.keys(decoded).length ? decoded : undefined;
            },
        };
    }
    return { sent: property };
}

/** The answer without the empty "not stated" values, in the UAG's types. */
function decodeValues(values, decoders) {
    const decoded = {};
    if (!values || typeof values !== 'object' || Array.isArray(values)) return decoded;
    for (const [path, value] of Object.entries(values)) {
        if (value === '' || value === null || (Array.isArray(value) && !value.length)) continue;
        const result = decoders[path] ? decoders[path](value) : value;
        if (result !== undefined) decoded[path] = result;
    }
    return decoded;
}

/**
 * The first JSON object in a model's text answer, tolerating code fences and
 * prose around it. Throws an `EngineError` when there is none.
 */
function parseJsonObject(text) {
    const unfenced = String(text || '').replace(/```(?:json)?/gi, '');
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    let parsed;
    if (start !== -1 && end > start) {
        try {
            parsed = JSON.parse(unfenced.slice(start, end + 1));
        }
        catch {
            parsed = undefined;
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new EngineError('The engine did not return a JSON object.');
    }
    return parsed;
}

/** A tool call's result as text for the model: its text blocks, other blocks as JSON. */
function toolResultText(result) {
    const text = ((result && result.content) || [])
        .map((block) => (block && typeof block.text === 'string' ? block.text : JSON.stringify(block)))
        .join('\n');
    return text || '(no output)';
}

module.exports = { requiredSchema, decodeValues, parseJsonObject, toolResultText };
