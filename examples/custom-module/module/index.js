const path = require('path');
module.exports = {
    config: {
        template: require('./project.json'),
        loginForm: path.join(__dirname, 'authorize.html'),
        responseTemplates: require('./templates'),
        toolOverrides: {
            get_forms: {
                description: 'Get a list of forms that the user has access to submit. You must call this tool before calling the `get_form_fields` tool to verify if the user has access to submit the form.',
            }
        },
        tools: []
    },
    actions: require('./actions')
};