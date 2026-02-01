/**
 * Instruct the agent to use the `agent_provide_data` tool to evaluate and provide new data for an existing form submission.
 * @param {*} body 
 * @returns 
 */
export function agent_provide_data(body) {
    const { formName, submissionId, persona } = body;
    let command = `Use the \`agent_provide_data\` tool to evaluate and provide new data for an existing form submission.  The \`form_name\` is **${formName.trim()}**.\nThe \`submission_id\` is **${submissionId.trim()}**.`;
    if (persona) {
        command += ` The \`persona\` is: **${persona.trim()}**.`;
    }
    return command;
}