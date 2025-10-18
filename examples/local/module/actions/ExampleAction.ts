import { 
    Action, 
    ActionInfo, 
    AppServerAction, 
    FormInterface, 
    SubmissionRequest, 
    SubmissionResponse 
} from "../../../..";
import { NextFunction } from "express";
export const ExampleAction: Action = {
    /**
     * The ActionInfo for this action. This defines and describes the action.
     */
    get info(): ActionInfo {
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
     * @param {*} form 
     */
    async settingsForm(form: FormInterface) {
        return [
            {
                type: 'textfield',
                key: 'example',
                label: 'Example Setting',
                input: true
            }
        ];
    },

    async executor(form: FormInterface, action: AppServerAction, handler: string, method: string) {
        const settings = action.settings;
        console.log(settings.example); // This is the value configured in the settings form for this action instance.
        return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
            // The action is executed here as Express.js middleware.
            console.log(req.body);  // The submission data if the handler is "before"
            console.log(res.resource); // The "response" data if the handler is "after";
            next(); // Call next to continue processing.
        }
    }
}