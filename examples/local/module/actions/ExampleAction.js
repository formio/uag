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
     * @param {import('../../../../src').FormInterface} form - The form that this action is being configured for.
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

    async executor(form, action, handler, method) {
        const settings = action.settings;
        console.log(settings.example); // This is the value configured in the settings form for this action instance.
        return async (req, res, next) => {
            // The action is executed here as Express.js middleware.
            console.log(req.body);  // The submission data if the handler is "before"
            console.log(res.resource); // The "response" data if the handler is "after";
            next(); // Call next to continue processing.
        }
    }
}