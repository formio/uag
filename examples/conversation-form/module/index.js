/**
 * UAG module for the conversation-form example.
 *
 * Hands the UAG a Form.io project template containing a single `serviceRequest`
 * form. Everything the chat application knows how to ask comes from that form,
 * so this file is the entire "configuration" of the conversation.
 */
module.exports = {
    config: {
        template: require('./project.json'),
    },
};
