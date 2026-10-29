/**
 * The demo's two backends: the Form.io project, over REST with the project
 * key, and the UAG, over the Agent API and submissions with the same key.
 *
 * Neither is reachable from the internet. The browser talks only to this
 * server, and this server connects out to them on the private network, which
 * is the deployment the UAG recommends for server-side clients.
 */
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
    constructor({ url, keyHeader, projectPath = '' }, fetch = globalThis.fetch) {
        this.url = url;
        this.projectPath = projectPath;
        // The Agent API and submissions take the project (or admin) key directly from a server.
        this.keyHeader = keyHeader;
        this.fetch = fetch;
    }

    /** One of a form's agent operations, answered as a fetch Response so a stream can be relayed as it arrives. */
    agent(formPath, operation, body, { requestId, accept = 'application/json', signal } = {}) {
        return this.fetch(`${this.url}${this.projectPath}/${formPath}/agent/${operation}`, {
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
