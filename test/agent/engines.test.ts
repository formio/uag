import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';
import { defineEngine } from '@formio/uag-sdk';
import { loadUAGEngines } from '../../src/agent/engines';

const mine = defineEngine({
    type: 'mine',
    kinds: ['agent'],
    apiVersion: 1,
    settings: { model: { default: 'mine-1' } },
    create: ({ name, settings }) => ({ name, kind: 'agent', model: settings.model, extract: async () => ({ model: settings.model, values: {} }) }),
});

async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    }
    catch (err: any) {
        return err.message;
    }
    throw new Error('expected loading to fail');
}

const names = (registry: any) => registry.all.map((engine: any) => [engine.name, engine.kind]);

describe('Engine loading', () => {
    it('enables no engine when none is named, so existing deployments start unchanged', async () => {
        expect((await loadUAGEngines({}, {})).empty).to.equal(true);
        expect((await loadUAGEngines({}, { UAG_ENGINES: '' })).empty).to.equal(true);
    });

    it('enables the built-in stub engines by bare name', async () => {
        expect(names(await loadUAGEngines({}, { UAG_ENGINES: 'stub-decision,stub-agent' })))
            .to.deep.equal([['stub-decision', 'decision'], ['stub-agent', 'agent']]);
    });

    it('enables several instances of one type with name:type', async () => {
        expect(names(await loadUAGEngines({}, { UAG_ENGINES: 'triage:stub-decision,check:stub-decision' })))
            .to.deep.equal([['triage', 'decision'], ['check', 'decision']]);
    });

    it('takes the configuration over UAG_ENGINES', async () => {
        expect(names(await loadUAGEngines({ engines: ['stub-agent'] }, { UAG_ENGINES: 'stub-decision' }))).to.deep.equal([['stub-agent', 'agent']]);
    });

    it('loads an installed engine package by its type name, with its package and version', async () => {
        const registry = await loadUAGEngines({}, { UAG_ENGINES: 'jev,next:jev', TYPESAFE_API_KEY: 'ts-test', UAG_ENGINE_NEXT_MODEL: 'jev-1.14.0' });
        expect(registry.all.map((engine) => [engine.name, engine.model])).to.deep.equal([['jev', 'jev-1.13.0'], ['next', 'jev-1.14.0']]);
        const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'engines', 'jev', 'package.json'), 'utf8'));
        expect(registry.source(registry.get('next')!)).to.deep.equal({ type: 'jev', package: '@formio/uag-jev', version: pkg.version });
    });

    it('accepts an engine type embedded in the configuration', async () => {
        const registry = await loadUAGEngines({ engines: [{ name: 'own', type: mine, options: { model: 'mine-2' } }] }, {});
        expect(registry.get('own')?.model).to.equal('mine-2');
        expect(registry.source(registry.get('own')!)).to.deep.equal({ type: 'mine' });
    });

    it('resolves types the application provides by name, before built-in types and packages', async () => {
        const registry = await loadUAGEngines({ engineTypes: { mine, jev: mine } }, { UAG_ENGINES: 'mine,jev' });
        expect(registry.all.map((engine) => engine.model)).to.deep.equal(['mine-1', 'mine-1']);
    });

    it('refuses an unknown type, naming the packages it looked for', async () => {
        expect(await refusal(loadUAGEngines({}, { UAG_ENGINES: 'mistral' })))
            .to.include('"@formio/uag-mistral"').and.include('"uag-engine-mistral"').and.include('npm install');
    });

    it('refuses a duplicate name', async () => {
        expect(await refusal(loadUAGEngines({}, { UAG_ENGINES: 'stub-agent,stub-agent:stub-decision' }))).to.include('Two engines are named "stub-agent"');
    });

    it('refuses an engine missing a required setting, naming it', async () => {
        expect(await refusal(loadUAGEngines({}, { UAG_ENGINES: 'fast:claude' })))
            .to.equal('The "fast" engine (type "claude") needs its apiKey setting: set UAG_ENGINE_FAST_API_KEY, CLAUDE_API_KEY or ANTHROPIC_API_KEY.');
    });

    describe('core package dependencies', () => {
        it('does not depend on any model provider SDK or engine package', () => {
            const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
            const deps = Object.keys(pkg.dependencies || {});
            const modelSdks = deps.filter((name) => /anthropic|openai|typesafe|google-ai|generative-ai|mistral|cohere|ollama|^@formio\/uag-(?!sdk$)/i.test(name));
            expect(modelSdks).to.deep.equal([]);
        });
    });
});
