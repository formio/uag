import { ServerConfig } from '@formio/appserver';
import { ToolInfo } from './tools/utils';
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
  agent_provide_data?: ToolInfo;
  fetch_external_data?: ToolInfo;
};

export interface UAGConfig extends ServerConfig {
  baseUrl?: string;
  loginForm?: string;
  responseTemplates?: UAGTemplateConfig,
  toolOverrides?: UAGToolOverride,
  tools?: ToolInfo[]
}
