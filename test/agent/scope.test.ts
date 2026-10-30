import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { issueScopedToken } from '../../src/formflow';
import { UAGProjectInterface } from '../../src/UAGProjectInterface';
import { claimForm, makeProject } from './fixtures';

describe('Scoped tokens on /mcp', () => {
    function project(secret: string | null = 'test-secret') {
        const p: any = makeProject({ claim: claimForm() });
        p.agentConfig = secret ? { auth: { secret } } : {};
        p.mcpJSONResponse = UAGProjectInterface.prototype.mcpJSONResponse.bind(p);
        return p;
    }

    describe('on /mcp', () => {
        function registered(server: any): string[] {
            return Object.keys(server._registeredTools || {});
        }

        it('lists only the scoped tools', async () => {
            const p = project();
            const all = registered(await p.buildMcpServer());
            expect(all).to.include.members(['submit_completed_form', 'submission_update', 'get_forms']);
            const scoped = registered(await p.buildMcpServer({ tools: ['get_forms', 'find_submissions'] }));
            expect(scoped).to.deep.equal(['get_forms', 'find_submissions']);
            expect(registered(await p.buildMcpServer({ tools: [] }))).to.deep.equal([]);
        });

        it('never lists a tool that may write, even if a token names it', async () => {
            const scoped = registered(await project().buildMcpServer({ tools: ['get_forms', 'submission_update', 'submit_completed_form'] }));
            expect(scoped).to.deep.equal(['get_forms']);
        });

        it('answers tools/list with an empty list for a token that allows no tools', async () => {
            // MCP clients list tools before anything else.
            const server = await project().buildMcpServer({ tools: [] });
            const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
            await server.connect(serverSide);
            const client = new Client({ name: 'test', version: '1.0.0' });
            await client.connect(clientSide);
            try {
                expect((await client.listTools()).tools).to.deep.equal([]);
                const refused = await client.callTool({ name: 'get_forms', arguments: {} });
                expect(refused.isError).to.equal(true);
            }
            finally {
                await client.close();
            }
        });

        it('authorizes an admin scoped token and records its scope', async () => {
            const p = project();
            const token = issueScopedToken(p, { admin: true }, [{ name: 'get_forms', readOnly: true }], 5000)!;
            const req: any = { get: (name: string) => name === 'authorization' ? `Bearer ${token}` : undefined };
            let called = false;
            await p.authorizeRequest(req, {} as any, () => { called = true; });
            expect(called).to.equal(true);
            expect(req.auth.admin).to.equal(true);
            expect(req.uagScope.tools).to.deep.equal(['get_forms']);
        });

        it('returns 401 for an expired scoped token', async () => {
            const p = project();
            const expired = jwt.sign({ typ: 'uag-scoped', admin: true, tools: [], exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret');
            const req: any = { get: (name: string) => name === 'authorization' ? `Bearer ${expired}` : undefined };
            let status = 0;
            const res: any = { status: (s: number) => { status = s; return res; }, set: () => res, json: () => res };
            await p.authorizeRequest(req, res, () => { throw new Error('should not pass'); });
            expect(status).to.equal(401);
        });
    });
});
