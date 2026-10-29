import { defineEngine, ENGINE_API_VERSION } from '@formio/uag-sdk';
import { stubAgentEngine, stubDecisionEngine } from "../formflow";

/**
 * Stand-in engines for tests and local development. They answer instantly with
 * predictable values, so the Agent API can be exercised end to end without
 * model credentials: `UAG_ENGINES=stub-decision,stub-agent`. Core creates
 * them, so they keep the standing that lets them run without a license under
 * any instance name.
 */
export const StubDecisionEngine = defineEngine({
    type: 'stub-decision',
    kinds: ['decision'],
    apiVersion: ENGINE_API_VERSION,
    description: 'Answers every decision with a fixed, predictable value. For tests and local development.',
    create: ({ name }) => stubDecisionEngine({ name }),
});

export const StubAgentEngine = defineEngine({
    type: 'stub-agent',
    kinds: ['agent'],
    apiVersion: ENGINE_API_VERSION,
    description: 'Extracts nothing. For tests and local development.',
    create: ({ name }) => stubAgentEngine({ name }),
});
