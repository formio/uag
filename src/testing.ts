/**
 * @formio/uag/testing: test a module without a Form.io project or a running UAG.
 *
 *   const { createTestModuleApi, testForm, testAuth, mountModuleRoutes } = require('@formio/uag/testing');
 *
 *   const api = await createTestModuleApi(MyModule, { config: { myModule: { max: 2 } } });
 *   const app = await mountModuleRoutes(MyModule, { form: testForm(definition), auth: testAuth() });
 *   await supertest(app).post('/notes/my-module/check').send({ ... });
 *
 * The API is the UAG's own (errors, stream, forms, converters, engine handles,
 * Markdown, callerKey), with stand-ins only for what needs a project: the
 * caller's access (from `testAuth`), the license (`licensed`), engines
 * (`engines`) and stored files (`testForm` reads base64 values; `files` for
 * others). Settings go through the module's own `settings`, with the server's rules.
 */
import express, { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { createBaseModuleApi, moduleFormRouter, PluginRegistry } from '@formio/appserver';
import type { AuthRequest, LoadedModule, ModuleForm, ModuleRoute, ServerModule } from '@formio/appserver';
import { FormflowError } from './formflow';
import { registerDocuments } from './documents/plugins';
import { agentError } from './agent/errors';
import { UAG_VERSION } from './version';
import { uagModuleApi } from './modules/api';
import { uagErrorBody } from './modules/routes';
import type { UAGModuleApi } from './modules/types';

/** An engine for tests: an agent engine that generates. */
export type TestEngine = { name: string; model?: string; accepts?: Array<'text' | 'pdf'>; generate(request: any): any; kind?: 'agent' };

export type TestModuleOptions = {
    /** The settings as given, instead of running the module's `settings`. */
    settings?: Record<string, any>;
    /** The configuration and environment the module's `settings` gets ({} by default). */
    config?: Record<string, any>;
    env?: Record<string, string | undefined>;
    /** Plugins to register beside the module's own (document plugins, converters). */
    plugins?: any[];
    /** The engines `api.engines.select()` chooses from. */
    engines?: TestEngine[];
    /** Whether Agentic Formflow is licensed (true): false makes `requireLicense` and engine handles refuse with 403. */
    licensed?: boolean;
    /** Reads a stored file value that is not base64 (the test form reads those). */
    files?: (value: any, options: { component?: any; maxBytes?: number }) => Buffer | null | Promise<Buffer | null>;
};

/** A form for tests, as module routes get it: `definition` is the form's JSON. */
export function testForm(definition: Record<string, any>, options: { id?: string; files?: TestModuleOptions['files'] } = {}): ModuleForm & { readFile(value: any, auth: any, options?: any): Promise<Buffer | null> } {
    const form = {
        id: options.id || String(definition._id || 'test-form'),
        name: String(definition.name || definition.path || 'test'),
        path: String(definition.path || definition.name || 'test'),
        title: String(definition.title || definition.name || ''),
        definition,
        async readFile(value: any, _auth: any, readOptions: { maxBytes?: number; component?: any } = {}) {
            const url = String(value?.url || '');
            if (url.startsWith('data:')) {
                const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), url.includes(';base64,') ? 'base64' : 'utf8');
                if (readOptions.maxBytes !== undefined && bytes.length > readOptions.maxBytes) {
                    throw new Error(`The file "${value?.originalName || value?.name || 'unnamed'}" is larger than the ${readOptions.maxBytes} bytes that may be read.`);
                }
                return bytes;
            }
            if (options.files) return options.files(value, readOptions);
            throw new Error('testForm reads base64 (data: URL) files only: give createTestModuleApi or mountModuleRoutes a "files" function for others.');
        }
    };
    return form;
}

/**
 * A caller for tests: a user with these permissions on every form (create and
 * update by default), as a list (`['read']`) or as `formPermissions()` gives
 * them (`{ read: true }`).
 */
export function testAuth(options: { user?: Record<string, any>; permissions?: Array<'create' | 'read' | 'update' | 'delete'> | Partial<Record<'create' | 'read' | 'update' | 'delete', boolean>>; admin?: boolean } = {}): AuthRequest {
    const given = options.permissions || ['create', 'update'];
    const granted = { create: false, read: false, update: false, delete: false } as Record<string, boolean>;
    if (Array.isArray(given)) {
        for (const method of given) granted[method] = true;
    }
    else if (given && typeof given === 'object') {
        for (const method of Object.keys(granted)) granted[method] = (given as any)[method] === true;
    }
    else {
        throw new Error('testAuth: "permissions" is a list of create, read, update and delete, or { read: true, ... }');
    }
    return {
        user: options.user || { _id: 'test-user' },
        admin: !!options.admin,
        formPermissions: () => (options.admin ? { create: true, read: true, update: true, delete: true } : granted)
    } as any;
}

