import 'dotenv/config';
import Express from 'express';
import bodyParser from 'body-parser';
import { Anthropic } from '@anthropic-ai/sdk';
import { authenticate } from './auth.js';
import { commands } from './commands';
const app = Express();
const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY || '',
});
app.use(bodyParser.json());
app.use(Express.json());

// Endpoint to trigger claude agent to provide additional data for a form and submission.
async function agentCommand(req, res) {
    if (!req.agentCommand) {
        res.status(400).json({ error: 'Bad Request: Missing agent command' });
        return;
    }
    const resp = await anthropic.beta.messages.create({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
        max_tokens: parseInt(process.env.CLAUDE_MAX_TOKENS || "10000", 10),
        messages: [
            {
                role: "user",
                content: req.agentCommand,
            },
        ],
        mcp_servers: [
            {
                type: "url",
                url: `${process.env.UAG_SERVER}/mcp`,
                name: "formio-uag",
                authorization_token: req.authToken,
            },
        ],
        tools: [
            {
                type: "mcp_toolset",
                mcp_server_name: "formio-uag",
            },
        ],
        betas: ["mcp-client-2025-11-20"],
    });
    res.json(resp);
}

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