import jwt from 'jsonwebtoken';
import { ADMIN_KEY, FORMIO_URL, JWT_SECRET, UAG_URL } from './stack.mjs';

/** Helpers shared by the Agent API suites. */

export const adminHeaders = { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };

export const bearerHeaders = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** Call the UAG and return the status, headers and parsed body. */
export async function api(path, { method = 'POST', headers = adminHeaders, body } = {}) {
    const resp = await fetch(`${UAG_URL}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const text = await resp.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch {
        json = text;
    }
    return { status: resp.status, headers: resp.headers, body: json };
}

/**
 * Call a task as a stream and read the Server-Sent Events as they arrive,
 * recording each event's arrival time in milliseconds since the request.
 */
export async function stream(path, body, headers = adminHeaders) {
    const started = Date.now();
    const resp = await fetch(`${UAG_URL}${path}`, {
        method: 'POST',
        headers: { ...headers, Accept: 'text/event-stream' },
        body: JSON.stringify(body),
    });
    const events = [];
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of resp.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            events.push({
                event: /event: (.*)/.exec(block)?.[1],
                data: JSON.parse(/data: (.*)/.exec(block)?.[1] || 'null'),
                at: Date.now() - started,
            });
        }
    }
    return { status: resp.status, headers: resp.headers, events };
}

/** What the scripted engines were sent since the last clear. */
export async function engineCalls(engine) {
    const calls = await (await fetch(`${UAG_URL}/__e2e/engine-calls`)).json();
    return engine ? calls.filter((call) => call.engine === engine) : calls;
}

export async function clearEngineCalls() {
    await fetch(`${UAG_URL}/__e2e/engine-calls`, { method: 'DELETE' });
}

async function formioJson(path, init = {}) {
    const resp = await fetch(`${FORMIO_URL}${path}`, { ...init, headers: { ...adminHeaders, ...(init.headers || {}) } });
    if (!resp.ok) {
        throw new Error(`${init.method || 'GET'} ${path}: HTTP ${resp.status} ${await resp.text()}`);
    }
    return { json: await resp.json(), headers: resp.headers };
}

/**
 * Register a user through Form.io's own registration form (which gives them the
 * "authenticated" role) and return a UAG bearer token for them: their Form.io
 * token, wrapped the way the UAG's token endpoint wraps it. `uagSecret` is the
 * UAG's JWT_SECRET; it must differ from Form.io's for the UAG to look the user
 * and their roles up in Form.io, as it does in a real deployment.
 */
export async function userToken(email, { uagSecret = JWT_SECRET, password = 'user-pass-123456' } = {}) {
    const resp = await fetch(`${FORMIO_URL}/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { email, password } }),
    });
    const formioToken = resp.headers.get('x-jwt-token');
    if (!resp.ok || !formioToken) {
        throw new Error(`User registration failed: HTTP ${resp.status} ${await resp.text()}`);
    }
    return jwt.sign({ sub: formioToken }, uagSecret, { expiresIn: 3600 });
}

/** Add a customer record (the incident form's resource-backed select reads these). */
export async function createCustomer(firstName, lastName, email) {
    return (await formioJson('/customer/submission', {
        method: 'POST',
        body: JSON.stringify({ data: { firstName, lastName, email, referralSource: 'web' } }),
    })).json;
}

/** The value of each field result, by path, leaving out fields with no value. */
export function valuesOf(fields) {
    return Object.fromEntries(Object.entries(fields).filter(([, f]) => f.value !== undefined).map(([path, f]) => [path, f.value]));
}
