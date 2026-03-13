/**
 * Instruct the agent to use the `collect_field_data` tool to take a block of natural language text and extract form field values from it.
 * @param {*} body 
 * @returns 
 */
export function collect_field_data(body) {
    const { formName, text } = body;
    let command = `Below is a block of text produced by a user, which is provided within the \`--- USER TEXT ---\` block. Use the following process to extract the relevant form field values from this text. The result of this command should be a JSON object representing the extracted form data.\n\n`;
    command += `1. Using the \`get_form_fields\` tool, identify the form fields for \`form_name\`=**${formName.trim()}**.\n`;
    command += `2. Determine the relevant field values from the text provided within the \`--- USER TEXT ---\` block.\n`;
    command += `3. Use the \`get_field_info\` tool to verify that each provided value conforms to the field requirements. If they do not, then respond with a JSON error response in the format provided by the \`--- VALIDATION ERROR RESPONSE FORMAT ---\` block.\n`;
    command += `4. If all the values are valid, then use the \`collect_field_data\` tool with \`as_json=true\` and the \`form_data\` set to the field values determined from the user provided text. The response from this tool should then be directly relayed as the response of this command.\n`;
    command += `--- USER TEXT ---\n${text.trim()}\n--- END USER TEXT ---\n\n`;
    command += '--- VALIDATION ERROR RESPONSE FORMAT ---\n';
    command += '{\n  "error": "Validation Error",\n  "details": [\n    {\n      "field": "field_name",\n      "message": "Description of the validation error."\n    }\n  ]\n}\n';
    command += '--- END VALIDATION ERROR RESPONSE FORMAT ---\n';
    return command;
}