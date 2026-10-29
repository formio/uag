import { expect } from 'chai';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnNode } from './helpers/proc.mjs';
import { startStack, ADMIN_KEY, JWT_SECRET, FORMIO_URL, requireLicense, E2E_LICENSE } from './helpers/stack.mjs';
import { api, stream } from './helpers/agent.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Layer 1: how the UAG chooses engines, and what an operator sees when engines
 * fail, are slow, are over their limits, or are misconfigured. The stack runs
 * with a decision engine that is down, one that is too slow for its timeout and
 * one that works, an agent engine that takes 1.5 seconds, an agent engine that
 * is down, one with a small rate limit, and caller rate limits.
 */
describe('Layer 1: Agent API — engine routing and operations', function () {
    this.timeout(300000);

    const config = {
        routing: {
            decision: ['e2e-down', 'e2e-slow', 'e2e-decision'],
            value: ['e2e-slow-agent'],
            timeouts: { 'e2e-slow': 300 },
        },
        agentApi: {
            rateLimits: {
                caller: { decide: { limit: 2, windowMs: 60000 } },
                engine: { 'e2e-run-agent': { limit: 2, windowMs: 60000 } },
            },
        },
    };

    let stack;

    before(async function () {
        requireLicense(this);
        stack = await startStack({
            uagEnv: {
                UAG_ENGINES: 'e2e-down,e2e-slow,e2e-decision,e2e-agent,e2e-slow-agent,e2e-down-agent,e2e-run-agent',
                E2E_UAG_CONFIG: JSON.stringify(config),
                E2E_SLOW_MS: '2000',
                E2E_SLOW_AGENT_MS: '1500',
            },
        });
    });

    after(async function () {
        if (stack) await stack.stop();
    });

    const notes = 'My bike was stolen at the Riverside Mall.';

    describe('one extraction across failing, slow and working engines', function () {
        let result;
        let done;

        before(async function () {
            result = await stream('/routing/agent/extract', { data: { notes } });
            done = result.events.at(-1).data;
        });

        it('passes over an engine that is down and one that times out, and says why', function () {
            expect(done.fields.kind).to.include({ status: 'confident', value: 'theft', engine: 'e2e-decision', calibrated: true });
            const decision = result.events.find((e) => e.event === 'result' && e.data.engine === 'e2e-decision').data;
            expect(decision.attempts.map((a) => a.engine)).to.deep.equal(['e2e-down', 'e2e-slow']);
            // An engine's own error can carry provider details, so callers get a
            // pointer to the logs instead; the UAG's own timeout message is shown.
            expect(decision.attempts[0].error).to.match(/^the engine failed \(see the logs for request /);
            expect(decision.attempts[1].error).to.include('did not answer within 300ms');
            // The slow engine was abandoned at its timeout, not waited for.
            expect(decision.latencyMs).to.be.below(1500);
        });

        it('falls back from a decision engine to an agent engine for one field, uncalibrated', function () {
            expect(done.fields.kindFallback).to.include({ status: 'suggested', value: 'theft', engine: 'e2e-agent', calibrated: false });
            expect(done.engines.some((e) => e.engine === 'e2e-agent' && e.attempts.some((a) => a.engine === 'e2e-down'))).to.equal(true);
        });

        it('streams each engine\'s results as they finish, decisions well before the slow agent', function () {
            const at = (engine) => result.events.find((e) => e.event === 'result' && e.data.engine === engine).at;
            expect(done.fields.location).to.include({ value: 'Riverside Mall', engine: 'e2e-slow-agent' });
            expect(at('e2e-decision')).to.be.below(at('e2e-slow-agent') - 800);
            expect(at('e2e-agent')).to.be.below(at('e2e-slow-agent') - 800);
            expect(result.events.at(-1).event).to.equal('done');
        });

        it('returns the request id in the header and the payload', function () {
            expect(result.headers.get('x-request-id')).to.equal(done.requestId);
        });
    });

    it('reports which operations can run, from the routing configuration', async function () {
        const { body } = await api('/agent/capabilities', { method: 'GET' });
        expect(body.operations.decide.engines).to.deep.equal(['e2e-down', 'e2e-slow', 'e2e-decision']);
        expect(body.operations.generate.engines).to.deep.equal(['e2e-slow-agent']);
        expect(body.operations).to.not.have.property('provide');
    });

    it('runs a field on the next agent engine when the first fails, and names every engine when none can', async function () {
        const generate = () => api('/routing/agent/generate', { body: { task: 'route', data: { notes: 'Case RT-7: my bike was stolen at the Riverside Mall.' } } });
        const first = await generate();
        expect(first.status).to.equal(200);
        expect(first.body.fields.reference).to.include({ status: 'suggested', value: 'RT-7', engine: 'e2e-run-agent' });
        const group = first.body.engines.find((e) => e.engine === 'e2e-run-agent');
        expect(group.attempts.map((a) => a.engine)).to.deep.equal(['e2e-down-agent']);
        expect((await generate()).body.fields.reference.status).to.equal('suggested');
        // e2e-run-agent allows two calls a minute; the third finds no engine.
        const third = await generate();
        expect(third.status).to.equal(200);
        expect(third.body.fields.reference.status).to.equal('missing');
        expect(third.body.fields.reference.reason).to.include('e2e-down-agent').and.to.include('e2e-run-agent (Rate limit exceeded');
    });

    it('limits each caller per operation and says when to retry', async function () {
        const decide = () => api('/routing/agent/decide', { body: { data: { notes } } });
        expect((await decide()).status).to.equal(200);
        expect((await decide()).status).to.equal(200);
        const limited = await decide();
        expect(limited.status).to.equal(429);
        expect(Number(limited.headers.get('retry-after'))).to.be.within(1, 60);
        expect(limited.body.error).to.include('Rate limit exceeded for decide');
        // Other operations have their own allowance.
        expect((await api('/agent/capabilities', { method: 'GET' })).status).to.equal(200);
    });

    describe('startup', function () {
        let port = 3220;

        /** Start another UAG against the same Form.io and wait for it to listen or exit. */
        async function boot(env) {
            const uag = spawnNode(path.join(here, 'helpers/uagEntry.cjs'), {
                cwd: path.resolve(here, '../..'),
                env: {
                    PORT: String(++port),
                    PROJECT: FORMIO_URL.replace('127.0.0.1', 'localhost'),
                    UAG_LICENSE: E2E_LICENSE,
                    ADMIN_KEY,
                    JWT_SECRET,
                    PROJECT_TTL: '0',
                    DEBUG: '',
                    UAG_ENGINES: '',
                    E2E_UAG_CONFIG: '',
                    ...env,
                },
            });
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
                if (uag.child.exitCode !== null) return { uag, exitCode: uag.child.exitCode, output: uag.getOutput(), url: null };
                if (uag.getOutput().includes('running on port')) return { uag, exitCode: null, output: uag.getOutput(), url: `http://127.0.0.1:${port}` };
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            await uag.kill();
            throw new Error(`The UAG neither started nor exited: ${uag.getOutput()}`);
        }

        it('refuses to start with an engine type nothing provides, and lists the ones that are available', async function () {
            const { exitCode, output } = await boot({ UAG_ENGINES: 'e2e-decision,e2e-desicion' });
            expect(exitCode).to.equal(1);
            expect(output).to.include('No engine type "e2e-desicion" is installed').and.include('"@formio/uag-e2e-desicion"');
            expect(output).to.include('Types available without installing: remote, stub-decision, stub-agent, e2e-decision, e2e-agent');
        });

        it('refuses to start when an enabled engine is missing a setting, naming the setting', async function () {
            const remote = await boot({ UAG_ENGINES: 'remote' });
            expect(remote.exitCode).to.equal(1);
            expect(remote.output).to.include('The "remote" engine (type "remote") needs its url setting: set UAG_ENGINE_REMOTE_URL.');

            const claude = await boot({ UAG_ENGINES: 'claude', CLAUDE_API_KEY: '', ANTHROPIC_API_KEY: '' });
            expect(claude.exitCode).to.equal(1);
            expect(claude.output).to.include('The "claude" engine (type "claude") needs its apiKey setting: set UAG_ENGINE_CLAUDE_API_KEY, CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
        });

        it('serves no Agent API operations when no engines are enabled, leaving everything else as it was', async function () {
            const { uag, url } = await boot({});
            try {
                const headers = { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' };
                const capabilities = await (await fetch(`${url}/agent/capabilities`, { headers })).json();
                expect(capabilities.engines).to.deep.equal([]);
                expect(Object.values(capabilities.operations).every((operation) => !operation.available)).to.equal(true);
                const extract = await fetch(`${url}/claim/agent/extract`, { method: 'POST', headers, body: JSON.stringify({ data: { lossDescription: 'stolen' } }) });
                expect(extract.status).to.equal(503);
                const generate = await fetch(`${url}/application/agent/generate`, { method: 'POST', headers, body: JSON.stringify({ task: 'application', data: {} }) });
                expect(generate.status).to.equal(503);
                expect((await generate.json()).error).to.include('UAG_ENGINES');
                // The opt-in stub engines are registered but not enabled by default.
                expect(capabilities.engines.map((e) => e.name)).to.not.include('stub-decision');
            }
            finally {
                await uag.kill();
            }
        });
    });
});
