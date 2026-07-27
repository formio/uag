import Anthropic from '@anthropic-ai/sdk';
import { mcpText } from './stack.mjs';

const SYSTEM_PROMPT = [
    'You are a conversational form assistant for a Form.io deployment, connected to the',
    'Form.io Universal Agent Gateway (UAG) tools. Users talk to you to fill out and submit forms.',
    'Guide the user through the form like a conversation: figure out which form they want,',
    'ask for the information the form requires (including any conditionally required fields),',
    'validate the values against the field rules, and once all required fields are collected',
    'and the user confirms, submit the form. Ask concise questions. Do not invent values the',
    'user did not provide.',
].join(' ');

/**
 * Drives a scripted "user" conversation against Claude, where Claude has the
 * UAG MCP tools available. Sends each scripted user turn, lets Claude run its
 * tool loop to completion, and stops early when `isDone()` reports true.
 *
 * Returns { transcript, toolCalls } for assertions.
 */
export async function runConversation({ mcp, userTurns, isDone, model, maxRequestsPerTurn = 15 }) {
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
    const { tools } = await mcp.listTools();
    const claudeTools = tools.map((t) => ({
        name: t.name,
        description: t.description || '',
        input_schema: t.inputSchema,
    }));

    const messages = [];
    const transcript = [];
    const toolCalls = [];

    for (const userTurn of userTurns) {
        messages.push({ role: 'user', content: userTurn });
        transcript.push({ role: 'user', text: userTurn });

        for (let i = 0; i < maxRequestsPerTurn; i++) {
            const resp = await anthropic.messages.create({
                model,
                max_tokens: 4096,
                system: SYSTEM_PROMPT,
                messages,
                tools: claudeTools,
            });
            const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
            if (text) transcript.push({ role: 'assistant', text });
            if (resp.stop_reason !== 'tool_use') break;

            messages.push({ role: 'assistant', content: resp.content });
            const results = await Promise.all(
                resp.content.filter((b) => b.type === 'tool_use').map(async (block) => {
                    toolCalls.push({ name: block.name, input: block.input });
                    try {
                        const result = await mcp.callTool({ name: block.name, arguments: block.input });
                        return {
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: mcpText(result),
                            is_error: !!result.isError,
                        };
                    }
                    catch (error) {
                        return { type: 'tool_result', tool_use_id: block.id, content: error.message, is_error: true };
                    }
                }),
            );
            messages.push({ role: 'user', content: results });
        }

        if (await isDone()) break;
    }

    return { transcript, toolCalls };
}
