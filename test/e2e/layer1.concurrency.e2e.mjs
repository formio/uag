import { expect } from 'chai';
import { startStack, getUagToken, connectMcp, formio, mcpText } from './helpers/stack.mjs';

/**
 * Layer 1, concurrent MCP requests.
 *
 * The UAG previously shared a single McpServer instance across all requests and
 * reconnected it to a new transport on every call, so a second concurrent
 * request would close the first request's transport out from under it. These
 * tests drive genuinely concurrent traffic through /mcp and assert that every
 * request gets its own correct answer.
 *
 * Cross-talk is detectable because each request asks about a different form and
 * every response names the form it describes.
 */
describe('Layer 1: concurrent MCP requests', function () {
    this.timeout(300000);

    let stack;
    const FORMS = [
        { form_name: 'customer', expect: 'Customer' },
        { form_name: 'application', expect: 'College Application' },
        { form_name: 'employee', expect: 'Employee' },
    ];

    before(async function () {
        stack = await startStack();
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    it('answers concurrent requests from a single client correctly', async function () {
        // Mirrors an agent making several tool calls in one turn: the MCP client
        // issues each JSON-RPC request as its own concurrent HTTP POST.
        const mcp = await connectMcp(await getUagToken());
        try {
            const requests = Array.from({ length: 12 }, (_, i) => FORMS[i % FORMS.length]);
            const results = await Promise.all(requests.map(({ form_name }) =>
                mcp.callTool({ name: 'get_form_fields', arguments: { form_name } })));

            results.forEach((result, i) => {
                const text = mcpText(result);
                expect(result.isError, `request ${i} (${requests[i].form_name}) errored: ${text}`).to.not.equal(true);
                // The answer must describe the form this request asked about.
                expect(text, `request ${i} got a response for the wrong form`).to.include(requests[i].expect);
            });
        }
        finally {
            await mcp.close().catch(() => {});
        }
    });

    it('answers concurrent requests from independent clients correctly', async function () {
        // Mirrors several agents or users hitting the same UAG at once, each
        // with its own MCP session.
        const token = await getUagToken();
        const clients = await Promise.all(Array.from({ length: 6 }, () => connectMcp(token)));
        try {
            const results = await Promise.all(clients.map((mcp, i) =>
                mcp.callTool({
                    name: 'get_form_fields',
                    arguments: { form_name: FORMS[i % FORMS.length].form_name },
                })));

            results.forEach((result, i) => {
                const text = mcpText(result);
                expect(result.isError, `client ${i} errored: ${text}`).to.not.equal(true);
                expect(text, `client ${i} got a response for the wrong form`)
                    .to.include(FORMS[i % FORMS.length].expect);
            });
        }
        finally {
            await Promise.all(clients.map((mcp) => mcp.close().catch(() => {})));
        }
    });

    it('keeps concurrent submissions separate', async function () {
        // Concurrent writes are the case with real consequences: a crossed
        // transport could drop a submission or answer with another one's result.
        const token = await getUagToken();
        const clients = await Promise.all(Array.from({ length: 6 }, () => connectMcp(token)));
        try {
            const results = await Promise.all(clients.map((mcp, i) =>
                mcp.callTool({
                    name: 'submit_completed_form',
                    arguments: {
                        form_name: 'customer',
                        form_data: {
                            firstName: 'Concurrent',
                            lastName: `Client${i}`,
                            email: `concurrent.client${i}@example.com`,
                            referralSource: 'web',
                        },
                    },
                })));

            results.forEach((result, i) => {
                const text = mcpText(result);
                expect(result.isError, `client ${i} errored: ${text}`).to.not.equal(true);
                // Each response must report the record that client submitted.
                expect(text, `client ${i} got another client's result`).to.include(`Client${i}`);
            });

            // Every submission must have landed exactly once.
            for (let i = 0; i < clients.length; i++) {
                const stored = await formio.getSubmissions('customer', `&data.lastName=Client${i}`);
                expect(stored, `submission for client ${i} was lost or duplicated`).to.have.lengthOf(1);
                expect(stored[0].data.email).to.equal(`concurrent.client${i}@example.com`);
            }
        }
        finally {
            await Promise.all(clients.map((mcp) => mcp.close().catch(() => {})));
        }
    });
});
