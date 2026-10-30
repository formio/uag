import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';

/**
 * A Form.io project server that stores submissions in memory: enough for the
 * UAG to load a project template and forward submissions to it, as it does to
 * Form.io in proxy mode. Every request is recorded in `requests`.
 */
export class FakeFormio {
    public endpoint = '';
    public requests: { method: string; url: string; body: any; headers: Record<string, any> }[] = [];
    public submissions: Record<string, any> = {};
    /** Form.io user tokens this server accepts at /current, and the user each stands for. */
    public users: Record<string, any> = {};
    /**
     * The JWT secret this server signs with: it accepts external tokens signed
     * with it (as Form.io Enterprise does) and refuses other external tokens.
     */
    public secret = '';
    /** Refuse every submission read, as Form.io does for a caller without read access. */
    public refuseReads = false;
    /** Form.io Enterprise's action items (Action Logs), for `/action`. */
    public actionItems: any[] = [];
    private server?: http.Server;
    private nextId = 1;
    private forms: Record<string, any> = {};

    /** Each form's id, by key. */
    get formIds(): Record<string, string> {
        return Object.fromEntries(Object.entries(this.forms).map(([key, form]) => [key, form._id]));
    }

    /** `template` is a project template: roles, forms and actions by key. */
    constructor(private template: { roles?: Record<string, any>; forms: Record<string, any>; actions?: Record<string, any> }) {
        for (const [key, form] of Object.entries(template.forms)) {
            this.forms[key] = { ...form, _id: this.id(), machineName: key };
        }
    }

    id(): string {
        return (this.nextId++).toString(16).padStart(24, '0');
    }

    /** The submission requests to a form, by method: what the UAG forwarded. */
    forwarded(method: 'POST' | 'PUT' | 'GET') {
        return this.requests.filter((request) => request.method === method && /\/submission(\/|$)/.test(request.url));
    }

    async start(): Promise<string> {
        const app = express();
        app.use(express.json({ limit: '10mb' }));
        app.use((req, res, next) => {
            this.requests.push({ method: req.method, url: req.url, body: structuredClone(req.body), headers: { ...req.headers } });
            next();
        });
        app.get('/', (req, res) => {
            res.json({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'myproject', machineName: 'myproject', title: 'Project' });
        });
        app.get('/export', (req, res) => {
            const forms: Record<string, any> = {};
            for (const [key, form] of Object.entries(this.forms)) {
                const { _id, machineName, ...rest } = form;
                forms[key] = rest;
            }
            res.json({ title: 'Project', version: '2.0.0', name: 'myproject', roles: this.template.roles || {}, resources: {}, forms, actions: this.template.actions || {} });
        });
        app.get('/access', (req, res) => {
            const roles: Record<string, any> = {};
            for (const [key, role] of Object.entries<any>(this.template.roles || {})) roles[key] = { _id: key, ...role };
            res.json({ roles });
        });
        app.get('/form/:formId/action', (req, res) => res.json([]));
        // Action Logs are for project administrators: here, any caller with a credential.
        app.get('/action', (req, res) => {
            if (!req.headers['x-admin-key'] && !req.headers['x-remote-token'] && !req.headers['x-jwt-token']) return res.status(401).send('Unauthorized');
            const items = this.actionItems.filter((item) => !req.query.form || item.form === req.query.form)
                .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
            const skip = Number(req.query.skip || 0);
            const page = items.slice(skip, skip + Number(req.query.limit || 10));
            res.set('Content-Range', `${skip}-${skip + page.length - 1}/${items.length}`);
            res.json(page);
        });
        // External tokens: accepted when signed with this server's secret, with the user they carry.
        app.use((req, res, next) => {
            const token = String(req.headers['x-jwt-token'] || '');
            const decoded: any = token ? jwt.decode(token) : null;
            if (!decoded?.external) return next();
            try {
                (req as any).external = jwt.verify(token, this.secret);
                next();
            }
            catch {
                res.status(401).send('Token Expired');
            }
        });
        app.get('/current', (req, res) => {
            const external = (req as any).external;
            if (external) return res.json(external.user);
            const user = this.users[String(req.headers['x-jwt-token'] || '')];
            if (!user) return res.status(401).send('Token Expired');
            res.json(user);
        });
        const formOf = (req: express.Request) => Object.values(this.forms).find((form) => form._id === req.params.formId || form.path === req.params.path);
        const create = (req: express.Request, res: express.Response) => {
            const form = formOf(req);
            if (!form) return res.status(404).send('Not found');
            const now = new Date().toISOString();
            const saved = { ...req.body, _id: this.id(), form: form._id, created: now, modified: now };
            this.submissions[saved._id] = saved;
            res.status(201).json(saved);
        };
        const read = (req: express.Request, res: express.Response) => {
            if (this.refuseReads) return res.status(401).send('Unauthorized');
            const found = this.submissions[req.params.id as string];
            if (!found) return res.status(404).send('Not found');
            res.json(found);
        };
        const update = (req: express.Request, res: express.Response) => {
            const found = this.submissions[req.params.id as string];
            if (!found) return res.status(404).send('Not found');
            const saved = { ...found, ...req.body, _id: found._id, modified: new Date(Date.parse(found.modified) + 1000).toISOString() };
            this.submissions[found._id] = saved;
            res.json(saved);
        };
        for (const base of ['/form/:formId/submission', '/:path/submission']) {
            app.post(base, create);
            app.get(`${base}/:id`, read);
            app.put(`${base}/:id`, update);
        }
        app.get('/form/:formId', (req, res) => {
            const form = formOf(req);
            if (!form) return res.status(404).send('Not found');
            res.json(form);
        });
        app.get('/:path', (req, res) => {
            const form = formOf(req);
            if (!form) return res.status(404).send('Not found');
            res.json(form);
        });
        this.server = http.createServer(app);
        await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
        this.endpoint = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
        return this.endpoint;
    }

    async stop(): Promise<void> {
        if (this.server) await new Promise((resolve) => this.server!.close(resolve));
    }
}
