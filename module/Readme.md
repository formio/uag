## UAG Modules
A module is a way to extend the functionality and provide default forms and resources to accomplish specific goals using the UAG (Universal Agent Gateway). This capability enables developers to create their own domain-specific implementations of agent behaviors through custom actions, resources, and forms that produce deterministic behaviors from Generalized pre-trained agents (ChatGPT, Claude, etc).

A module can also be published via NPM or Github and used by other developers to automatically configure their own software to work with the systems covered by that module.

### Using a module
There are two ways that a module can be "used".  Importing into an Express application, or mounting a module with Docker. 

#### Importing a module
To import an existing module, you simply need to install that module via NPM and then use it within an Express.js application as follows.

```
npm i @example/uag
```

This is not a real module, but provides an example of how a module can be distributed and used from any company wishing to produce their own specific module behaviors.

```js
import { ExampleModule } from '@example/uag';
import { UAGServer } from '@formio/uag';
import Express from 'express';
try {
    (async function () {
        const server = new UAGServer();
        server.use(ExampleModule);
        const app = Express();
        app.use(await server.router());
        const port = process.env.PORT || 3200;
        app.listen(port, () => {
            console.log(`Form.io UAG server running on port ${port}`);
            console.log(`Visit http://localhost:${port} to access the application`);
        });
    })();
} catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
}
```

In this example, the UAG Server will load all of the forms, resources, custom actions, and configurations provided from the Example UAG module.

### Using a module with Docker
You can also use a module with Docker. The way this works is when you mount a volume, it will by default, override any existing "folder" that exists within that Docker container.  Our Docker containers are released to mount the "default" module provided in the **module** folder of this repo. When you mount a folder at the same path as that folder, it will use your mounted module instead of the one that is built within a container. This will then run your custom module within the Docker container so that your custom forms, resources, actions and configurations are applied to the UAG running through Docker. It is for this reason, you will see many examples (in the **examples** folder contain a "module" folder next to a docker-compose.yml file).

### Using with Docker Compose (preferred)
The preferred method of using a custom module with Docker is to utilize the Docker Compose system. This works by attaching the volume to the **formio/uag** Docker image as follows.

```yml
formio-uag:
  image: formio/uag:rc
  restart: always
  links:
    - formio
  ports:
    - "3200:3200"
  volumes:
    - ./module:/app/module
  environment:
    PORT: 3200
    DEBUG: formio.*
```

This will ensure that your custom module is mounted instead of the default (empty) **module** provided by the UAG.

### Using with Docker
You can also mount a module using Docker with the -v flag.

```
docker run -v ./module:/app/module -e PORT=3200 -e DEBUG=formio.* formio/uag:rc
```

## Module Structure
Every module can provide a number of extensions and overrides to the UAG. The capabilities for modules are provided through an exported JSON structure that looks like the following.

```js
import { UAGModule } from '@formio/uag';
export default <UAGModule>{
    config: {
        template: undefined, // Default project.json template
        loginForm: '', // Change the "/auth/authorize" form
        responseTemplates: {}, // Override and create new reponse templates.
        toolOverrides: {}, // Override existing tool definitions
        tools: [], // Add your custom tools here.  Must be in the format defined by the ToolInfo type.
        db: null, // Enterprise Only:  Database configurations defined by DbConfig
        auth: null, // Authentication configuration defined by AuthConfig
        license: '', // Enterprise License
        cors: null, // CORS configurations defined by CorsOptions
    },
    actions: {} // Add your custom form actions here.
};
```

Each of the following can be provided through a Module.

### **templates**: Custom Templates / Override Existing Templates
You can provide your own Form.io Project templates to serve as the default Forms, Resources, Actions, and Roles that you need to achieve the goals of your specific module. The Project Template can be retrieved either through the "/export" endpoint from OSS, or though the **Export Template** feature within your Project Staging settings of an Enterprise Server deployment.

### **tools**: Custom Tools / Override Existing Tools
With this configuration, you can introduce new MCP tools to the UAG to further enhance the interfaces between Form.io and the AI Agents. This is extremely powerful since you could concieve of new tools that combine both the power of Form.io along with any other custom tool or external service you wish to combine with the Form.io tool intefaces.

For an example of how to create a tool, simply look inside the [Tools Directory](../src/tools)

### **responseTemplates**: Override and Create new Response Templates.
The response templates provide the outputs that are sent to the AI Agent to establish the context it needs to accomplish custom goals. These templates use the [Lodash Template](https://lodash.com/docs/4.17.15#template) system to create a very flexible and powerful way to produce output text provided a data structure input. 

With this configuration, you can provide your own custom templates which can then be used with the following command.

```js
import { UAGProjectInterface, ResponseTemplate, ToolInfo } from '@formio/uag';

