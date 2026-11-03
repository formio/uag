/**
 * Pinning tests: the MCP tool list as clients see it.
 *
 * Records the full `tools/list` answer (names, titles, descriptions, input
 * schemas, annotations, order): the whole list, as a signed-in MCP client gets
 * it, and POST /mcp for an anonymous caller, a user's scoped token and an
 * administrator's scoped token, with and without a 1.x-style module that
 * adds a tool and overrides a built-in one through `toolOverrides`. Tool
 * descriptions are what models read, so a wording change must show up here as
 * a fixture change. Fixtures change only on purpose (UPDATE_FIXTURES=1).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { issueScopedToken } from '../../src/formflow';
import { requireTestLicense } from '../agent/fixtures';
import { matchesFixture } from './fixture';
import { ADMIN_KEY, mcpBody, oneXModule, start, Started, user } from './harness';

describe('Pinning: MCP tool list', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; });

    async function toolsList(headers: Record<string, string>) {
        const res = await started!.request().post('/mcp')
            .set({ Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...headers })
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
        const body = mcpBody(res);
        return { status: res.status, tools: body?.result?.tools ?? null, error: typeof body === 'object' ? body?.error : undefined };
    }

    /** The whole list, as an MCP client signed in with an access token gets it (no scope). */
    async function fullList() {
        const server = await (started!.server.uagProject as any).buildMcpServer();
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'pinning', version: '1.0.0' });
        await client.connect(clientSide);
        try {
            return (await client.listTools()).tools;
        }
        finally {
            await client.close();
        }
    }

    async function callers() {
        const project: any = started!.server.uagProject;
        const tools = [
            { name: 'get_forms', readOnly: true },
            { name: 'find_submissions', readOnly: true },
            { name: 'module_lookup', readOnly: true }
        ];
        const userScoped = issueScopedToken(project, { admin: false, bearer: started!.tokenFor(user) }, tools, 60000)!;
        const adminScoped = issueScopedToken(project, { admin: true }, tools, 60000)!;
        const adminKey = await toolsList({ 'x-admin-key': ADMIN_KEY });
        return {
            signedIn: await fullList(),
            anonymous: await toolsList({}),
            adminKeyWithoutBearer: { status: adminKey.status },
            userScopedToken: await toolsList({ Authorization: `Bearer ${userScoped}` }),
            adminScopedToken: await toolsList({ Authorization: `Bearer ${adminScoped}` })
        };
    }

    it('default tools', async () => {
        started = await start();
        matchesFixture('mcp-tools-default', await callers());
    });

    it('with a 1.x-style module adding a tool and overriding a built-in', async () => {
        started = await start({ modules: [oneXModule()] });
        matchesFixture('mcp-tools-1x-module', await callers());
    });
});
