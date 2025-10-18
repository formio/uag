# The Form.io "Universal Agent Gateway" (UAG)
The Universal Agent Gateway (uag) is an exciting new technology that enables the exposure of Form.io forms to AI Agents. Leveraging the power of MCP, this library provides AI Agents with dynamic context of how to interface with any backend system using Form.io JSON Forms as the common language between these agents and enterprise systems. 

This library can be used in many ways, either by deploying it directly via the Docker container, or by extending the interfaces and introducing your own custom Actions and providers.

## How it works
The UAG introduces a number of new tools through the MCP interface to provide an AI Agent with dynamic "form" based context on a per form basis. This cabability allows for Developers to treat AI Agents as they would any other Human who is submitting a form, and ensure that the AI Agents stay "on the rails" without requiring extensive domain specific agent training methods to accomplish the same goal. It achieves this by exposing the following MCP tools to an AI Agent.

| Tool Name         | Tool Description                                                                 |
|-------------------|----------------------------------------------------------------------------------|
| get_forms       | Provides the AI Agent an understanding of what Forms are available. It will only return forms that have a tag of "uag". |
| get_form_fields     | Once a form has been identified by the AI Agent that the user wishes to engage with (using natural language), this tool provides the AI Agent information of all the fields needed (along with the field data path) to submit that form.            |
| collect_field_data  | This tool provides the AI Agent a mechanism to dynamically collect the required information from the user. It is capable of collecting many fields at once, and also provides the AI agent the ability to understand what required fields are missing and what is needed to complete its goal.        |
| get_optional_fields  | This tool provides the AI Agent awareness of what other optional fields are available if the user wishes to provide any additional information to complete the submission.  |
| confirm_form_submission     | This tool provides the AI Agent the ability to confirm all the information it has collected before a submission has been made. It allows the AI Agent the ability to get a confirmation from the user before it submits the form. |
| submit_completed_form    | This tool provides the AI Agent the ability to submit all of the data collected from the user to complete the form submission.
| find_submission_by_field | A very powerful tool that provides the AI Agent the ability to understand how to query for data within the form. This enables the user to say something like "What is the email address of Joe Smith who is the CTO of Microsoft?" and it will format the query responsible for finding that record within the Form.io database.
| submission_update | Provides the AI agent the ability to update an existing record with any additional information. This also has the awareness to "append", "prepend", and perform any other operations on the data in congruence with how the user has requested the data be updated. 

## Getting Started
The quickest way to become familar with the UAG is to first walk through our Local Example, and run it on your local machine. This will allow you to see how the UAG leverages the power of Form.io to connect with an AI Agent to provide dynamic context. All of this can be ran locally for free without any subscriptions required!

[Click here to get started with our Local Example](examples/local/Readme.md) (Readme.md).

## Runtime Environments
There are two environments that you can current run and work with the UAG.

### Node.js (Express):
With the Node.js environment, you can import the UAG within a locally running Node.js and Express.js envioronment. This works by first importing the UAG module and "use"ing it within an Express.js application. First, you will install the uag inside of your Node.js Express application like the following.

```npm install --save @formio/uag```

or

```yarn add @formio/uag```

You can then mount the UAG within your Express application like the following example shows.

