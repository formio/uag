import { Server, ServerModule } from '@formio/appserver';
import { UAGProjectInterface } from './UAGProjectInterface';
import { UAGFormInterface } from './UAGFormInterface';
import { defaultsDeep, get } from 'lodash';
import { UAGConfig } from './config';
export type UAGModule = ServerModule & {
  config?: UAGConfig;
};

export class UAGServer extends Server {
  constructor(config?: UAGConfig) {
    super(defaultsDeep(config || {}, {
      baseUrl: get(process.env, 'BASE_URL', '').toString(),
      license: get(process.env, 'UAG_LICENSE', '').toString(),
      submissionProxy: true,
      processAsClient: true,
      auth: { pkce: true }
    }));
    this.use({
      ProjectInterface: UAGProjectInterface,
      FormInterface: UAGFormInterface
    });
  }

  async router() {
    const router = await super.router();
    const uagProject = Object.values(this.projectRouter?.projects || {})[0] as UAGProjectInterface;
    // Without a project there are no forms to expose, so there is nothing to
    // serve. Say why: this used to throw "Cannot read properties of undefined
    // (reading 'uagRouter')", which told the operator nothing about the
    // misconfiguration that caused it.
    if (!uagProject) {
      throw new Error(
        'No Form.io project could be loaded, so the UAG has nothing to serve. Check that PROJECT ' +
          'points at a reachable Form.io deployment, and that it is paired with the right ' +
          'credential — ADMIN_KEY for an Open Source server, or PROJECT_KEY plus UAG_LICENSE for ' +
          'an Enterprise project. Earlier log lines report why the project load failed.'
      );
    }
    router.use(uagProject.uagRouter());
    return router;
  }
}

export * from '@formio/appserver';
export * from './config';
export * from './tools';
export * from './router';
export * from './template';
export { UAGProjectInterface, UAGFormInterface };
