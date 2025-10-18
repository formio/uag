import { Router, Response } from 'express';
import { UAGProjectInterface } from './UAGProjectInterface';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types';

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

export function UAGRouter(project: UAGProjectInterface): Router {
    const router: Router = Router();

    // Handles the MCP post requests.
    router.post('/', async (req, res) => {
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,  // Use "undefined" to trigger stateless mode.
            });
            project.mcpServer.connect(transport);
            if (!transport) {
                res.status(500).json(JSON.parse(createJsonRpcErrorResponse(-32603, "Unable to create MCP transport.")));
                return;
            }
            isInitializeRequest(req.body);
            await transport.handleRequest(req as any, res as any, req.body);
        } catch (error) {
            handleResponseError(error, res);
        }
    });

    // Handles the MCP get requests (for health checks, etc).
    router.get('/', async (req, res) => {
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,  // Use "undefined" to trigger stateless mode.
            });
            project.mcpServer.connect(transport);
            if (!transport) {
                res.status(500).json(JSON.parse(createJsonRpcErrorResponse(-32603, "Unable to create MCP transport.")));
                return;
            }
            await transport.handleRequest(req as any, res as any);
        } catch (err) {
            handleResponseError(err, res);
        }
    });

    // Return the router
    return router;
};