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
