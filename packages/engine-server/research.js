'use strict';
const { REQUEST_ID_HEADER } = require('@formio/uag-sdk/protocol');

/**
 * Research for an extract request: an MCP connection to the UAG's `/mcp`,
 * authenticated with the scoped token the UAG sent. The UAG decides what the
 * token allows (the task's read-only tools, with the caller's identity); this
 * side offers the model only the tools that were both requested and listed
 * there, and records every call.
 */

/** Connect an MCP client to `url` with `token` as its bearer token, and the UAG's request id when there is one. */
async function connectMcp(url, token, requestId) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'uag-engines', version: require('./package.json').version });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}`, ...(requestId && { [REQUEST_ID_HEADER]: requestId }) } },
    }));
    return client;
}

/**
 * Open research: connect, intersect the tools, and return what the engine's
 * extract needs, the calls made, and `close`, which is safe to call twice.
 */
async function openResearch({ uagServer, token, requestId, requested, signal, connect = connectMcp }) {
    signal.throwIfAborted();
    const client = await connect(`${uagServer.replace(/\/+$/, '')}/mcp`, token, requestId);
    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        await client.close().catch(() => {});
    };
    signal.addEventListener('abort', close, { once: true });
    try {
        // The UAG may have given up while this side was connecting.
        signal.throwIfAborted();
        const listed = new Map(((await client.listTools()).tools || []).map((tool) => [tool.name, tool]));
        const names = new Set(requested.map((tool) => tool.name).filter((name) => listed.has(name)));
        const tools = [...names].map((name) => {
            const tool = listed.get(name);
            return { name, description: tool.description || '', inputSchema: tool.inputSchema || { type: 'object' } };
        });
        const calls = [];
        async function callTool(name, args) {
            if (signal.aborted || closed) {
                throw signal.reason || new Error('The research was stopped.');
            }
            if (!names.has(name)) {
                calls.push({ name, isError: true });
                return { content: [{ type: 'text', text: `The tool "${name}" is not available to this task.` }], isError: true };
            }
            let result;
            try {
                result = await client.callTool({ name, arguments: args || {} }, undefined, { signal });
            }
            catch (err) {
                if (signal.aborted) throw signal.reason || err;
                result = { content: [{ type: 'text', text: err && err.message ? err.message : 'The tool call failed.' }], isError: true };
            }
            calls.push({ name, isError: !!result.isError });
            return result;
        }
        return { tools, callTool, calls, close };
    }
    catch (err) {
        await close();
        throw err;
    }
}

module.exports = { connectMcp, openResearch };
