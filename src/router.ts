import { Router, type Request, type Response as ExpressResponse } from 'express';
import { UAGProjectInterface } from './UAGProjectInterface';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ScopedTokenClaims } from './formflow';

// Helper function to create JSON RPC error responses
const createJsonRpcErrorResponse = (code: number, message: string) => ({
    error: { code, message },
    id: null,
    jsonrpc: "2.0",
});

/**
 * Handle errors that occur during response processing.
 * @param error The error that occurred.
 * @param res The response object.
 * @returns True if the error was handled, false otherwise.
 */
const handleResponseError = (error: unknown, res: ExpressResponse): boolean => {
    // A thrown fetch Response (the global Response, not Express's) carries the
    // upstream status and headers that should be forwarded to the client.
    if (error instanceof Response) {
        const fixedHeaders: Record<string, string> = {};
        error.headers.forEach((value, key) => {
            fixedHeaders[key] = value;
        });
        res.status(error.status).set(fixedHeaders).send(error.statusText);
        return true;
    }
    console.error("[formio-uag] error handling request", error);
    res.status(500).json(createJsonRpcErrorResponse(-32603, "Internal Server Error"));
    return false;
};

/**
 * Build a per-request McpServer + transport (stateless mode) and tear both down
 * when the response closes. A fresh instance per request keeps concurrent requests
 * from overwriting each other's transport.
 */
const connectMcpTransport = async (
    project: UAGProjectInterface,
    res: ExpressResponse,
    scope?: ScopedTokenClaims,
): Promise<StreamableHTTPServerTransport> => {
    const server = await project.buildMcpServer(scope);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,  // Use "undefined" to trigger stateless mode.
    });
    res.on('close', () => {
        transport.close();
        server.close();
    });
    await server.connect(transport);
    return transport;
};

export function UAGRouter(project: UAGProjectInterface): Router {
    const router: Router = Router();

    // Handles the MCP requests: posts carry a JSON-RPC body, gets do not (health checks, etc).
    const handleMcpRequest = (withBody: boolean) => async (req: Request, res: ExpressResponse) => {
        try {
            const transport = await connectMcpTransport(project, res, (req as any).uagScope);
            await transport.handleRequest(req as any, res as any, withBody ? req.body : undefined);
        } catch (error) {
            handleResponseError(error, res);
        }
    };
    router.post('/', handleMcpRequest(true));
    router.get('/', handleMcpRequest(false));

    // Return the router
    return router;
};