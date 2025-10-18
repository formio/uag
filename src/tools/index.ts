import { getForms } from "./getForms";
import { getFormFields } from "./getFormFields";
import { collectData } from "./collectData";
import { getOptionalFields } from "./getOptionalFields";
import { confirmSubmission } from "./confirmSubmission";
import { submitCompletedForm } from "./submitForm";
import { findSubmission } from "./findSubmission";
import { submissionUpdate } from "./submissionUpdate";
import { ToolInfo } from "./types";
import { UAGProjectInterface } from "../UAGProjectInterface";
export * from './types';
export { getForms, getFormFields, collectData, getOptionalFields, confirmSubmission, submitCompletedForm, findSubmission, submissionUpdate };
export const getTools =  async (project: UAGProjectInterface): Promise<ToolInfo[]> => {
    return [
        await getForms(project),
        await getFormFields(project),
        await getOptionalFields(project),
        await collectData(project),
        await confirmSubmission(project),
        await submitCompletedForm(project),
        await findSubmission(project),
        await submissionUpdate(project)
    ];
};