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
import { agentProvideData } from "./agentProvideData";
export * from './utils';
export { getForms, getFormFields, getFieldInfo, collectData, confirmSubmission, submitCompletedForm, findSubmission, submissionUpdate };
export const getTools =  async (project: UAGProjectInterface): Promise<ToolInfo[]> => {
    return [
        await getForms(project),
        await getFormFields(project),
        await getFieldInfo(project),
        await collectData(project),
        await confirmSubmission(project),
        await submitCompletedForm(project),
        await findSubmission(project),
        await submissionUpdate(project),
        await agentProvideData(project)
    ];
};