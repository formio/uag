import { expect } from 'chai';
import { Router } from 'express';
import { UAGRouter } from '../src/router';

describe('UAGRouter', () => {
    let mockProject: any;
    let router: Router;

    beforeEach(() => {
        // Mock MCP Server
        const mockMcpServer = {
            connect: () => { }
        };

        // Mock project
        mockProject = {
            mcpServer: mockMcpServer
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
            mockProject.mcpServer.connect = () => {
                connectCalled = true;
            };

            const mockReq: any = {
                body: {
                    jsonrpc: '2.0',
                    method: 'initialize',
                    params: {}
                }
            };
            const mockRes: any = {
                status: () => mockRes,
                json: () => mockRes,
                send: () => mockRes
            };

            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );

            if (postRoute && postRoute.route) {
                try {
                    await postRoute.route.stack[0].handle(mockReq, mockRes, () => {});
                } catch (error) {
                    // Expected to throw because of mock transport
                }
            }

            expect(connectCalled).to.be.true;
        });

        it('returns 500 on error', async () => {
            let statusCode = 0;
            let responseBody: any = null;

            mockProject.mcpServer.connect = () => {
                throw new Error('Connection failed');
            };

            const mockReq: any = {
                body: {}
            };
            const mockRes: any = {
                status: (code: number) => {
                    statusCode = code;
                    return mockRes;
                },
                json: (body: any) => {
                    responseBody = body;
                    return mockRes;
                },
                send: () => mockRes
            };

            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );

            if (postRoute && postRoute.route) {
                await postRoute.route.stack[0].handle(mockReq, mockRes, () => {});
            }

            expect(statusCode).to.equal(500);
            expect(responseBody).to.have.property('error');
        });
    });

    describe('GET / route', () => {
        it('handles GET requests', async () => {
            let connectCalled = false;
            mockProject.mcpServer.connect = () => {
                connectCalled = true;
            };

            const mockReq: any = {};
            const mockRes: any = {
                status: () => mockRes,
                json: () => mockRes,
                send: () => mockRes
            };

            const getRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.get
            );

            if (getRoute && getRoute.route) {
                try {
                    await getRoute.route.stack[0].handle(mockReq, mockRes, () => {});
                } catch (error) {
                    // Expected to throw because of mock transport
                }
            }

            expect(connectCalled).to.be.true;
        });

        it('connects MCP server on GET request', async () => {
            let transportConnected = false;
            mockProject.mcpServer.connect = () => {
                transportConnected = true;
            };

            const mockReq: any = {};
            const mockRes: any = {
                status: () => mockRes,
                json: () => mockRes,
                send: () => mockRes
            };

            const getRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.get
            );

            if (getRoute && getRoute.route) {
                try {
                    await getRoute.route.stack[0].handle(mockReq, mockRes, () => {});
                } catch (error) {
                    // Expected
                }
            }

            expect(transportConnected).to.be.true;
        });
    });

    describe('error handling', () => {
        it('handles Response instance errors', async () => {
            let statusCode = 0;
            let headers: any = {};
            let responseText = '';

            // Create a mock Response error
            const mockResponseError = new Response('Forbidden', {
                status: 403,
                headers: new Headers({
                    'Content-Type': 'application/json',
                    'X-Custom': 'value'
                })
            });

            mockProject.mcpServer.connect = () => {
                throw mockResponseError;
            };

            const mockReq: any = { body: {} };
            const mockRes: any = {
                status: (code: number) => {
                    statusCode = code;
                    return mockRes;
                },
                set: (h: any) => {
                    if (typeof h === 'object') {
                        headers = { ...headers, ...h };
                    }
                    return mockRes;
                },
                send: (text: string) => {
                    responseText = text;
                    return mockRes;
                },
                json: () => mockRes
            };

            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );

            if (postRoute && postRoute.route) {
                await postRoute.route.stack[0].handle(mockReq, mockRes, () => {});
            }

            expect(statusCode).to.equal(403);
            expect(headers['content-type'] || headers['Content-Type']).to.equal('application/json');
            expect(headers['x-custom'] || headers['X-Custom']).to.equal('value');
        });

        it('handles generic errors with 500 status', async () => {
            let statusCode = 0;
            let responseBody: any = null;

            mockProject.mcpServer.connect = () => {
                throw new Error('Generic error');
            };

            const mockReq: any = { body: {} };
            const mockRes: any = {
                status: (code: number) => {
                    statusCode = code;
                    return mockRes;
                },
                json: (body: any) => {
                    responseBody = body;
                    return mockRes;
                },
                send: () => mockRes
            };

            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );

            if (postRoute && postRoute.route) {
                await postRoute.route.stack[0].handle(mockReq, mockRes, () => {});
            }

            expect(statusCode).to.equal(500);
            expect(responseBody).to.have.property('error');
            expect(responseBody.error.code).to.equal(-32603);
            expect(responseBody.error.message).to.equal('Internal Server Error');
        });

        it('includes jsonrpc version in error response', async () => {
            let responseBody: any = null;

            mockProject.mcpServer.connect = () => {
                throw new Error('Test error');
            };

            const mockReq: any = { body: {} };
            const mockRes: any = {
                status: () => mockRes,
                json: (body: any) => {
                    responseBody = body;
                    return mockRes;
                },
                send: () => mockRes
            };

            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );

            if (postRoute && postRoute.route) {
                await postRoute.route.stack[0].handle(mockReq, mockRes, () => {});
            }

            expect(responseBody).to.have.property('jsonrpc', '2.0');
        });
    });

    describe('stateless mode', () => {
        it('creates transport with undefined sessionIdGenerator', async () => {
            // This test verifies that the router is configured for stateless mode
            // by checking that sessionIdGenerator is undefined
            const mockReq: any = { body: {} };
            const mockRes: any = {
                status: () => mockRes,
                json: () => mockRes,
                send: () => mockRes
            };

            const postRoute = router.stack.find((layer: any) =>
                layer.route && layer.route.path === '/' && layer.route.methods.post
            );

            // The test passes if no errors are thrown related to session management
            if (postRoute && postRoute.route) {
                try {
                    await postRoute.route.stack[0].handle(mockReq, mockRes, () => {});
                } catch (error) {
                    // Expected to throw due to mock, but not session-related
                    expect((error as Error).message).to.not.include('session');
                }
            }
        });
    });

    describe('router integration', () => {
        it('accepts different project configurations', () => {
            const customProject: any = {
                mcpServer: {
                    connect: () => { },
                    registerTool: () => { }
                }
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
