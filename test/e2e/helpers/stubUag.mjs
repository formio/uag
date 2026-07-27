import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/**
 * A minimal stand-in for the UAG server, used by the Claude integration
 * end-to-end tests. Serves the /auth/token endpoint (returning a fake JWT)
 * and a stateless /mcp endpoint exposing two tools:
 *   - echo: returns `ECHO:<text>`
 *   - broken: always throws, to exercise the integration's tool error path.
 */
export async function startStubUag() {
    const app = express();
    app.use(express.json());

    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const fakeJwt = `eyJhbGciOiJub25lIn0.${payload}.sig`;
    const state = { authTokenRequests: 0, mcpRequests: 0, lastAuthHeader: null };

    app.post('/auth/token', (req, res) => {
        state.authTokenRequests++;
        res.json({ access_token: fakeJwt });
    });

    app.post('/mcp', async (req, res) => {
        state.mcpRequests++;
        state.lastAuthHeader = req.headers.authorization || null;
        const server = new McpServer({ name: 'stub-uag', version: '1.0.0' });
        server.tool('echo', 'Echoes back the provided text, prefixed with ECHO:.', { text: z.string() }, async ({ text }) => ({
            content: [{ type: 'text', text: `ECHO:${text}` }],
        }));
        server.tool('broken', 'A tool that always fails. Only call when explicitly asked to.', {}, async () => {
            throw new Error('This tool is intentionally broken.');
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    const listener = await new Promise((resolve) => {
        const l = app.listen(0, '127.0.0.1', () => resolve(l));
    });
    return {
        url: `http://127.0.0.1:${listener.address().port}`,
        state,
        close: () => new Promise((resolve) => listener.close(resolve)),
    };
}
