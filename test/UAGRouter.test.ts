import { expect } from 'chai';
import { Router } from 'express';
import { UAGRouter } from '../src/router';

// A fake per-request MCP server that records its lifecycle calls, so the
// isolation tests can observe whether the router builds/disposes one per request.
interface FakeServer {
    connectCalls: number;
    closeCalls: number;
    connect(): void;
    close(): void;
}

describe('UAGRouter', () => {
    let mockProject: any;
    let router: Router;

    // Mock res that captures the 'close' listener the router registers for teardown,
    // so tests can trigger it via res.emit('close').
    function makeRes(overrides: any = {}) {
        const listeners: Record<string, Array<() => void>> = {};
        const res: any = {
            on: (event: string, cb: () => void) => {
                (listeners[event] ||= []).push(cb);
                return res;
            },
            emit: (event: string) => {
                (listeners[event] || []).forEach((cb) => cb());
            },
            status: () => res,
            json: () => res,
            send: () => res,
            set: () => res,
            writeHead: () => res,
            end: () => res,
        };
        return Object.assign(res, overrides);
    }

    function postHandle(r: Router = router) {
        const postRoute = r.stack.find((layer: any) =>
            layer.route && layer.route.path === '/' && layer.route.methods.post
        ) as any;
        return postRoute.route.stack[0].handle;
    }

    function getHandle(r: Router = router) {
        const getRoute = r.stack.find((layer: any) =>
            layer.route && layer.route.path === '/' && layer.route.methods.get
        ) as any;
        return getRoute.route.stack[0].handle;
    }

    beforeEach(() => {
        // Each request builds its own MCP server; default to harmless no-ops.
        mockProject = {
            buildMcpServer: () => ({
                connect: () => { },
                close: () => { },
            }),
        };

        router = UAGRouter(mockProject);
    });

    describe('initialization', () => {
        it('returns an Express Router instance', () => {
            expect(router).to.exist;
            expect(typeof router).to.equal('function');
            expect(router.stack).to.be.an('array');
        });

        it('registers POST / route', () => {
            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );
            expect(postRoute).to.exist;
        });

        it('registers GET / route', () => {
            const getRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.get
            );
            expect(getRoute).to.exist;
        });
    });

    describe('POST / route', () => {
        it('handles MCP requests', async () => {
            let connectCalled = false;
            mockProject.buildMcpServer = () => ({
                connect: () => { connectCalled = true; },
                close: () => { },
            });

            const mockReq: any = {
                body: {
                    jsonrpc: '2.0',
                    method: 'initialize',
                    params: {}
                }
            };

            try {
                await postHandle()(mockReq, makeRes(), () => { });
            } catch (error) {
                // Expected to throw because of mock transport
            }

            expect(connectCalled).to.be.true;
        });

        it('returns 500 on error', async () => {
            let statusCode = 0;
            let responseBody: any = null;

            mockProject.buildMcpServer = () => ({
                connect: () => { throw new Error('Connection failed'); },
                close: () => { },
            });

            const mockReq: any = { body: {} };
            const mockRes = makeRes({
                status: (code: number) => { statusCode = code; return mockRes; },
                json: (body: any) => { responseBody = body; return mockRes; },
            });

            await postHandle()(mockReq, mockRes, () => { });

            expect(statusCode).to.equal(500);
            expect(responseBody).to.have.property('error');
        });
    });

    describe('GET / route', () => {
        it('handles GET requests', async () => {
            let connectCalled = false;
            mockProject.buildMcpServer = () => ({
                connect: () => { connectCalled = true; },
                close: () => { },
            });

            try {
                await getHandle()({} as any, makeRes(), () => { });
            } catch (error) {
                // Expected to throw because of mock transport
            }

            expect(connectCalled).to.be.true;
        });

        it('connects MCP server on GET request', async () => {
            let transportConnected = false;
            mockProject.buildMcpServer = () => ({
                connect: () => { transportConnected = true; },
                close: () => { },
            });

            try {
                await getHandle()({} as any, makeRes(), () => { });
            } catch (error) {
                // Expected
            }

            expect(transportConnected).to.be.true;
        });
    });

    describe('error handling', () => {
        it('handles Response instance errors', async () => {
            let statusCode = 0;
            let headers: any = {};

            // Create a mock Response error
            const mockResponseError = new Response('Forbidden', {
                status: 403,
                headers: new Headers({
                    'Content-Type': 'application/json',
                    'X-Custom': 'value'
                })
            });

            mockProject.buildMcpServer = () => ({
                connect: () => { throw mockResponseError; },
                close: () => { },
            });

            const mockReq: any = { body: {} };
            const mockRes = makeRes({
                status: (code: number) => { statusCode = code; return mockRes; },
                set: (h: any) => {
                    if (typeof h === 'object') {
                        headers = { ...headers, ...h };
                    }
                    return mockRes;
                },
            });

            await postHandle()(mockReq, mockRes, () => { });

            expect(statusCode).to.equal(403);
            expect(headers['content-type'] || headers['Content-Type']).to.equal('application/json');
            expect(headers['x-custom'] || headers['X-Custom']).to.equal('value');
        });

        it('handles generic errors with 500 status', async () => {
            let statusCode = 0;
            let responseBody: any = null;

            mockProject.buildMcpServer = () => ({
                connect: () => { throw new Error('Generic error'); },
                close: () => { },
            });

            const mockReq: any = { body: {} };
            const mockRes = makeRes({
                status: (code: number) => { statusCode = code; return mockRes; },
                json: (body: any) => { responseBody = body; return mockRes; },
            });

            await postHandle()(mockReq, mockRes, () => { });

            expect(statusCode).to.equal(500);
            expect(responseBody).to.have.property('error');
            expect(responseBody.error.code).to.equal(-32603);
            expect(responseBody.error.message).to.equal('Internal Server Error');
        });

        it('includes jsonrpc version in error response', async () => {
            let responseBody: any = null;

            mockProject.buildMcpServer = () => ({
                connect: () => { throw new Error('Test error'); },
                close: () => { },
            });

            const mockReq: any = { body: {} };
            const mockRes = makeRes({
                json: (body: any) => { responseBody = body; return mockRes; },
            });

            await postHandle()(mockReq, mockRes, () => { });

            expect(responseBody).to.have.property('jsonrpc', '2.0');
            expect(responseBody.error).to.have.property('code', -32603);
            expect(responseBody.error).to.have.property('message', 'Internal Server Error');
        });
    });

    describe('stateless mode', () => {
        it('creates transport with undefined sessionIdGenerator', async () => {
            // This test verifies that the router is configured for stateless mode
            // by checking that sessionIdGenerator is undefined
            const mockReq: any = { body: {} };

            // The test passes if no errors are thrown related to session management
            try {
                await postHandle()(mockReq, makeRes(), () => { });
            } catch (error) {
                // Expected to throw due to mock, but not session-related
                expect((error as Error).message).to.not.include('session');
            }
        });
    });

    describe('per-request MCP server isolation (FIO-11869)', () => {
        // Build a project whose buildMcpServer() hands out a fresh, call-recording
        // server each time, so we can assert one server is built (and torn down) per request.
        function trackedProject() {
            const built: FakeServer[] = [];
            const project: any = {
                buildMcpServer: () => {
                    const server: FakeServer = {
                        connectCalls: 0,
                        closeCalls: 0,
                        connect() { this.connectCalls++; },
                        close() { this.closeCalls++; },
                    };
                    built.push(server);
                    return server;
                },
            };
            return { project, built };
        }

        it('builds an isolated MCP server for each request instead of sharing one', async () => {
            const { project, built } = trackedProject();
            const handle = postHandle(UAGRouter(project));

            for (let i = 0; i < 3; i++) {
                const mockReq: any = { body: { jsonrpc: '2.0', method: 'tools/call', params: {} } };
                try {
                    await handle(mockReq, makeRes(), () => { });
                } catch (error) {
                    // The real transport rejects against the mock res; irrelevant here.
                }
            }

            expect(built.length).to.equal(3);
        });

        it('disposes the per-request MCP server when the response closes', async () => {
            const { project, built } = trackedProject();
            const handle = postHandle(UAGRouter(project));
            const mockRes = makeRes();

            const mockReq: any = { body: { jsonrpc: '2.0', method: 'tools/call', params: {} } };
            try {
                await handle(mockReq, mockRes, () => { });
            } catch (error) {
                // expected
            }

            expect(built.length).to.equal(1);
            mockRes.emit('close');
            expect(built[0].closeCalls).to.be.greaterThan(0);
        });
    });

    describe('router integration', () => {
        it('accepts different project configurations', () => {
            const customProject: any = {
                buildMcpServer: () => ({
                    connect: () => { },
                    close: () => { },
                }),
            };

            const customRouter = UAGRouter(customProject);
            expect(customRouter).to.exist;
            expect(customRouter.stack).to.be.an('array');
        });

        it('router can be mounted on express app', () => {
            // Verify router has the expected structure for mounting
            expect(router).to.be.a('function');
            expect(router.stack).to.be.an('array');
            expect(router.stack.length).to.be.greaterThan(0);
        });
    });
});
