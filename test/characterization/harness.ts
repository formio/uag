import http from 'http';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { ProjectInterface } from '@formio/appserver';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { FakeFormio } from '../helpers/fakeFormio';
import { TEST_LICENSE } from '../agent/fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

export const SECRET = 'test-secret';
export const PORTAL = 'portal-secret';
export const ADMIN_KEY = 'admin-key';
export const PROJECT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

export const roles = {
    anonymous: { title: 'Anonymous', admin: false, default: true },
    authenticated: { title: 'Authenticated', admin: false, default: false }
};

/** A form tagged uag with one task, its criteria listing read-only research tools. */
export const contactFormWith = (uagTools: string) => ({
    title: 'Contact', type: 'form', name: 'contact', path: 'contact', tags: ['uag'],
    components: [
        { type: 'textarea', key: 'notes', label: 'Notes', input: true, properties: { uag: 'triage', uagField: 'input' } },
        { type: 'content', key: 'triageCriteria', input: false, html: '<p>Summarize the notes.</p>', properties: { uag: 'triage', uagField: 'criteria', uagTools } },
        { type: 'textfield', key: 'name', label: 'Name', input: true, validate: { required: true }, properties: { uag: 'triage' } },
        { type: 'textarea', key: 'summary', label: 'Summary', input: true, properties: { uag: 'triage' } },
        { type: 'select', key: 'priority', label: 'Priority', input: true, data: { values: [{ label: 'Low', value: 'low' }, { label: 'High', value: 'high' }] }, properties: { uag: 'triage' } }
    ],
    access: [{ type: 'read_all', roles: ['anonymous', 'authenticated'] }],
    submissionAccess: [{ type: 'create_own', roles: ['authenticated'] }, { type: 'read_own', roles: ['authenticated'] }]
});
export const contactForm = contactFormWith('get_forms,find_submissions');

/** A 1.x-style module: a custom tool and an override of a built-in tool's description. */
export const oneXModule = () => ({
    config: {
        tools: [{
            name: 'module_lookup',
            title: 'Module lookup',
            description: 'Look up a record in the module\'s directory by its id.',
            inputSchema: { id: require('zod').z.string().describe('The record id.') },
            annotations: { title: 'Module lookup', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
            execute: async (args: any) => ({ content: [{ type: 'text', text: `record ${args.id}` }] })
        }],
        toolOverrides: {
            get_forms: { description: 'List the CRM forms the user can use.' }
        }
    }
});

export type Started = {
    formio: FakeFormio;
    server: UAGServer;
    request: () => supertest.Agent;
    url: string;
    tokenFor: (user: any) => string;
    member: (permission: string) => string;
    stop: () => Promise<void>;
};

/** Start a Form.io stand-in and a UAG in front of it. */
export async function start(options: { config?: any; modules?: any[]; forms?: Record<string, any>; actions?: Record<string, any> } = {}): Promise<Started> {
    const formio = new FakeFormio({ roles, forms: options.forms || { contact: contactForm }, actions: options.actions || {} });
    formio.secret = SECRET;
    await formio.start();
    const server = new UAGServer({
        project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
        auth: { adminKey: ADMIN_KEY, secret: SECRET, portal: PORTAL },
        ...(options.config || {})
    } as any);
    for (const module of options.modules || []) server.use(module);
    await server.initialize();
    const app = express();
    app.use(await server.router());
    const shared = http.createServer(app);
    await new Promise<void>((resolve) => shared.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(shared.address() as any).port}`;
    return {
        formio,
        server,
        url,
        request: () => supertest(shared) as any,
        tokenFor: (user: any) => {
            const token = jwt.sign({ user: { _id: user._id, roles: user.roles }, form: { _id: 'users' }, project: { _id: PROJECT_ID }, jti: `session-${user._id}` }, SECRET, { expiresIn: 3600 });
            formio.users[token] = user;
            return token;
        },
        member: (permission: string) => jwt.sign({ user: { _id: 'member1', data: {}, created: '2026-01-01T00:00:00.000Z' }, project: { _id: PROJECT_ID }, permission }, PORTAL, { expiresIn: 600 }),
        stop: async () => {
            if (server.uagProject) await taskRunner(server.uagProject).idle();
            (server.uagProject as any)?.destroy?.();
            ProjectInterface.module = undefined;
            shared.closeAllConnections();
            await new Promise((resolve) => shared.close(resolve));
            await formio.stop();
        }
    };
}

/** Parse a streamable-HTTP MCP answer: plain JSON, or the first SSE data line. */
export function mcpBody(res: supertest.Response): any {
    const text = res.text || '';
    if ((res.headers['content-type'] || '').includes('text/event-stream')) {
        const data = text.split('\n').find((line) => line.startsWith('data:'));
        return data ? JSON.parse(data.slice(5)) : null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}

export const user = { _id: '5f0000000000000000000001', roles: ['authenticated'], data: { email: 'ada@example.com' } };