```js
import 'dotenv/config';
import Express from 'express';
import { UAGServer } from '@formio/uag';
try {
    (async function () {
        const server = new UAGServer();
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

There is also a way to extend the functionality of the UAG through the use of modules, which is documented in the [Modules Readme](./module/Readme.md)

### Docker
In addition to running the UAG in node.js, you can also run the UAG within the Docker environment. This enables a wide range of deployment options into common hosting environments such as AWS and Azure as well as allow for the use in common orchestration runtimes such as Kubernetes and Docker Compose. The container that you will use for running the UAG is as follows.

```
formio/uag
```

This container can be ran as a standalone container using the common **docker run** command, or inside of a **docker-compose.yml** (for Docker Compose). To see an example of using UAG with Docker Compose, we recommend taking a look at the [Local Example](./examples/local/Readme.md). 

In both the Node.js runtime environemnt as well as Docker, the way to control the UAG is thorugh the use of **Environment Variables** and **Modules**.

### Environment Variables
This module can be configured in many ways. One of those ways is through the use of Environment Variables, which are documented as follows.

| Variable | Description | Example |
|----------|-------------|---------|
| PROJECT | The API Endpoint to either an Enterprise project endpoint, or the OSS server url. | http://localhost:3000 |
| PROJECT_KEY | (Enterprise Only) Either a Project API Key (for Form.io Enterprise) or the ADMIN_KEY for Community Edition. | CHANGEME |
| ADMIN_KEY | (OSS Only) Allows you to provide the ADMIN_KEY to install and connect to the OSS Server. | CHANGEME |
| PORT | The port you wish to run the server on. | 3200 |
| DEBUG | Variable used to perform debug logs of server activity | formio.* |
| PORTAL_SECRET | Enterprise Only:  Allows you to connect to the UAG from the Form.io Enterprise Portal. | CHANGEME |
| JWT_SECRET | A secret used to generate and validate JWT tokens generated through the authentication process of the UAG. This does not need to match the JWT_SECRET of the Enterprise Server that it is connected to. | CHANGEME |
| PORTAL_SECRET | (Enterprise Only) Used to connect the UAG server with the Enterprise Portal | CHANGEME |
| JWT_EXPIRE_TIME | The expiration for the jwt secret. | 3600 |
| SUBMISSION_PROXY | (Required for OSS) Serves as a submission proxy to the PROJECT endpoint that it is connected to. This will forward all submission API's to the submission apis of the PROJECT. Without this, you will need to enable the database connection so that you can connect this UAG directly to your own database. | true |
| MONGO | (Enterprise Only) Allows you to connect the UAG directly to a mongo database vs. having to redirect the submissions to the Form.io Submission APIs. | |
| MONGO_CONFIG | JSON configuration for the Node.js Mongo Driver. | |
| BASE_URL | The URL that the UAG is hosted on. This allows for proper OIDC authentication and allows for the authentication callbacks to point to the correct url. | https://ai.onform.io |
| LOGIN_FORM | The public url to the Login Form JSON endpoint. | https://mysite.com/project/user/login |
| CORS | The cors domain, or the JSON configuration to configure the "cors" node.js module cross domain resource sharing. | *.* |

## Modules
One of the more powerful ways to "control" and extend the UAG is through the use of Modules. This allows you to provide custom Resources, Forms, as well as custom actions and configurations to ensure that the UAG behaves exactly as you wish for it to behave for your use case.

Extensive documentation for the UAG Module system can be found in the [Modules Readme](./module/Readme.md).

## Using with Form.io Enterprise Server
If you are using the UAG with the Form.io Enterprise Server, you unlock several benefits with regards to managing the Forms and Resources within the UAG. Most of these additional features are unlocked by utilizing the Form.io Enterprise Developer Portal attached to the UAG through the Form.io Staging system. Here is how this works.

### Connecting your Developer Portal to the UAG.
Before you spin up the UAG, you will need to make sure you provide a PORTAL_SECRET environment variable when it is deployed to your own environment. Once you have the UAG running in your own environment with a PORTAL_SECRET, you will now create a new Stage within your Developer portal. We can call this UAG.

![Create UAG Stage](./examples/images/uag-create-stage.png)

Next, you will click on **Staging** and then connect to your UAG server by providing the PORTAL_SECRET as follows.

![Connect to UAG](./examples/images/connect-uag.png)

Now that the UAG is connected, you can then navigate to any Forms and Resources. These are the forms and resources hosted through the UAG.

### Deploying changes to your UAG: Form Versions
Next, you will simply use the existing Staging and Deployment system from your Developer portal to "deploy" any changes to your UAG. This will allow you to treat the UAG just like you would treat any other stage within your Enterprise deployment. This will allow you to track and any forms and resource changes using the Tag system, and then deploy new versions as well as "roll-back" to any previous versions if a change is made that does to perform as you would expect within the AI Agent enviornment. This is a stark contrast to what Enterprises must deal with "Trained Agents" where it is much harder to "roll back" any training that an agent has gone through. 

### Custom Actions
In addition to managing Tags and Versions within the Developer portal, you can also use the Developer Portal to add Custom Actions to any forms and resources. Within the stage that is connected to the UAG, you can navigate to any Form or Resource, and then click on **Actions**.  From there, any actions that show up in the Drop-down list of Actions that you can add to this form, you will see any Custom Actions that are part of your **Module** that you can also attach to your Forms and Resources. From here, you can add custom configurations and settings for each Action instance. It can also be versioned just like any other standard action using the tagging and versioning system.


