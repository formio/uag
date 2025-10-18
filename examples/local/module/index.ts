import { UAGModule } from '../../..';
import path from 'path';
import customTemplates from './templates';
import { actions } from './actions';
export default <UAGModule>{
    config: {
        template: require('./project.json'),
        loginForm: path.join(__dirname, 'authorize.html'),
        responseTemplates: customTemplates,
        toolOverrides: {
            get_forms: {
                description: 'Get a list of forms that the user has access to submit. You must call this tool before calling the `get_form_fields` tool to verify if the user has access to submit the form.',
            }
        },
        tools: []
    },
    actions
};