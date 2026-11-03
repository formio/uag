import { defineEngine, ENGINE_API_VERSION } from '@formio/uag-sdk';
import type { GenerateRequest } from '@formio/uag-sdk';
import { stubAgentEngine, stubDecisionEngine } from "../formflow";

/**
 * Stand-in engines for tests and local development. They answer instantly with
 * predictable values, so the Agent API can be exercised end to end without
 * model credentials: `UAG_ENGINES=stub-decision,stub-agent`. Core creates
 * them, so they keep the standing that lets them run without a license under
 * any instance name.
 */
export const StubDecisionEngine = defineEngine({
    type: 'engine',
    name: 'stub-decision',
    title: 'Stub decision engine',
    kinds: ['decision'],
    apiVersion: ENGINE_API_VERSION,
    description: 'Answers every decision with a fixed, predictable value. For tests and local development.',
    create: ({ name }) => stubDecisionEngine({ name }),
});

/** Every generate request the stub agent engines received, oldest first, for tests. */
export const stubGenerateRequests: Array<Omit<GenerateRequest, 'signal' | 'onProgress'> & { engine: string }> = [];

export const StubAgentEngine = defineEngine({
    type: 'engine',
    name: 'stub-agent',
    title: 'Stub agent engine',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    description: 'Extracts nothing; generates a predictable answer from the text it is given. For tests and local development.',
    // Text only; its generate answer shows what reached it. Observing its requests keeps it a built-in stub.
    create: ({ name }) => stubAgentEngine({ name, onGenerate: (request) => { stubGenerateRequests.push({ ...request, engine: name }); } }),
});
