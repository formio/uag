import { Formflow } from '@formio/appserver-core';

/**
 * Agentic Formflow from @formio/appserver-core, imported directly rather than
 * through @formio/appserver, under the names the UAG uses. Internal to the UAG:
 * applications reach Formflow as `Formflow` from this package's exports.
 */

export const {
    AgentDecideAction,
    EngineConfigError,
    EngineRegistry,
    FormflowError,
    FormflowService,
    RateLimitError,
    ScopedTokenError,
    bearerOf,
    engineRegistry,
    formflow,
    formflowAuthenticate,
    identityOf,
    issueScopedToken,
    readScopedToken,
    resolveFormName,
    resolveTaskName,
    resultEvent,
    warnLegacy,
    stubAgentEngine,
    stubDecisionEngine,
    toolsForScope,
    EngineError,
    formatReport,
} = Formflow;

export type AgentEngine = Formflow.AgentEngine;
export type CallerIdentity = Formflow.CallerIdentity;
export type DecisionEngine = Formflow.DecisionEngine;
export type DecisionRequest = Formflow.DecisionRequest;
export type EngineInstance = Formflow.EngineInstance;
export type EngineRegistry = Formflow.EngineRegistry;
export type ExtractRequest = Formflow.ExtractRequest;
export type ExtractResponse = Formflow.ExtractResponse;
export type FormflowAgentApiConfig = Formflow.FormflowAgentApiConfig;
export type FormflowConfig = Formflow.FormflowConfig;
export type FormflowForm = Formflow.FormflowForm;
export type FormflowHost = Formflow.FormflowHost;
export type FormflowRateLimit = Formflow.FormflowRateLimit;
export type FormflowRoutingConfig = Formflow.FormflowRoutingConfig;
export type FormflowService = Formflow.FormflowService;
export type FormflowTask = Formflow.FormflowTask;
export type FormflowTool = Formflow.FormflowTool;
export type OperationContext = Formflow.OperationContext;
export type OperationResult = Formflow.OperationResult;
export type ScopedTokenClaims = Formflow.ScopedTokenClaims;