export const customTool = async (project: UAGProjectInterface): Promise<ToolInfo> => {
  console.log(project.mcpResponse(ResponseTemplate.customTemplate, {
    data: {
      foo: 'bar'
    }
  }));
};
```

To render a template directly (without an mcpResponse), you can use the method...

```js
import { UAGTemplate, ResponseTemplate } from '@formio/uag';
UAGTemplate.renderTemplate(ResponseTemplate.customTemplate, {
  data: {
    foo: 'bar'
  }
})
```

### **toolOverrides**: Override the existing tools.
Just like you can add your very own tools with the "tools" property, you can also completely override the existing UAG "tools" using the toolsOverride object. This can be done by providing the tool you wish to override as the "key" of the configuration, along with the "override" parameters you wish to override.

The following example will override the "description" of the get_forms tool.

```js
{
  toolOverrides: {
    'get_forms': {
      description: 'I believe having this description would produce better results!!!!'
    }
  }
}
```

### **actions**: Custom Actions
Of of the more powerful features of Modules is the ability to develop custom actions that should be included along with your Forms and Resources. Actions can the thought of a Configurable Middleware that can be attached and independently configured for any Form and Resource within the Form.io platform. The can be used to achieve custom integrations, workflows, behaviors and responses of the UAG.  

A Basic Action "implements" the Action interface from @formio/uag and should follow the following type rules.

```ts
export type ActionInfo = {
    name: string;
    title: string;
    description: string;
    priority: number;
    premium?: boolean;
    defaults: {
        handler: Array<string>;
        method: Array<string>;
    };
    access?: {
        handler: boolean;
        method: boolean;
    };
};

export interface Action {
    [key: string]: any;
    info: ActionInfo;
    settingsForm: (form: FormInterface) => Promise<Component[]>;
    executor: (form: FormInterface, action: FormAction, handler: string, method: string) => Promise<(req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => Promise<any>>;
}
```

A very minimal Action looks like the following.

```ts
import { 
  Action, 
  ActionInfo, 
  AppServerAction, 
  FormInterface, 
  SubmissionRequest, 
  SubmissionResponse
} from '@formio/uag';
import { NextFunction } from 'express';
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

    /**
     * Enterprise Only:  For the Enterprise Only deployments, you can also store "secret" configurations necessary for secure integrations
     * within the encrypted Project Settings. If you action implements this method, they can provide a special form for that Action where the
     * value of this form will be saved in the Project Settings of that project. It should be noted, that this value is not per-instance but rather
     * is treated as a Global value. This is good for any API Keys or secrets that are needed for integration purposes.
     * 
     * Once a value is saved, it can be fetched via "form.project.settings?.myservice?.secret" variable.
     */
    async projectSettings(form: FormInterface) {
      return [
        {
          type: 'textfield',
          label: 'Custom Integration API Key',
          description: 'Enter a secret API Key that will be stored as an encrypted setting in the Project Settings.',
          key: 'myservice.secret'
        }
      ]
    },

