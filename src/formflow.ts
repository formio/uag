import { Formflow } from '@formio/appserver';

/**
 * Agentic Formflow from @formio/appserver-core, through @formio/appserver (see
 * assertSingleCore), under the names the UAG uses. Internal to the UAG:
 * applications reach Formflow as `Formflow` from this package's exports.
 */

export const {
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
    isScopedToken,
    readScopedToken,
    resolveTaskName,
    resultEvent,
    warnLegacy,
    withoutOwnedValues,
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
export type FieldSpec = Formflow.FieldSpec;
export type ToolCallResult = Formflow.ToolCallResult;
export type ToolDefinition = Formflow.ToolDefinition;
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

/**
 * Who an operation's research acts as: core's `identityOf`, and for a caller
 * signed in with a Form.io token (`x-jwt-token`), that token, so a scoped token
 * carries the user to /mcp as an `Authorization` bearer token would. A portal
 * team member's remote token is never carried: research for them is refused,
 * as it is for anonymous callers.
 */
export function callerIdentity(auth: any, req: { get?: (name: string) => string | undefined }): CallerIdentity {
    const identity = identityOf(auth, req.get?.('authorization'));
    if (identity.admin || identity.bearer) return identity;
    const formioToken = req.get?.('x-jwt-token');
    if (auth?.user && !auth.remoteToken && typeof formioToken === 'string' && formioToken) {
        return { admin: false, bearer: formioToken };
    }
    return identity;
}
