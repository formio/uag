export const ExampleAction = {
    /**
     * The ActionInfo for this action. This defines and describes the action.
     */
    get info() {
        return {
            name: 'example',
            title: 'Example Action',
            description: 'Shows how an example action can be created and implemented.',
            priority: 0,
            defaults: {
                handler: ['after'],
                method: ['create', 'update', 'delete']
            },
        };
    },

    /**
     * The settings form for this action.
     * 
     * @import { FormInterface } from '@formio/appserver';
     * @param { FormInterface } form - The form that this action is being configured for.
     * @returns - Form.io Form JSON schema for the project settings for this action.
     */
    async settingsForm(form) {
        return [
            {
                type: 'textfield',
                key: 'example',
                label: 'Example Setting',
                input: true
            }
        ];
    },

    /**
     * Enterprise Only: This provides a way to store "global" project settings that are encrypted. This is useful
     * if your action needs to use sensitive information to properly execute. For example, if you are creating an
     * action that integrates with a third-party service, you may need to store an API key or secret.
     *
     * @import { FormInterface } from '@formio/appserver';
     * @param {FormInterface} form 
     * @returns - Form.io Form JSON schema for the project settings for this action.
     */
    async projectSettings(form) {
        return [
            {
                type: 'textfield',
                key: 'superSecret',
                label: 'Super Secret Setting',
                input: true
            }
        ];
    },

    /**
     * @import { FormAction } from '@formio/core';
     * @import { FormInterface } from '@formio/appserver';
     * @param { FormInterface } form 
     * @param { FormAction } action 
     * @param { 'before' | 'after' } handler 
     * @param { 'create' | 'update' | 'delete' } method 
     * @returns 
     */
    async executor(form, action, handler, method) {
        const settings = action.settings;
        console.log(settings.example); // This is the value configured in the settings form for this action instance.

        /**
         * The executor function that is returned here is what is executed when the action is triggered.
         * 
         * @import { Request, Response, NextFunction } from 'express';
         * @param { Request } req - The Express.js request object.
         * @param { Response } res - The Express.js response object.
         * @param { NextFunction } next - The Express.js next function to call the next middleware.
         */
        return async (req, res, next) => {
            // The action is executed here as Express.js middleware.
            console.log(form.project?.settings); // The encrypted project settings for Enterprise Only.
            console.log(req.body);  // The submission data if the handler is "before"
            console.log(res.resource); // The "response" data if the handler is "after";
            next(); // Call next to continue processing.
        }
    }
}