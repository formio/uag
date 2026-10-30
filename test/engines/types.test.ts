import { expect } from 'chai';
import type * as Sdk from '@formio/uag-sdk';
import type { LoadedEngine } from '@formio/uag-sdk/loader';
import { Formflow } from '@formio/appserver';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sdk = require('@formio/uag-sdk');

/**
 * The MIT engine SDK (`@formio/uag-sdk`) must describe the same engines
 * that @formio/appserver-core accepts. The assignments below fail to compile if
 * the two drift apart.
 */
const decisionToCore: Formflow.DecisionEngine = {} as Sdk.DecisionEngine;
const decisionFromCore: Sdk.DecisionEngine = {} as Formflow.DecisionEngine;
const agentToCore: Formflow.AgentEngine = {} as Sdk.AgentEngine;
const agentFromCore: Sdk.AgentEngine = {} as Formflow.AgentEngine;
const extractToCore: Formflow.ExtractRequest = {} as Sdk.ExtractRequest;
const extractFromCore: Sdk.ExtractRequest = {} as Formflow.ExtractRequest;
// What the loader returns is what core's engine registry takes.
const loadedToCore: Formflow.EngineInstance = {} as LoadedEngine;

describe('Engine SDK contract', () => {
    it('has the same contract version as the server', () => {
        expect(sdk.ENGINE_API_VERSION).to.equal(Formflow.ENGINE_API_VERSION);
        expect([decisionToCore, decisionFromCore, agentToCore, agentFromCore, extractToCore, extractFromCore, loadedToCore]).to.have.length(7);
    });

    it('validates instance names as the server does', () => {
        expect(sdk.ENGINE_NAME.source).to.equal(Formflow.ENGINE_NAME.source);
    });
});
