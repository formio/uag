import { AuthProvider, AuthProviderInterface, AuthRequest, ProjectInterface, SubmissionRequest } from "@formio/appserver";
import jwt from "jsonwebtoken";
import { bearerOf, EngineRegistry, FormflowConfig, FormflowForm, FormflowHost, FormflowTool, formflowAuthenticate, readScopedToken, ScopedTokenClaims, toolsForScope } from "./formflow";
import { taskRunner } from './runner';
import { UAGConfig } from "./config";
import { Form } from "@formio/core";
import { NextFunction, Response, Router } from "express";
import { UAGRouter } from "./router";
import { UAGFormInterface } from "./UAGFormInterface";
import { ResponseTemplate, UAGTemplate } from "./template";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AgentRouter } from "./agent/router";
import { allTools, formflowTool } from "./agent/tools";
const debug = require('debug')('formio:uag:UAGProjectInterface');
export class UAGProjectInterface extends ProjectInterface implements FormflowHost {
    public user: any = null;
    /** The names of the UAG forms the project currently has. */
    get formNames(): string[] {
        return Object.values(this.forms).map((form) => (form as UAGFormInterface).uag?.name).filter(Boolean) as string[];
    }
    public uagTemplate: UAGTemplate | null = null;
    /** Engines enabled at startup; empty until UAGServer.router() resolves them. */
    public engines: EngineRegistry = new EngineRegistry();
    public mcpServer = new McpServer({ name: 'formio-uag', version: '1.0.0' });
    get config(): UAGConfig { return ProjectInterface.module?.config || {}; }
    constructor(endpoint?: string) {
        super(endpoint);
    }

    async initialize(): Promise<void> {
        await super.initialize();
        this.uagTemplate = new UAGTemplate(this.config?.responseTemplates || {});
        this.mcpServer = await this.buildMcpServer();
    }

    // Build a fresh McpServer with all tools registered. A new instance is created
    // per request so concurrent requests never share (and overwrite) a transport.
    // A scoped token narrows the tools to its own list, and only ever to tools
    // annotated read-only: no model may write through /mcp with one.
    async buildMcpServer(scope?: Pick<ScopedTokenClaims, 'tools'>): Promise<McpServer> {
        const server = new McpServer({ name: 'formio-uag', version: '1.0.0' });

        // The standard UAG tools, plus the custom tools from config.
        let tools = await allTools(this);

        if (scope) {
            tools = toolsForScope(tools, scope).filter((tool) => tool.annotations?.readOnlyHint === true);
        }

        // Register all the tools (allTools() keeps only the named ones).
        for (const tool of tools) {
            server.registerTool(tool.name!, {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                // Carries readOnly/destructive/idempotent/openWorld through to the
                // client. Tools from config.tools may omit them, so this stays
                // conditional rather than sending `annotations: undefined`.
                ...(tool.annotations && { annotations: tool.annotations })
            }, tool.execute);
        }

        // A scoped token that allows no tools must still answer tools/list, with
        // an empty list: clients list tools first,
        // and a server with nothing registered would not offer tools at all.
        if (!tools.length) {
            server.server.registerCapabilities({ tools: {} });
            server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
            server.server.setRequestHandler(CallToolRequestSchema, async (request) => ({
                content: [{ type: 'text' as const, text: `The tool "${request.params.name}" is not available to this token.` }],
                isError: true
            }));
        }
        return server;
    }

    addForm(form: Form, machineName: string): UAGFormInterface | undefined {
        const formInterface = super.addForm(form, machineName) as UAGFormInterface;
        if (!formInterface) return;
        // The registration itself is derived from the form by UAGFormInterface.setForm().
        if (formInterface.uag) {
            debug(`Registering UAG form: ${formInterface.uag.machineName}`);
        }
        return formInterface;
    }

    /**
     * The UAG's routes: `/mcp`, and unless excluded, `/agent/capabilities`.
     * UAGServer mounts capabilities separately, ahead of the project router. A
     * form's agent operations are on the form's own routes (UAGFormInterface).
     */
    uagRouter(includeAgentApi: boolean = true): Router {
        const router = Router();
        const uagRouter = UAGRouter(this);
        router.use('/mcp', (req: any, res: any, next: any) => this.authorizeRequest(req as SubmissionRequest, res, next), uagRouter as any);
        if (includeAgentApi) {
            router.use(this.agentRouter());
        }
        return router;
    }

    /** `/agent/capabilities`, behind its own authentication. */
    agentRouter(): Router {
        return AgentRouter(this, formflowAuthenticate(this) as any);
    }

    /** Whether runs after the save are recorded and survive a restart (the UAG's database). */
    durableRuns(): boolean {
        return taskRunner(this).durable;
    }

    /** The engines enabled for Agentic Formflow. */
    formflowEngines(): EngineRegistry {
        return this.engines;
    }

    /**
     * Agentic Formflow's routing, Agent API and auth settings. The engine
     * settings stay here: the UAG loads the engines, not core.
     */
    formflowConfig(): FormflowConfig {
        const { engines, engineTypes, ...config } = this.config || {};
        return config;
    }

