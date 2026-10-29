import { getForms } from "./getForms";
import { getFormFields } from "./getFormFields";
import { getFieldInfo } from "./getFieldInfo";
import { collectData } from "./collectData";
import { confirmSubmission } from "./confirmSubmission";
import { submitCompletedForm } from "./submitForm";
import { findSubmission } from "./findSubmission";
import { submissionUpdate } from "./submissionUpdate";
import { ToolInfo } from "./utils";
import { UAGProjectInterface } from "../UAGProjectInterface";
import { agentProvide, agentProvideData } from "./agentProvide";
import { agentDecide } from "./agentDecide";
import { fetchExternalData } from "./fetchExternalData";
export * from './utils';
export * from './annotations';
export { getForms, getFormFields, getFieldInfo, collectData, confirmSubmission, submitCompletedForm, findSubmission, submissionUpdate, fetchExternalData, agentProvide, agentProvideData, agentDecide };
export const getTools = async (project: UAGProjectInterface): Promise<ToolInfo[]> => {
    return Promise.all([
        getForms(project),
        getFormFields(project),
        getFieldInfo(project),
        collectData(project),
        confirmSubmission(project),
        submitCompletedForm(project),
        findSubmission(project),
        submissionUpdate(project),
        agentProvide(project),
        agentDecide(project),
        // Deprecated: the earlier name of agent_provide.
        agentProvideData(project),
        fetchExternalData(project)
    ]);
};