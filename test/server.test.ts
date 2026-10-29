import { assert } from 'chai';
import { assertSingleCore, UAGServer } from '../src/index';

describe('UAGServer.router', () => {
  // Running the image with no PROJECT — or with an unreachable one — used to
  // crash with "Cannot read properties of undefined (reading 'uagRouter')",
  // which says nothing about what the operator got wrong.
  it('reports missing project configuration instead of a TypeError', async () => {
    const server = new UAGServer();
    // No project could be loaded, which is the state a misconfigured container
    // is in by the time router() runs.
    (server as unknown as { projectRouter?: { projects: Record<string, unknown> } }).projectRouter =
      { projects: {} };

    let message = '';
    try {
      await server.router();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    assert.notInclude(
      message,
      'uagRouter',
      'should not surface the internal TypeError to the operator'
    );
    assert.match(
      message,
      /PROJECT/,
      'should name the environment variable that needs to be set'
    );
  });
});

describe('UAGServer.extendRouter', () => {
  it('mounts the Agent API ahead of the project routes', async () => {
    const express = require('express');
    const request = require('supertest');
    const server = new UAGServer();
    const projectRoutes = express.Router();
    // Stands in for the project routes and the admin passthrough to Form.io.
    projectRoutes.use((req: any, res: any) => res.status(400).send('Invalid alias'));
    const project: any = {
      config: {},
      agentRouter: () => express.Router().get('/agent/capabilities', (req: any, res: any) => res.json({ ok: true })),
      uagRouter: () => express.Router()
    };
    (server as any).initializing = Promise.resolve();
    (server as any).projectRouter = { router: async () => projectRoutes, projects: { only: project } };
    const app = express();
    app.use(await server.router());
    const res = await request(app).get('/agent/capabilities').set('x-admin-key', 'anything');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.include(String(res.headers['access-control-expose-headers'] || ''), 'X-Request-Id');
  });
});

describe('UAGServer license', () => {
  it('reports as a uagServer, and runs on the "uag" feature, not the appserver\'s', () => {
    const server = new UAGServer();
    assert.equal((server as any).config.licenseType, 'uagServer');
    assert.equal((server as any).config.licenseFeature, 'uag');
  });
});

describe('assertSingleCore', () => {
  const core = { Formflow: {}, ProjectInterface: class {} };

  it('accepts one copy of core at 2.24.1 or later', () => {
    assertSingleCore(core, core, '2.24.1');
    assertSingleCore(core, core, '2.25.0');
    assertSingleCore(core, core, '3.0.0');
  });

  it('refuses an older core, naming the version', () => {
    assert.throws(() => assertSingleCore(core, core, '2.22.0'), /2\.24\.1 or later; 2\.22\.0 is installed/);
    assert.throws(() => assertSingleCore(core, core, '2.23.1'), /2\.24\.1 or later; 2\.23\.1 is installed/);
    assert.throws(() => assertSingleCore(core, core, '2.24.0'), /2\.24\.1 or later; 2\.24\.0 is installed/);
  });

  it('refuses a second copy of core under @formio/appserver', () => {
    assert.throws(() => assertSingleCore(core, { ProjectInterface: class {} }, '2.24.1'), /Two copies of @formio\/appserver-core/);
  });
});

describe('trustProxySetting', () => {
  const { trustProxySetting } = require('../src/config');
  it('reads TRUST_PROXY as Express\'s trust proxy setting', () => {
    assert.equal(trustProxySetting(undefined), undefined);
    assert.equal(trustProxySetting(''), undefined);
    assert.equal(trustProxySetting('true'), true);
    assert.equal(trustProxySetting('false'), false);
    assert.equal(trustProxySetting('2'), 2);
    assert.equal(trustProxySetting('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
  });
});