    /** A form tagged "uag", or null. */
    async formflowForm(name: string): Promise<FormflowForm | null> {
        const form = await this.getForm(name) as UAGFormInterface | null;
        return form?.uag ? form : null;
    }

    /** Every MCP tool, as Agentic Formflow tools. */
    async formflowTools(): Promise<FormflowTool[]> {
        return (await allTools(this)).map(formflowTool);
    }

    async authorizeRequest(req: SubmissionRequest, res: Response, next: NextFunction) {
        try {
            let authorization = req.get('authorization');

            // A scoped token carries the identity it was issued for (the caller's
            // own token, or admin) and limits the tools /mcp offers.
            const bearer = bearerOf(authorization);
            const scoped = bearer ? readScopedToken(this, bearer) : null;
            if (scoped) {
                (req as any).uagScope = scoped;
                if (scoped.admin) {
                    req.auth = new AuthRequest(this, true);
                    return next();
                }
                if (!scoped.bearer) {
                    throw new Error('Scoped token has no identity');
                }
                authorization = `Bearer ${scoped.bearer}`;
            }

            const pkce = this.provider<AuthProviderInterface>('auth.pkce');
            if (!pkce) {
                throw new Error('No PKCE provider configured');
            }
            // A scoped token may carry a Form.io user token (the caller's x-jwt-token,
            // or one the UAG signed for a run's research), not one of /mcp's own
            // access tokens: it is verified as the project verifies x-jwt-token.
            if (scoped?.bearer && !(jwt.decode(scoped.bearer) as any)?.sub) {
                req.auth = await this.formioTokenAuth(pkce as unknown as AuthProvider, scoped.bearer);
                return next();
            }
            const auth = await pkce.authorize(authorization);
            if (!auth || !auth.user) {
                throw new Error('Unauthorized');
            }
            req.auth = auth;
            next();
        }
        catch (err: any) {
            // Point MCP clients at OAuth sign-in only when it is on (MCP_OAUTH, with the database).
            const pkce: any = this.provider<AuthProviderInterface>('auth.pkce');
            const metadata = pkce?.oauthReady ? `, resource_metadata="${pkce.publicUrl(req)}/.well-known/oauth-protected-resource"` : '';
            // RFC 6750 3.1: a request that presented a token is told it is invalid; one
            // that presented none gets no error code, only the challenge.
            const presented = !!bearerOf(req.get('authorization'));
            const description = String(err?.message || err || 'Unauthorized').replace(/["\\]/g, '');
            const challenge = presented ? `, error="invalid_token", error_description="${description}"` : '';
            return res.status(401).set({
                'WWW-Authenticate': `Bearer realm="uag-server"${challenge}${metadata}`
            }).json({
                error: presented ? 'invalid_token' : 'unauthorized',
                error_description: presented ? description : 'Send an access token: Authorization: Bearer <token>.'
            });
        }
    }

    /**
     * The user a Form.io token stands for, as the project's x-jwt-token
     * authentication decides it: a token tied to a Form.io session is asked of
     * Form.io; one signed with this UAG's secret is read from its claims, bound
     * to this project; any other is asked of Form.io. Never an administrator:
     * an administrator's research carries no user token.
     */
    private async formioTokenAuth(provider: AuthProvider, token: string): Promise<AuthRequest> {
        const auth = new AuthRequest(this);
        const projectId = String(this.project?._id || '');
        const fromFormio = async () => {
            const user = await provider.formioUser(token);
            if (!user) throw new Error('Unauthorized');
            // A user of another project is refused, as /mcp's own sign-in refuses one.
            if (user.project && String(user.project) !== projectId) throw new Error('Forbidden');
            return auth.fromFormioUser(user, token, this);
        };
        if (this.proxyMode && AuthProvider.sessionToken(token)) {
            await fromFormio();
        }
        else {
            const secret = this.config?.auth?.secret;
            let verified: any = null;
            try {
                if (secret) verified = jwt.verify(token, secret);
            }
            catch (err: any) {
                if (err?.name === 'TokenExpiredError') throw new Error('Token Expired');
            }
            if (verified) {
                // Only a token for this project: one naming no project (or another) is refused.
                if (!projectId || String(verified.project?._id || '') !== projectId) throw new Error('Forbidden');
                // Kept as it is, never signed again: a token the UAG signed for a run
                // keeps its roles and its short lifetime when forwarded to Form.io.
                auth.token = token;
                await auth.fromAuthToken(verified, this);
            }
            else if (this.proxyMode) {
                await fromFormio();
            }
            else {
                throw new Error('Unauthorized');
            }
        }
        if (!auth.user) throw new Error('Unauthorized');
        auth.admin = false;
        return auth;
    }

    mcpJSONResponse(data: object = {}, isError: boolean = false) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify(data),
                }
            ],
            structuredContent: data,
            ...(isError && { isError: true }),
        }

    }

    mcpResponse(templateName: ResponseTemplate, data: object = {}, isError: boolean = false) {
        return {
            content: [
                {
                    type: 'text' as const,
                    text: this.uagTemplate?.renderTemplate(templateName, data) || '',
                },
            ],
            ...(isError && { isError: true }),
        };
    }
}