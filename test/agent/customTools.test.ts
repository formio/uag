import { expect } from 'chai';
import z from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { allTools } from '../../src/agent/tools';
import { assertToolEntries } from '../../src/tools/utils';
import { Router } from 'express';
import { UAGServer } from '../../src';
import { claimForm, makeProject } from './fixtures';
import type { ToolExtra, ToolInfo } from '../../src/tools/utils';

const READS = { title: 'Reads', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITES = { title: 'Writes', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

/**
 * Custom tools in `config.tools`: plain tools, or bound tools whose
 * `bind(project)` builds their project-specific part, and the `ToolExtra`
 * (`authInfo` and `project`) every call gets.
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

    describe('bound tools', () => {
        it('binds a tool to the project, next to plain tools', async () => {
            const seen: any[] = [];
            const bound: ToolInfo = {
                name: 'list_form_names',
                title: 'List form names',
                description: 'Lists the forms.',
                bind: (p) => {
                    seen.push(p);
                    return { annotations: READS, inputSchema: { form_name: z.enum(p.formNames as [string, ...string[]]) } };
                }
            };
            const p = project([bound, { name: 'plain_tool', annotations: READS }]);
            const tools = await allTools(p);
            expect(tools.map((tool) => tool.name)).to.include.members(['list_form_names', 'plain_tool', 'get_forms']);
            const tool = tools.find((t) => t.name === 'list_form_names')!;
            expect(tool).to.include({ title: 'List form names', description: 'Lists the forms.' });
            expect(tool.inputSchema).to.have.keys(['form_name']);
            expect(tool).to.not.have.property('bind');
            expect(seen[0]).to.equal(p);
        });

        it('keeps the static name, title and description unless bind returns its own', async () => {
            const p = project([{ name: 'fixed', title: 'Fixed', description: 'Static', bind: () => ({ description: 'From the project', annotations: READS }) }]);
            const tool = (await allTools(p)).find((t) => t.name === 'fixed')!;
            expect(tool).to.include({ title: 'Fixed', description: 'From the project' });
        });

        it('awaits an async bind', async () => {
            const p = project([{ name: 'async_tool', bind: async () => ({ annotations: READS }) }]);
            expect((await allTools(p)).map((tool) => tool.name)).to.include('async_tool');
        });

        it('skips a tool with no name, bound or not', async () => {
            const p = project([{ bind: () => ({ annotations: READS }) }, { name: '', bind: () => ({}) }, { description: 'nameless' }]);
            const custom = (await allTools(p)).filter((tool) => ['', undefined].includes(tool.name) || tool.description === 'nameless');
            expect(custom).to.deep.equal([]);
        });

        it('registers a bound tool on /mcp, and a scoped token still gets only read-only tools', async () => {
            const p = project([{ name: 'reads_docs', bind: () => ({ annotations: READS }) }, { name: 'writes_docs', bind: () => ({ annotations: WRITES }) }]);
            expect(registered(await p.buildMcpServer())).to.include.members(['reads_docs', 'writes_docs']);
            expect(registered(await p.buildMcpServer({ tools: ['reads_docs', 'writes_docs'] }))).to.deep.equal(['reads_docs']);
        });

        it('offers a bound read-only tool for research', async () => {
            const p = project([{ name: 'reads_docs', bind: () => ({ annotations: READS, inputSchema: { id: z.string() } }) }]);
            const tool = (await p.formflowTools()).find((t: any) => t.name === 'reads_docs');
            expect(tool.readOnly).to.equal(true);
            expect(tool.inputSchema.properties).to.have.keys(['id']);
        });

        it('refuses a bare function in config.tools, showing the bound-tool shape', async () => {
            const factory: any = () => ({ name: 'read_document' });
            expect(() => assertToolEntries([{ name: 'ok' }, factory])).to.throw(/config\.tools\[1\] is a function.*bind\(project\) \{ return \{ inputSchema, annotations, execute \}; \}/);
            let message = '';
            try {
                await allTools(project([factory]));
            }
            catch (err: any) {
                message = err.message;
            }
            expect(message).to.include('config.tools[0] is a function');
        });

        it('stops startup when config.tools holds a bare function', async () => {
            const server: any = new UAGServer({ project: 'http://localhost:3001', tools: [() => ({ name: 'read_document' })] } as any);
            let message = '';
            try {
                await server.extendRouter(Router());
            }
            catch (err: any) {
                message = err.message;
            }
            expect(message).to.include('config.tools[0] is a function');
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
