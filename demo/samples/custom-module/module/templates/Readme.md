## UAG Response Templates

<sub>[Form.io UAG](../../../../../README.md) &rsaquo; this page</sub>

A major part of the UAG (Universal Agent Gateway) is to respond to tools with responses that the LLM can understand. To simplify the development of these templates, we leverage Lodash templates to provide advanced templating for the responses to the the tools.

### Overriding Templates
You can override existing templates (found in the src/templates folder) by providing the same key.

For example, if you wish to change the response for the "get_forms" tool (found at **src/tools/getForms.ts**), you can find the template that this tool uses by looking at the following code in that file.

```ts
return project.mcpResponse(ResponseTemplate.getAvailableForms, {
    forms: forms.map(form => {
        const perms = extra.authInfo.formPermissions(form);
        const hasAccess = perms.create || perms.update || perms.read;
        const uagForm = (form as UAGFormInterface).uag;
        return {
            name: uagForm?.name,
            title: uagForm?.title,
            description: uagForm?.description || `Form for ${uagForm?.title} data entry`,
            permissions: perms,
            hasAccess
        };
    }),
    totalForms: forms.length
});
```

If we look at the **src/templates** folder, you will see the markdown file that coorelates with this response. The names of the files match the name of the template, so the template for this response is found at **src/templates/getAvailableForms.md**.  If you wish to override this response template, simply copy this file and place it inside of the modules template folder.  You then just need to ensure you provide the same key in the **responseTemplates** configuration as follows.

```ts
const fs = require('fs');
const path = require('path');
const Express = require('express');
const { UAGServer } = require('@formio/uag');
(async function() {
    const server = new UAGServer();
    server.use({
        config: {
            responseTemplates: {
                getAvailableForms: fs.readFileSync(path.join(__dirname, 'templates/getAvailableForms.md'), 'utf-8')
            }
        }
    });
    const app = Express();
    app.use(await server.router());
    const port = process.env.PORT || 3200;
    app.listen(port, () => {
        console.log(`Form.io UAG server running on port ${port}`);
        console.log(`Visit http://localhost:${port} to access the application`);
    });
})();
```

### Creating new templates
There may be a case where you need to introduce new tools or different reponses and may need to add new templates. To do this, you simply need to add the custom template to a "key" that is not defined in the ResponseTemplate enum found within the **src/template.ts** file.

For example, the following defines a new tool that responds with a custom template. It assumes you have written the template to `templates/custom.md`.

Each entry in `config.tools` is a plain tool object (`ToolInfo`), not a function. Give every tool `annotations` that say whether it reads or writes, using the `reads`, `creates` or `overwrites` presets. Tools without annotations are treated as writes, and only tools marked read-only are offered to `/agent/provide` tasks.

```ts
import * as fs from 'fs';
import * as path from 'path';
import Express from 'express';
import { UAGServer, ToolInfo, ResponseTemplate, reads } from '@formio/uag';
(async function() {
    const server = new UAGServer();
    const customTool: ToolInfo = {
        name: 'custom_tool',
        title: 'Do something custom',
        description: 'Only execute this tool if the user says "Do something custom!"',
        annotations: reads('Do something custom'),
        inputSchema: {},
        execute: async () => {
            // The project is loaded by server.router(), before any tool is called.
            // A custom key is not in the ResponseTemplate enum, hence the cast.
            return server.uagProject!.mcpResponse('custom' as ResponseTemplate);
        }
    };
    server.use({
        config: {
            responseTemplates: {
                custom: fs.readFileSync(path.join(__dirname, 'templates/custom.md'), 'utf-8')
            },
            tools: [customTool]
        }
    });
    const app = Express();
    app.use(await server.router());
    const port = process.env.PORT || 3200;
    app.listen(port, () => {
        console.log(`Form.io UAG server running on port ${port}`);
        console.log(`Visit http://localhost:${port} to access the application`);
    });
})();
```