/** The module, checked for what a test needs: a name and an apiVersion. */
function loadedOf(module: ServerModule<any>, settings: Record<string, any>): LoadedModule {
    if (!module || typeof module.name !== 'string' || module.apiVersion === undefined) {
        throw new Error('The module needs a "name" and an "apiVersion" to be tested as a module.');
    }
    return { definition: module as any, name: module.name, source: 'test', settings };
}

/** The module's settings, as the server resolves them. */
function settingsOf(module: ServerModule<any>, options: TestModuleOptions): Record<string, any> {
    if (options.settings) return Object.freeze({ ...options.settings });
    const settings = module.settings ? module.settings(options.config || {}, options.env || {}) : {};
    if (settings && typeof (settings as any).then === 'function') throw new Error(`Module ${module.name}: "settings" returned a promise; it must return the settings themselves (no async)`);
    return Object.freeze({ ...(settings || {}) });
}

/** The UAG's module API for a module, in a test. */
export async function createTestModuleApi<Settings extends Record<string, any> = Record<string, any>>(module: ServerModule<any>, options: TestModuleOptions = {}): Promise<UAGModuleApi<Settings>> {
    const loaded = loadedOf(module, settingsOf(module, options));
    const registry = new PluginRegistry();
    registerDocuments(registry);
    const licensed = options.licensed !== false;
    const requireLicense = async () => {
        if (!licensed) throw new FormflowError(403, 'Agentic Formflow requires a license (the test API was created with licensed: false).', 'license_required');
    };
    const engines = (options.engines || []).map((engine) => ({ kind: 'agent', model: engine.name, accepts: ['text'], ...engine }));
    const base = createBaseModuleApi(loaded, registry, { name: () => 'uag', version: () => UAG_VERSION, errorBody: uagErrorBody });
    const api = uagModuleApi(base, {
        registry: () => registry,
        engines: () => ({ get: (name: string) => engines.find((engine) => engine.name === name), agent: engines.filter((engine) => engine.kind === 'agent') }),
        requireLicense
    });
    const pluginTypes = typeof module.pluginTypes === 'function' ? module.pluginTypes(api) : (module.pluginTypes || []);
    for (const type of pluginTypes) registry.addType(type, module.name);
    if (module.plugins) registry.add(module.plugins, module.name);
    if (options.plugins?.length) registry.add(options.plugins, 'test');
    await registry.initialize({ server: {} as any });
    return api as UAGModuleApi<Settings>;
}

/**
 * The module's form routes on an Express app, as the UAG mounts them on a
 * form (by its path, and by `form/<id>`), for supertest: with the form, the
 * caller, a request id, the access check and the UAG's error shape. No rate
 * limits. `api` is created with `options` unless given.
 */
export async function mountModuleRoutes(module: ServerModule<any>, options: TestModuleOptions & { form: ReturnType<typeof testForm>; auth?: AuthRequest; api?: UAGModuleApi }): Promise<express.Express> {
    const api = options.api || await createTestModuleApi(module, options);
    const loaded = loadedOf(module, api.settings);
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    const host: any = {
        errorBody: uagErrorBody,
        routeHandlers: (_project: any, route: ModuleRoute<any>) => ({
            before: [(req: Request, res: Response, next: NextFunction) => {
                (req as any).requestId = req.get('x-request-id') || randomUUID();
                res.set('X-Request-Id', (req as any).requestId);
                next();
            }],
            wrap: (run: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
                try {
                    await run(req, res);
                }
                catch (err) {
                    const { status, body } = agentError((req as any).requestId, err);
                    res.status(status).json(body);
                }
            }
        })
    };
    const router = moduleFormRouter({} as any, loaded, api, host);
    const withForm = (req: Request, res: Response, next: NextFunction) => {
        (req as any).form = options.form;
        (req as any).auth = options.auth || testAuth();
        next();
    };
    app.use(`/${options.form.path}`, withForm, router);
    app.use(`/form/${options.form.id}`, withForm, router);
    return app;
}
