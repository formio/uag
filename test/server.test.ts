import { assert } from 'chai';
import fs from 'fs';
import path from 'path';
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
  it('accepts the core @formio/appserver loads at 2.25.1 or later', () => {
    assertSingleCore();
    assertSingleCore('2.25.1');
    assertSingleCore('2.25.3');
    assertSingleCore('2.26.0');
    assertSingleCore('3.0.0');
  });

  it('refuses an older core, naming the version and the package to upgrade', () => {
    assert.throws(() => assertSingleCore('2.22.0'), /2\.25\.1 or later, through @formio\/appserver; 2\.22\.0 is installed\. Upgrade @formio\/appserver\./);
    assert.throws(() => assertSingleCore('2.23.1'), /2\.23\.1 is installed/);
    assert.throws(() => assertSingleCore('2.24.0'), /2\.24\.0 is installed/);
    assert.throws(() => assertSingleCore('2.24.3'), /2\.24\.3 is installed/);
    assert.throws(() => assertSingleCore('2.25.0'), /2\.25\.0 is installed/);
  });

  it('holds because the UAG reaches core only through @formio/appserver', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    assert.notProperty(pkg.dependencies, '@formio/appserver-core');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
    const direct = files(path.resolve(__dirname, '../src'))
      .filter((file) => /(from\s+|require\()['"]@formio\/appserver-core['"/]/.test(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(direct, []);
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
