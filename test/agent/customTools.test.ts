import { expect } from 'chai';
import z from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { allTools } from '../../src/agent/tools';
import { claimForm, makeProject } from './fixtures';
import type { ToolExtra, ToolFactory, ToolInfo } from '../../src/tools/utils';

const READS = { title: 'Reads', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITES = { title: 'Writes', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

/**
 * Custom tools in `config.tools`: plain tools or factories that build one for
 * the project, and the `ToolExtra` (`authInfo` and `project`) every call gets.
 */
describe('Custom tools', () => {
    function project(tools: any[]) {
        const p: any = makeProject({ claim: claimForm() });
        p.agentConfig = { tools };
        return p;
    }

    /** Call a tool on the project's /mcp server, as an MCP client would. */
    async function callOnMcp(p: any, name: string, args: Record<string, any> = {}) {
        const server = await p.buildMcpServer();
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '1.0.0' });
        await client.connect(clientSide);
        try {
            return await client.callTool({ name, arguments: args });
        }
        finally {
            await client.close();
        }
    }

    const registered = (server: any): string[] => Object.keys(server._registeredTools || {});

    describe('factories', () => {
        it('builds a factory\'s tool with the project, next to plain tools', async () => {
            const seen: any[] = [];
            const factory: ToolFactory = (p) => {
                seen.push(p);
                return { name: 'list_form_names', annotations: READS, inputSchema: { form_name: z.enum(p.formNames as [string, ...string[]]) } };
            };
            const p = project([factory, { name: 'plain_tool', annotations: READS }]);
            const names = (await allTools(p)).map((tool) => tool.name);
            expect(names).to.include.members(['list_form_names', 'plain_tool', 'get_forms']);
            expect(seen[0]).to.equal(p);
        });

        it('awaits an async factory', async () => {
            const p = project([async () => ({ name: 'async_tool', annotations: READS })]);
            expect((await allTools(p)).map((tool) => tool.name)).to.include('async_tool');
        });

        it('skips a factory whose tool has no name, as it skips a plain tool without one', async () => {
            const p = project([() => ({ name: '' }), () => undefined as any, { description: 'nameless' }]);
            const custom = (await allTools(p)).filter((tool) => ['', undefined].includes(tool.name) || tool.description === 'nameless');
            expect(custom).to.deep.equal([]);
        });

        it('registers a factory\'s tool on /mcp, and a scoped token still gets only read-only tools', async () => {
            const p = project([() => ({ name: 'reads_docs', annotations: READS }), () => ({ name: 'writes_docs', annotations: WRITES })]);
            expect(registered(await p.buildMcpServer())).to.include.members(['reads_docs', 'writes_docs']);
            expect(registered(await p.buildMcpServer({ tools: ['reads_docs', 'writes_docs'] }))).to.deep.equal(['reads_docs']);
        });

        it('offers a factory\'s read-only tool for research', async () => {
            const p = project([() => ({ name: 'reads_docs', annotations: READS, inputSchema: { id: z.string() } })]);
            const tool = (await p.formflowTools()).find((t: any) => t.name === 'reads_docs');
            expect(tool.readOnly).to.equal(true);
            expect(tool.inputSchema.properties).to.have.keys(['id']);
        });
    });

    describe('extra.project', () => {
        function recorder(calls: any[], overrides: Partial<ToolInfo> = {}): ToolInfo {
            return {
                name: 'record',
                annotations: READS,
                inputSchema: { value: z.string().optional() },
                execute: async (args: any, extra: ToolExtra) => {
                    calls.push({ args, extra });
                    return { content: [{ type: 'text', text: 'ok' }] };
                },
                ...overrides
            };
        }

        it('is the project on /mcp', async () => {
            const calls: any[] = [];
            const p = project([recorder(calls)]);
            const result: any = await callOnMcp(p, 'record', { value: 'x' });
            expect(result.isError).to.not.equal(true);
            expect(calls[0].args).to.deep.equal({ value: 'x' });
            expect(calls[0].extra.project).to.equal(p);
        });

        it('is the project for research, with the caller as authInfo', async () => {
            const calls: any[] = [];
            const p = project([recorder(calls)]);
            const auth: any = { user: { _id: 'u1' } };
            const tool = (await p.formflowTools()).find((t: any) => t.name === 'record');
            await tool.execute({ value: 'y' }, auth);
            expect(calls[0].extra.project).to.equal(p);
            expect(calls[0].extra.authInfo).to.equal(auth);
        });

        it('reaches a tool with no input schema as execute(args, extra) on /mcp, as research calls it', async () => {
            const calls: any[] = [];
            const p = project([recorder(calls, { inputSchema: undefined })]);
            await callOnMcp(p, 'record');
            expect(calls[0].args).to.deep.equal({});
            expect(calls[0].extra.project).to.equal(p);
        });

        it('answers an error, rather than failing, for a tool with no execute', async () => {
            const p = project([{ name: 'no_execute', annotations: READS }]);
            const result: any = await callOnMcp(p, 'no_execute');
            expect(result.isError).to.equal(true);
            expect(result.content[0].text).to.contain('no_execute');
        });
    });
});
