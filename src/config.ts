import { ServerConfig } from '@formio/appserver';
import type { FormflowAgentApiConfig, FormflowRateLimit, FormflowRoutingConfig } from './formflow';
import type { EngineInstanceSpec, EngineTypeDefinition } from '@formio/uag-sdk';
import { ToolInfo } from './tools/utils';
import type { UAGDatabaseOptions } from './database';
export type UAGForm = {
  name: string;
  title: string;
  description?: string;
  machineName?: string;
};

export type UAGTemplateConfig = {
  collectedData?: string;
  submittedData?: string;
  fieldRules?: string;
  allFieldsCollected?: string;
  fieldCollectedNext?: string;
  submitValidationError?: string;
  formSubmitted?: string;
  listAvailableForms?: string;
  confirmFormSubmission?: string;
  formNotFound?: string;
  noSubmissionsFound?: string;
  submissionsFound?: string;
  submissionSearchError?: string;
  submissionNotFound?: string;
  updateNotConfirmed?: string;
  submissionUpdateError?: string;
  submissionUpdated?: string;
  submissionPartialIdAmbiguous?: string;
  submissionPartialIdNotFound?: string;
  getFormFields?: string;
  getFormFieldsError?: string;
  fieldValidationErrors?: string;
  fields?: string;
  getAvailableForms?: string;
  noFormsAvailable?: string;
  [key: string]: string | undefined; // Needed for custom templates.
};

export type UAGToolOverride = {
  get_forms?: ToolInfo;
  get_form_fields?: ToolInfo;
  get_field_info?: ToolInfo;
  collect_field_data?: ToolInfo;
  confirm_form_submission?: ToolInfo;
  submit_completed_form?: ToolInfo;
  submission_update?: ToolInfo;
  find_submissions?: ToolInfo;
  agent_provide?: ToolInfo;
  /** @deprecated The earlier name of `agent_provide`; also applied to it when `agent_provide` is not set. */
  agent_provide_data?: ToolInfo;
  agent_decide?: ToolInfo;
  fetch_external_data?: ToolInfo;
};

/**
 * One engine instance: `"<type>"` or `"<name>:<type>"`, or `{ name, type, options }`, where the
 * type is a type name, a package name, or an engine type definition.
 */
export type UAGEngineEntry = string | EngineInstanceSpec;

/** Engine preference lists for each kind of work. See FormflowRoutingConfig. */
export type UAGRoutingConfig = FormflowRoutingConfig;

/** A request allowance. See FormflowRateLimit. */
export type UAGRateLimit = FormflowRateLimit;

/** Agent API defaults: thresholds, timeouts, tools and rate limits. See FormflowAgentApiConfig. */
/** Limits on anonymous use of a form's agent operations, per minute in each UAG process. 0 turns anonymous use off. */
export interface UAGAnonymousConfig {
  /** Requests from one client address (AGENT_ANONYMOUS_RATE_LIMIT, default 10). */
  rateLimit?: number;
  /** Requests from all anonymous callers together (AGENT_ANONYMOUS_TOTAL_RATE_LIMIT, default 100). */
  totalRateLimit?: number;
}

export type UAGAgentApiConfig = FormflowAgentApiConfig & { anonymous?: UAGAnonymousConfig };

/**
 * Express's `trust proxy` from TRUST_PROXY: `true` or `false`, a number of
 * proxy hops, or addresses and ranges (`loopback, 10.0.0.0/8`). Unset when
 * TRUST_PROXY is empty. With it, the UAG reads its public URL, and callers'
 * addresses, from the proxy's forwarded headers.
 */
export function trustProxySetting(value: string | undefined): boolean | number | string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  return text;
}

export interface UAGConfig extends ServerConfig {
  /** The UAG's public URL (BASE_URL). Optional: derived from each request when unset. */
  baseUrl?: string;
  loginForm?: string;
  responseTemplates?: UAGTemplateConfig,
  toolOverrides?: UAGToolOverride,
  tools?: ToolInfo[],
  /**
   * The engine instances to enable, as in `UAG_ENGINES` (`"jev"`, `"fast:claude"`) or as
   * `{ name, type, options }`. When unset, `UAG_ENGINES` is used; when neither names any, no
   * engine is enabled.
   */
  engines?: UAGEngineEntry[],
  /** Engine types this application provides, by type name, resolved before built-in types and packages. */
  engineTypes?: Record<string, EngineTypeDefinition>,
  routing?: UAGRoutingConfig,
  agentApi?: UAGAgentApiConfig,
  /**
   * The UAG's own database (`MONGO`, `UAG_DATABASE`, `MONGO_CONFIG`,
   * `TASK_RUN_RETENTION_DAYS`), for remote MCP sign-in and durable task runs.
   * It needs a license that includes the UAG, unless the project and the
   * database are both on development hosts.
   */
  database?: UAGDatabaseOptions
}
