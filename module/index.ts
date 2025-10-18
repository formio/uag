import { UAGModule } from '..';
/**
 * This is an empty module definition used to provide the default runtime with an overridable module that can be
 * provided in your Docker compose file.  To override this file within a Docker, you can use the following methods.
 * 
 * Docker Compose:
 *  volumes:
 *     - ./module:/app/module
 * 
 * Docker CLI:
 *  docker run -v ./module:/app/module ...
 * 
 * Documentation for how this works can be found in the Readme.md of this directory.
 */
export default <UAGModule>{
    config: {
        template: undefined, // To provide "default" resources and forms to the project. See examples/local for an example of this.
        loginForm: '', // To change the "/auth/authorize" page. See examples/local for an example of this.
        responseTemplates: {}, // Override the templates defined by ResponseTemplate enum (or your own new templates) here. See examples/local for an example of this.
        toolOverrides: {}, // Override the tool definitions defined by ToolName enum here. See examples/local for an example of this.
        tools: [] // Add your custom tools here.  Must be in the format defined by the ToolInfo type.
    },
    actions: {} // Add your custom form actions here.
};