import { Router, Response } from 'express';
import { UAGProjectInterface } from './UAGProjectInterface';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

// Helper function to create JSON RPC error responses
const createJsonRpcErrorResponse = (code: number, message: string) => {
    return JSON.stringify({
        error: { code, message },
        id: null,
        jsonrpc: "2.0",
    });
};

/**
 * Handle errors that occur during response processing.
 * @param error The error that occurred.
 * @param res The response object.
 * @returns True if the error was handled, false otherwise.
 */
const handleResponseError = (error: unknown, res: Response): boolean => {
    if (error instanceof Response) {
        const fixedHeaders: Record<string, string> = {};
        error.headers.forEach((value, key) => {
            fixedHeaders[key] = value;
        });
        res.status(error.status).set(fixedHeaders).send(error.statusText);
        return true;
    }
    console.error("[formio-uag] error handling request", error);
    res.status(500).json(JSON.parse(createJsonRpcErrorResponse(-32603, "Internal Server Error")));
    return false;
};

/**
 * Build a per-request McpServer + transport (stateless mode) and tear both down
 * when the response closes. A fresh instance per request keeps concurrent requests
 * from overwriting each other's transport.
 */
const connectMcpTransport = async (
    project: UAGProjectInterface,
    res: Response,
): Promise<StreamableHTTPServerTransport> => {
    const server = await project.buildMcpServer();
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

    // Handles the MCP post requests.
    router.post('/', async (req, res) => {
        try {
            const transport = await connectMcpTransport(project, res);
            await transport.handleRequest(req as any, res as any, req.body);
        } catch (error) {
            handleResponseError(error, res);
        }
    });

    // Handles the MCP get requests (for health checks, etc).
    router.get('/', async (req, res) => {
        try {
            const transport = await connectMcpTransport(project, res);
            await transport.handleRequest(req as any, res as any);
        } catch (err) {
            handleResponseError(err, res);
        }
    });

    // Return the router
    return router;
};