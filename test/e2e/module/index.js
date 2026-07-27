/**
 * UAG module configuration used by the end-to-end test suite. Provides the
 * test project template (uag-tagged customer resource with required and
 * conditional fields, plus a college application form configured for the
 * agent_provide_data workflow).
 */
module.exports = {
    config: {
        template: require('./template.json'),
        loginForm: '',
        responseTemplates: {},
        toolOverrides: {},
        tools: []
    },
    actions: {}
};
