import { expect } from 'chai';
import { Router } from 'express';

describe('UAGRouter', () => {
  let UAGRouter: any;
  let project: any;
  let mockTransport: any;
  let mockMcpServer: any;

  beforeEach(() => {
    // Mock the MCP SDK dependencies to avoid import errors
    const mockStreamableHTTPServerTransport = class {
      constructor(options: any) {
        Object.assign(this, mockTransport);
      }
    };

    // Mock the isInitializeRequest function
    const mockIsInitializeRequest = (body: any) => {
      return body && body.method === 'initialize';
    };

    // Dynamically require the router with mocked dependencies
    const Module = require('module');
    const originalRequire = Module.prototype.require;

    Module.prototype.require = function (id: string) {
      if (id === '@modelcontextprotocol/sdk/server/streamableHttp') {
        return { StreamableHTTPServerTransport: mockStreamableHTTPServerTransport };
      }
      if (id === '@modelcontextprotocol/sdk/types') {
        return { isInitializeRequest: mockIsInitializeRequest };
      }
      return originalRequire.apply(this, arguments);
    };

    // Clear the require cache to force re-require with mocks
    delete require.cache[require.resolve('../src/router')];
    const routerModule = require('../src/router');
    UAGRouter = routerModule.UAGRouter;

    // Restore original require
    Module.prototype.require = originalRequire;

    // Setup mock transport
    mockTransport = {
      handleRequest: async (req: any, res: any, body?: any) => {
        // Default mock implementation
        return;
      }
    };

    // Setup mock MCP server
    mockMcpServer = {
      connect: (transport: any) => {
        // Mock connect
      }
    };

    // Setup mock project
    project = {
      mcpServer: mockMcpServer
    };
  });

  it('returns an Express Router instance', () => {
    const router = UAGRouter(project);
    expect(router).to.exist;
    expect(typeof router).to.equal('function');
    // Express routers are functions with stack property
    expect(router.stack).to.be.an('array');
  });

  it('registers POST / route', () => {
    const router = UAGRouter(project);
    const postRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.post
    );
    expect(postRoute).to.exist;
  });

  it('registers GET / route', () => {
    const router = UAGRouter(project);
    const getRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.get
    );
    expect(getRoute).to.exist;
  });

  it('POST / connects MCP server to transport', async () => {
    let connectCalled = false;
    project.mcpServer.connect = (transport: any) => {
      connectCalled = true;
    };

    const router = UAGRouter(project);
    const mockReq = { body: {} };
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
      send: () => mockRes
    };

    mockTransport.handleRequest = async () => {};

    const postRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.post
    );

    await postRoute.route.stack[0].handle(mockReq, mockRes);
    expect(connectCalled).to.be.true;
  });

  it('POST / calls transport.handleRequest with request body', async () => {
    let handleRequestCalled = false;
    let receivedBody: any = null;

    mockTransport.handleRequest = async (req: any, res: any, body: any) => {
      handleRequestCalled = true;
      receivedBody = body;
    };

    const router = UAGRouter(project);
    const mockReq = { body: { method: 'test', params: {} } };
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
      send: () => mockRes
    };

    const postRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.post
    );

    await postRoute.route.stack[0].handle(mockReq, mockRes);
    expect(handleRequestCalled).to.be.true;
    expect(receivedBody).to.deep.equal({ method: 'test', params: {} });
  });

  it('GET / connects MCP server to transport', async () => {
    let connectCalled = false;
    project.mcpServer.connect = (transport: any) => {
      connectCalled = true;
    };

    const router = UAGRouter(project);
    const mockReq = {};
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
      send: () => mockRes
    };

    mockTransport.handleRequest = async () => {};

    const getRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.get
    );

    await getRoute.route.stack[0].handle(mockReq, mockRes);
    expect(connectCalled).to.be.true;
  });

  it('GET / calls transport.handleRequest without body', async () => {
    let handleRequestCalled = false;
    let bodyArgument: any = 'not-called';

    mockTransport.handleRequest = async (req: any, res: any, body?: any) => {
      handleRequestCalled = true;
      bodyArgument = body;
    };

    const router = UAGRouter(project);
    const mockReq = {};
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
      send: () => mockRes
    };

    const getRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.get
    );

    await getRoute.route.stack[0].handle(mockReq, mockRes);
    expect(handleRequestCalled).to.be.true;
    expect(bodyArgument).to.be.undefined;
  });

  it('POST / handles errors by returning 500 JSON-RPC error', async () => {
    mockTransport.handleRequest = async () => {
      throw new Error('Transport error');
    };

    const router = UAGRouter(project);
    const mockReq = { body: {} };
    let statusCode = 0;
    let jsonResponse: any = null;

    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      json: (data: any) => {
        jsonResponse = data;
        return mockRes;
      },
      send: () => mockRes
    };

    const postRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.post
    );

    await postRoute.route.stack[0].handle(mockReq, mockRes);
    expect(statusCode).to.equal(500);
    expect(jsonResponse).to.have.property('error');
    expect(jsonResponse.error.code).to.equal(-32603);
    expect(jsonResponse.error.message).to.equal('Internal Server Error');
    expect(jsonResponse.jsonrpc).to.equal('2.0');
  });

  it('GET / handles errors by returning 500 JSON-RPC error', async () => {
    mockTransport.handleRequest = async () => {
      throw new Error('GET error');
    };

    const router = UAGRouter(project);
    const mockReq = {};
    let statusCode = 0;
    let jsonResponse: any = null;

    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      json: (data: any) => {
        jsonResponse = data;
        return mockRes;
      },
      send: () => mockRes
    };

    const getRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.get
    );

    await getRoute.route.stack[0].handle(mockReq, mockRes);
    expect(statusCode).to.equal(500);
    expect(jsonResponse).to.have.property('error');
    expect(jsonResponse.error.code).to.equal(-32603);
  });

  it('handles Response instance errors with status and headers', async () => {
    // Create a mock Response error
    const responseError: any = {
      status: 403,
      statusText: 'Forbidden',
      headers: new Map([
        ['Content-Type', 'application/json'],
        ['X-Custom-Header', 'test']
      ])
    };
    // Make it look like a Response instance
    Object.setPrototypeOf(responseError, Response.prototype);

    mockTransport.handleRequest = async () => {
      throw responseError;
    };

    const router = UAGRouter(project);
    const mockReq = { body: {} };
    let statusCode = 0;
    let headers: any = {};
    let sendData: any = null;

    const mockRes = {
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      set: (hdrs: any) => {
        headers = hdrs;
        return mockRes;
      },
      send: (data: any) => {
        sendData = data;
        return mockRes;
      },
      json: () => mockRes
    };

    const postRoute = router.stack.find((layer: any) => 
      layer.route && layer.route.path === '/' && layer.route.methods.post
    );

    await postRoute.route.stack[0].handle(mockReq, mockRes);
    expect(statusCode).to.equal(403);
    expect(headers['Content-Type']).to.equal('application/json');
    expect(headers['X-Custom-Header']).to.equal('test');
    expect(sendData).to.equal('Forbidden');
  });
});