    /**
     * 
     */
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
```

The **info** getter returns metadata about the Action. This provides the Form.io platform with information to describe the Action. 

The **settingsForm** returns the Form.io JSON form that is used for the configuration for each "instance" of the Action. An Action instance is attached to each form and there can be an unlimited number of action instances attached to unlimited forms. This provides the **action.settings** object that is used to inject into the **executor** method. For example, if you wish for your settings to look like the following.

```json
{
   "settings": {
      "items": [
         {"foo": "a", "bar": "b"},
         {"foo": "c", "bar": "d"}
      ]
   }
}
```

You could return the following for your settingsForm definition.

```js
async settingsForm(form: FormInterface) {
  return [
      {
          type: 'datagrid',
          key: 'items',
          label: 'Items',
          input: true,
          components: [
            {type: 'textfield', key: 'foo', label: 'Foo', input: true},
            {type: 'textfield', key: 'bar', label: 'Bar', input: true}
          ]
      }
  ];
}
```

The **projectSettings** is an Enterprise Only feature. For the Enterprise Only deployments, you can also store "secret" configurations necessary for secure integrations within the encrypted Project Settings. If you action implements this method, they can provide a special form for that Action where the value of this form will be saved in the Project Settings of that project. It should be noted, that this value is not per-instance but rather is treated as a Global value. This is good for any API Keys or secrets that are needed for integration purposes. Once a value is saved, it can be fetched via ```form.project.settings?.myservice?.secret``` variable.

The **executor** is a **pre-load function** that returns a **run-time middleware function**.  This would allow you to pre-load any necessary elements that need to occur as the server is "booting" up so that it does not consume time during the runtime function operation. Anything that is within the **runtime middleware function** which is shows as ```(req, res, next) => {}``` is executed during runtime. Because of this, you should not do anything that is processor intensive within this part of the function. 

The Executor function is shown as follows.

```ts
/**
 * The "executor" function of an Action. It consists of a pre-load function that returns a run-time function.
 * 
 * @param form: FormInterface - The form interface for the current form being executed. See type definition of FormInteface
 * for a description of all the methods that are supported within class.
 * 
 * @param action AppServerAction - The JSON "instance" of this action. 
 * @param handler - The handler "before" or "after"
 * @param method - The CRUD method of the action:  "create", "read", "update", "delete"
 */
async executor(form: FormInterface, action: AppServerAction, handler: string, method: string) {
  const settings = action.settings;
  console.log(settings.example); // This is the value configured in the settings form for this action instance.

  /**
   * Returns the "runtime" function for the "action". This is simply an Express.js middleware function that is evaluated
   * during the request runtime. Just like Express, you must make sure you call the next function to continue the request.
   */
  return async (req: SubmissionRequest, res: SubmissionResponse, next: NextFunction) => {
    // The submission data if the handler is "before"
    console.log(req.body);

    // The "response" data (such as form submission, or index, etc) if the handler is "after";
    console.log(res.resource);

    // Make sure to always call "next" unless you are responding to the request.
    next();
  }
}
```

#### Configuring actions
Once you have defined an action, the next step is to add an Action instance to a Form. If you are using the OSS server, then this can be done either by adding the action instance to the project.json of your Module. See the Local Example for an example of how to do this.

The other method is to send the following POST request to your form once the OSS server is running.

```
POST: /form/{{ FORM_ID }}/action
HEADERS:
  {"x-admin-key": "{{ ADMIN_KEY }}}"
BODY:
  {
    "data": {
      "name": "example",
      "title": "Custom Action Instance",
      "method": ["create"],
      "handler": ["after"],
      "priority": 15,
      "settings": {
        "example": "This is an Action Instance!"
      }
    }
  }
```

You will need to make sure you replace **FORM_ID** and **ADMIN_KEY** with the Form ID you wish to add the action instance to, and the ADMIN_KEY of your OSS deployment.

Currently there is not a UI way of adding an Action instance to your OSS Server. However, if you are using the Enterprise Server, then you can easily add actions with the Developer portal.

#### Configuring actions: Enterprise Server
If you are using the Enterprise Server, then adding and managing Custom action is much simpler. When you connect to the UAG (like a stage), then you can simply navigate to the form and use the Developer Portal to add your actions instances using the UI of the Developer portal. See the main [Readme](../README.md) for documentation on how to achieve this with the Enterprise Developer Portal. 