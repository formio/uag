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
      submissionProxy: true,
      auth: { pkce: true }
    }));
    this.use({
      ProjectInterface: UAGProjectInterface,
      FormInterface: UAGFormInterface
    });
  }
}

export * from '@formio/appserver';
export * from './config';
export * from './tools';
export * from './router';
export * from './template';
export { UAGProjectInterface, UAGFormInterface };
