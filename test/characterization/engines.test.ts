/**
 * Pinning tests: engines.
 *
 * Records, as JSON fixtures that change only on purpose (UPDATE_FIXTURES=1):
 * - which engine instances each configuration loads (UAG_ENGINES with type
 *   names, package names, UAG_ENGINE_PATH, `:remote`, several instances of one
 *   type, `engines` in the configuration, `engineTypes`), and the message a
 *   misconfiguration stops startup with;
 * - the engine server's handshake (GET /v1/engines);
 * - GET /agent/capabilities, and which instance answers when routing names
 *   instances.
 * Package versions are replaced with a placeholder: they change every release.
 */
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { expect } from 'chai';
import { defineEngine } from '@formio/uag-sdk';
import { loadUAGEngines } from '../../src/agent/engines';
import { requireTestLicense } from '../agent/fixtures';
import { matchesFixture, withoutVersions } from './fixture';
import { ADMIN_KEY, start, Started } from './harness';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createEngineServer } = require('../../packages/engine-server');

const SERVER_KEY = 'pinning-engine-server-key-0123456789';
const ENGINE_PATH = path.join(__dirname, 'engine-path');

const mine = defineEngine({
    type: 'engine',
    name: 'mine',
    kinds: ['agent'],
    apiVersion: 1,
    settings: { model: { default: 'mine-1' } },
    create: ({ name, settings }) => ({ name, kind: 'agent', model: settings.model, extract: async () => ({ model: settings.model, values: {} }) })
});

/** What a configuration loads: each instance, or the message startup stops with. */
async function loaded(config: any, env: Record<string, string>) {
    try {
        const registry = await loadUAGEngines(config, env);
        return withoutVersions(registry.all.map((engine: any) => ({
            name: engine.name,
            kind: engine.kind,
            model: engine.model,
            toolUse: engine.toolUse ?? null,
            maxOptions: engine.maxOptions ?? null,
            source: registry.source(engine)
        })));
    }
    catch (err: any) {
        return { error: err.message.replaceAll(ENGINE_PATH, '<engine-path>') };
    }
}

describe('Pinning: engines', function () {
    this.timeout(30000);

    let engineServer: http.Server | undefined;
    afterEach(async () => {
        if (engineServer) {
            engineServer.closeAllConnections();
            await new Promise((resolve) => engineServer!.close(resolve));
            engineServer = undefined;
        }
    });

    /** A real engine server, serving the jev and Claude engines (no model is called). */
    async function startEngineServer() {
        const { app } = await createEngineServer({
            env: { UAG_ENGINE_SERVER_KEY: SERVER_KEY, UAG_ENGINES: 'jev,claude', TYPESAFE_API_KEY: 'ts-pinning', CLAUDE_API_KEY: 'sk-ant-pinning' }
        });
        engineServer = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        return `http://127.0.0.1:${(engineServer!.address() as AddressInfo).port}`;
    }

    it('configuration to loaded instances', async () => {
        const matrix: Record<string, any> = {
            'nothing named': await loaded({}, {}),
            'UAG_ENGINES empty': await loaded({}, { UAG_ENGINES: '' }),
            'built-in stubs by type name': await loaded({}, { UAG_ENGINES: 'stub-decision,stub-agent' }),
            'several instances of one type': await loaded({}, { UAG_ENGINES: 'triage:stub-decision,check:stub-decision' }),
            'configuration over UAG_ENGINES': await loaded({ engines: ['stub-agent'] }, { UAG_ENGINES: 'stub-decision' }),
            'installed packages by type name': await loaded({}, { UAG_ENGINES: 'jev,next:jev', TYPESAFE_API_KEY: 'ts-pinning', UAG_ENGINE_NEXT_MODEL: 'jev-1.14.0' }),
            'installed package by package name': await loaded({}, { UAG_ENGINES: 'triage:@formio/uag-jev', TYPESAFE_API_KEY: 'ts-pinning' }),
            'UAG_ENGINE_PATH': await loaded({}, { UAG_ENGINES: 'pinned,other:pinned', UAG_ENGINE_PATH: ENGINE_PATH, UAG_ENGINE_OTHER_MODEL: 'pinned-2' }),
            'engine type in the configuration': await loaded({ engines: [{ name: 'own', type: mine, options: { model: 'mine-2' } }] }, {}),
            'engineTypes before built-in types and packages': await loaded({ engineTypes: { mine, jev: mine } }, { UAG_ENGINES: 'mine,jev' }),
            'misconfigured: missing required setting': await loaded({}, { UAG_ENGINES: 'fast:claude' }),
            'misconfigured: unknown type': await loaded({}, { UAG_ENGINES: 'mistral' }),
            'misconfigured: duplicate name': await loaded({}, { UAG_ENGINES: 'stub-agent,stub-agent:stub-decision' }),
            'misconfigured: relative UAG_ENGINE_PATH': await loaded({}, { UAG_ENGINES: 'pinned', UAG_ENGINE_PATH: 'relative/dir' })
        };
        const url = await startEngineServer();
        matrix[':remote instances'] = await loaded({ retries: 1, retryDelay: 5 }, {
            UAG_ENGINES: 'jev:remote,claude:remote',
            UAG_ENGINE_JEV_URL: url, UAG_ENGINE_JEV_KEY: SERVER_KEY,
            UAG_ENGINE_CLAUDE_URL: url, UAG_ENGINE_CLAUDE_KEY: SERVER_KEY
        });
        matchesFixture('engines-configuration', matrix);
    });

    it('engine server handshake', async () => {
        const url = await startEngineServer();
        const response = await fetch(`${url}/v1/engines`, { headers: { Authorization: `Bearer ${SERVER_KEY}` } });
        const refused = await fetch(`${url}/v1/engines`);
        matchesFixture('engines-handshake', withoutVersions({
            status: response.status,
            body: await response.json(),
            withoutKey: { status: refused.status, body: await refused.json().catch(() => null) }
        }));
    });

    describe('through the UAG', () => {
        before(function () { requireTestLicense(this); });

        let started: Started | undefined;
        afterEach(async () => { await started?.stop(); started = undefined; });

        it('capabilities, and routing by instance name', async () => {
            started = await start({
                config: {
                    engines: ['triage:stub-decision', 'check:stub-decision', 'stub-agent'],
                    routing: { decision: ['check', 'triage'] }
                }
            });
            const capabilities = await started.request().get('/agent/capabilities').set('x-admin-key', ADMIN_KEY);
            const decide = await started.request().post('/contact/agent/decide').set('x-admin-key', ADMIN_KEY)
                .send({ task: 'triage', data: { notes: 'Urgent: the order never arrived.' } });
            expect(decide.status, decide.text).to.equal(200);
            const { requestId, ...decided } = decide.body;
            matchesFixture('engines-capabilities-routing', withoutVersions({
                capabilities: { status: capabilities.status, body: { ...capabilities.body, requestId: undefined } },
                decide: { ...decided, engines: (decided.engines || []).map(({ latencyMs, ...engine }: any) => engine) }
            }));
        });
    });
});
