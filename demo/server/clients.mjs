/**
 * The demo's two backends: the Form.io project, over REST with the project
 * key, and the UAG, over MCP and the Agent API with a token from the
 * client_credentials grant.
 *
 * Neither is reachable from the internet. The browser talks only to this
 * server, and this server connects out to them on the private network, which
 * is the deployment the UAG recommends for server-side clients.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class FormioClient {
    constructor({ projectUrl, keyHeader }, fetch = globalThis.fetch) {
        this.url = projectUrl;
        this.keyHeader = keyHeader;
        this.fetch = fetch;
        this.paths = new Map();
        // Form definitions, which every visitor's page loads, kept for a minute.
        this.forms = new Map();
    }

    /** A form's path from its name: the UAG's tools name forms, Form.io's routes use paths. */
    async pathOf(name) {
        if (this.paths.has(name)) return this.paths.get(name);
        const found = await this.request(`/form?name=${encodeURIComponent(name)}&select=path&limit=1`);
        const path = found.ok && Array.isArray(found.body) && found.body[0]?.path;
        if (!path) throw new Error(`No form named ${name}.`);
        this.paths.set(name, path);
        return path;
    }

    async request(path, { method = 'GET', body, headers = {} } = {}) {
        const response = await this.fetch(`${this.url}${path}`, {
            method,
            headers: { ...this.keyHeader, ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
        });
        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            json = { error: text };
        }
        return { status: response.status, ok: response.ok, body: json, headers: response.headers };
    }

    /** A form definition, as the renderer loads it. */
    async form(name) {
        const cached = this.forms.get(name);
        if (cached && cached.expires > Date.now()) return cached.response;
        const response = await this.request(`/${await this.pathOf(name)}`);
        if (response.ok) this.forms.set(name, { response, expires: Date.now() + 60_000 });
        return response;
    }

    async submission(name, id) {
        return this.request(`/${await this.pathOf(name)}/submission/${encodeURIComponent(id)}`);
    }

    async submit(name, data) {
        return this.request(`/${await this.pathOf(name)}/submission`, { method: 'POST', body: { data } });
    }
}

export class UagClient {
    constructor({ url, clientId, clientSecret, keyHeader, projectPath = '' }, fetch = globalThis.fetch) {
        this.url = url;
        this.projectPath = projectPath;
        // The Agent API takes the project (or admin) key directly from a server; MCP takes a token.
        this.keyHeader = keyHeader;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.fetch = fetch;
        this.token = '';
        this.pending = null;
    }

    /** A cached access token, refreshed a minute before it expires. */
    async accessToken(requestId) {
        if (this.token && !expiresSoon(this.token)) return this.token;
        // One exchange at a time, however many visitors ask at once.
        this.pending ||= (async () => {
            const response = await this.fetch(`${this.url}${this.projectPath}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(requestId && { 'X-Request-Id': requestId }) },
                body: JSON.stringify({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }),
                signal: AbortSignal.timeout(15_000),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !body.access_token) {
                throw new Error(`The UAG refused the demo's credentials (${response.status}). A 404 means BASE_URL is not set on the UAG.`);
            }
            this.token = body.access_token;
            return this.token;
        })().finally(() => { this.pending = null; });
        return this.pending;
    }

    /** An MCP client whose every request carries `requestId`, so the flow viewer can attribute it. */
    async mcp(requestId, name = 'uag-demo') {
        const token = await this.accessToken(requestId);
        const client = new Client({ name, version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(`${this.url}/mcp`), {
            requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': requestId } },
        }));
        return client;
    }

    /** One Agent API call, answered as a fetch Response so a stream can be relayed as it arrives. */
    agent(operation, body, { requestId, accept = 'application/json', signal } = {}) {
        return this.fetch(`${this.url}/agent/${operation}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: accept, ...this.keyHeader, 'X-Request-Id': requestId },
            body: JSON.stringify(body),
            signal,
        });
    }

    /** Save a submission through the UAG, which runs the form's actions on it before it is stored. */
    submit(formPath, data, { requestId }) {
        return this.fetch(`${this.url}${this.projectPath}/${formPath}/submission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.keyHeader, 'X-Request-Id': requestId },
            body: JSON.stringify({ data }),
            signal: AbortSignal.timeout(60_000),
        });
    }

    async capabilities() {
        const response = await this.fetch(`${this.url}/agent/capabilities`, {
            headers: this.keyHeader,
            signal: AbortSignal.timeout(10_000),
        });
        // An error (a UAG still starting, a refused key) says nothing about its license.
        if (!response.ok) throw new Error(`The UAG answered ${response.status} for its capabilities.`);
        return response.json();
    }
}

function expiresSoon(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        return !payload.exp || Date.now() / 1000 >= payload.exp - 60;
    }
    catch {
        return true;
    }
}
