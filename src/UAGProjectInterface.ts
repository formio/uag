import { AuthProviderInterface, ProjectInterface, SubmissionRequest } from "@formio/appserver";
import { UAGConfig } from "./config";
import { Form } from "@formio/core";
import { NextFunction, Response } from "express";
import { getTools } from "./tools";
import { UAGRouter } from "./router";
import { UAGFormInterface } from "./UAGFormInterface";
import { ResponseTemplate, UAGTemplate } from "./template";
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
const debug = require('debug')('formio:uag:UAGProjectInterface');
export class UAGProjectInterface extends ProjectInterface {
    public user: any = null;
    public formNames: string[] = []
    public uagTemplate: UAGTemplate | null = null;
    public mcpServer = new McpServer({ name: 'formio-uag', version: '1.0.0' });
    get config(): UAGConfig { return ProjectInterface.module?.config || {}; }
    constructor(endpoint?: string) {
        super(endpoint);
    }

    async initialize(): Promise<void> {
        await super.initialize();
        this.uagTemplate = new UAGTemplate(this.config?.responseTemplates || {});

        // Get the standard UAG tools.
        const tools = await getTools(this);

        // Add the custom tools from config.
        if (this.config?.tools?.length) {
            tools.push(...this.config.tools);
        }

        // Iterate and register all the tools.
        for (const tool of tools) {
            if (tool?.name) {
                this.mcpServer.registerTool(tool.name, {
                    title: tool.title,
                    description: tool.description,
                    inputSchema: tool.inputSchema
                }, tool.execute);
            }
        }
    }

    addForm(form: Form, key: string): UAGFormInterface | undefined {
        const formInterface = super.addForm(form, key) as UAGFormInterface;
        if (!formInterface) return;
        key = key || formInterface?.form?.key;
        if (form.tags?.includes('uag')) {
            debug(`Registering UAG form: ${key}`);
            formInterface.uag = {
                machineName: key,
                name: form.name || form.path || key,
                title: form.title || form.name || key,
                description: form.properties?.description || `A form to submit new ${form.title} records.`
            };
            this.formNames.push(formInterface.uag.name)
        }
        return formInterface;
    }

    async router(): Promise<any> {
        const router = await super.router();
        const uagRouter = UAGRouter(this);
        router.use('/uag', (req: any, res: any, next: any) => this.authorizeRequest(req as SubmissionRequest, res, next), uagRouter as any);
        router.use('/mcp', (req: any, res: any, next: any) => this.authorizeRequest(req as SubmissionRequest, res, next), uagRouter as any);
        return router;
    }

    async authorizeRequest(req: SubmissionRequest, res: Response, next: NextFunction) {
        try {
            const pkce = this.provider<AuthProviderInterface>('auth.pkce');
            if (!pkce) {
                throw new Error('No PKCE provider configured');
            }
            const auth = await pkce?.authorize(req.get('authorization'));
            if (!auth || !auth.user) {
                throw new Error('Unauthorized');
            }
            req.auth = auth;
            next();
        }
        catch (err: any) {
            return res.status(401).set({
                'WWW-Authenticate': `Bearer realm="uag-server", resource_metadata="${this.config?.baseUrl}/.well-known/oauth-protected-resource"`
            }).json({
                detail: err.message || err
            });
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