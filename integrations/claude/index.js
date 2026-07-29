#!/usr/bin/env node
import 'dotenv/config';
import Express from 'express';
import bodyParser from 'body-parser';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { authenticate } from './auth.js';
import { commands } from './commands/index.js';
const app = Express();
const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY || '',
});
app.use(bodyParser.json());
app.use(Express.json());

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
const CLAUDE_MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '10000', 10);
const CLAUDE_MAX_ITERATIONS = parseInt(process.env.CLAUDE_MAX_ITERATIONS || '25', 10);
const UAG_MCP_URL = `${process.env.UAG_SERVER || process.env.BASE_URL}/mcp`;

/**
 * Converts MCP tool result content blocks into Claude API tool_result content.
 */
function toToolResultContent(content) {
    if (!content || !content.length) {
        return '';
    }
    return content.map((block) => {
        if (block.type === 'text') {
            return { type: 'text', text: block.text };
        }
        if (block.type === 'image') {
            return {
                type: 'image',
                source: { type: 'base64', media_type: block.mimeType, data: block.data },
            };
        }
        return { type: 'text', text: JSON.stringify(block) };
    });
}

/**
 * Executes an agent command by connecting directly to the UAG MCP server and running
 * the tool-use loop locally. The Claude API only ever receives outbound requests
 * (tool schemas and tool results), so the UAG does not need to be publicly accessible
 * and can live on localhost or a private Docker network.
 */
async function agentCommand(req, res) {
    if (!req.agentCommand) {
        res.status(400).json({ error: 'Bad Request: Missing agent command' });
        return;
    }
    const mcp = new Client({ name: 'formio-uag-claude', version: '1.0.0' });
    try {
        await mcp.connect(new StreamableHTTPClientTransport(new URL(UAG_MCP_URL), {
            requestInit: {
                headers: { Authorization: `Bearer ${req.authToken}` },
            },
        }));
        const { tools } = await mcp.listTools();
        const claudeTools = tools.map((tool) => ({
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema,
        }));
        const messages = [
            {
                role: 'user',
                content: req.agentCommand,
            },
        ];
        let resp = null;
        for (let iteration = 0; iteration < CLAUDE_MAX_ITERATIONS; iteration++) {
            resp = await anthropic.messages.create({
                model: CLAUDE_MODEL,
                max_tokens: CLAUDE_MAX_TOKENS,
                messages,
                tools: claudeTools,
            });
            if (resp.stop_reason !== 'tool_use') {
                break;
            }
            messages.push({ role: 'assistant', content: resp.content });
            const toolUses = resp.content.filter((block) => block.type === 'tool_use');
            const toolResults = await Promise.all(toolUses.map(async (block) => {
                try {
                    const result = await mcp.callTool({ name: block.name, arguments: block.input });
                    return {
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: toToolResultContent(result.content),
                        is_error: !!result.isError,
                    };
                }
                catch (error) {
                    return {
                        type: 'tool_result',
                        tool_use_id: block.id,
                        content: `Tool execution failed: ${error.message}`,
                        is_error: true,
                    };
                }
            }));
            messages.push({ role: 'user', content: toolResults });
        }
        res.json(resp);
    }
    catch (error) {
        console.error('Agent command failed:', error);
        res.status(500).json({ error: error.message });
    }
    finally {
        await mcp.close().catch(() => {});
    }
}

// General endpoint to post some command to the claude agent.
app.post('/agent/claude', authenticate, async (req, res) => {
    req.agentCommand = req.body.command;
    return agentCommand(req, res);
});

/**
 * Post some commands to the claude agent to perform actions while using the UAG toolset.
 *
 * Returns the response from the agent.
 */
for (const command in commands) {
    const path = `/agent/claude/${command}`;
    app.post(path, authenticate, async (req, res) => {
        req.agentCommand = commands[command](req.body);
        return agentCommand(req, res);
    });
}

// Start the server
app.listen((process.env.PORT || 3300), () => {
    console.log(`Claude UAG Agent server is running on port ${process.env.PORT || 3300}`);
});
