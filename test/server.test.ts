import { assert } from 'chai';
import fs from 'fs';
import path from 'path';
import { assertNodeSnapshotDisabled, assertSingleCore, UAGServer } from '../src/index';

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

describe('assertNodeSnapshotDisabled', () => {
  it('accepts --no-node-snapshot on the command line or in NODE_OPTIONS', () => {
    assertNodeSnapshotDisabled();
    assertNodeSnapshotDisabled(['--no-node-snapshot'], '');
    assertNodeSnapshotDisabled([], '--max-old-space-size=4096 --no-node-snapshot');
  });

  it('refuses to start without it, saying how to start Node', () => {
    assert.throws(() => assertNodeSnapshotDisabled([], ''), /needs Node started with --no-node-snapshot.*NODE_OPTIONS=--no-node-snapshot/);
    assert.throws(() => assertNodeSnapshotDisabled(['--inspect'], '--no-node-snapshotx'), /--no-node-snapshot/);
  });
});

describe('UAGServer settings that fail far from their cause', () => {
  const saved = { ...process.env };
  let warnings: string[] = [];
  const original = console.warn;
  beforeEach(() => {
    warnings = [];
    console.warn = (...args: any[]) => { warnings.push(args.join(' ')); };
    for (const name of ['JWT_SECRET', 'MAX_BODY_SIZE', 'LOGIN_FORM', 'MCP_OAUTH', 'PROJECT']) delete process.env[name];
  });
  afterEach(() => {
    console.warn = original;
    process.env = { ...saved };
  });

  it('warns when JWT_SECRET is not set, and not when it is', () => {
    new UAGServer({ project: 'http://formio:3001' } as any);
    assert.match(warnings.join('\n'), /JWT_SECRET is not set/);
    warnings = [];
    process.env.JWT_SECRET = 'a-secret';
    new UAGServer({ project: 'http://formio:3001' } as any);
    new UAGServer({ project: 'http://formio:3001', auth: { secret: 'given' } } as any);
    assert.notMatch(warnings.join('\n'), /JWT_SECRET/);
  });

  it('parses bodies up to 16mb by default, as Form.io does, and MAX_BODY_SIZE changes it', () => {
    assert.equal((new UAGServer({ project: 'http://formio:3001' } as any) as any).config.maxBodySize, '16mb');
    process.env.MAX_BODY_SIZE = '50mb';
    assert.equal((new UAGServer({ project: 'http://formio:3001' } as any) as any).config.maxBodySize, '50mb');
  });

  it('warns when remote sign-in would send browsers to a container address', () => {
    process.env.JWT_SECRET = 'a-secret';
    process.env.MCP_OAUTH = 'true';
    new UAGServer({ project: 'http://formio:3001' } as any);
    assert.match(warnings.join('\n'), /LOGIN_FORM is not set/);
    warnings = [];
    for (const project of ['https://forms.example.com/myproject', 'http://localhost:3001', 'http://formio.local:3001']) {
      new UAGServer({ project } as any);
    }
    process.env.LOGIN_FORM = 'https://forms.example.com/user/login';
    new UAGServer({ project: 'http://formio:3001' } as any);
    delete process.env.LOGIN_FORM;
    delete process.env.MCP_OAUTH;
    new UAGServer({ project: 'http://formio:3001' } as any);
    assert.notMatch(warnings.join('\n'), /LOGIN_FORM/);
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
