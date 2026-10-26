import { Server, ServerModule } from '@formio/appserver';
import { AgentDecideAction, formflow } from './formflow';
import { Router } from 'express';
import { UAGProjectInterface } from './UAGProjectInterface';
import { UAGFormInterface } from './UAGFormInterface';
import { defaultsDeep, get } from 'lodash';
import { UAGConfig } from './config';
import { loadUAGEngines } from './agent/engines';
const debug = require('debug')('formio:uag');
export type UAGModule = ServerModule & {
  config?: UAGConfig;
};

/**
 * Agentic Formflow keeps its license state inside @formio/appserver-core, so the
 * UAG and @formio/appserver must load the same copy of it, at 2.20.0 or later.
 * A second copy (an older lockfile, or a package manager that nests it) would
 * otherwise fail in confusing ways; say what to do instead.
 */
export function assertSingleCore(
  core: any = require('@formio/appserver-core'),
  appserver: any = require('@formio/appserver'),
  version: string = String(require('@formio/appserver-core/package.json').version || '0.0.0')
): void {
  const [major, minor] = version.split('.').map((part: string) => parseInt(part, 10));
  if (major < 2 || (major === 2 && minor < 20)) {
    throw new Error(`@formio/uag needs @formio/appserver-core 2.20.0 or later; ${version} is installed.`);
  }
  if (appserver.Formflow !== core.Formflow || appserver.ProjectInterface !== core.ProjectInterface) {
    throw new Error(
      'Two copies of @formio/appserver-core are installed: one for @formio/uag and an older one for @formio/appserver. ' +
      'Upgrade @formio/appserver to 2.20.0 or later and deduplicate (for example `yarn dedupe @formio/appserver-core`).'
    );
  }
}

export class UAGServer extends Server {
  constructor(config?: UAGConfig) {
    assertSingleCore();
    super(defaultsDeep(config || {}, {
      baseUrl: get(process.env, 'BASE_URL', '').toString(),
      license: get(process.env, 'UAG_LICENSE', '').toString(),
      // A project that is still starting up (a Form.io server in the same compose
      // file, for example) is retried with backoff before the load is given up on.
      retries: parseInt(get(process.env, 'PROJECT_RETRIES', 5).toString(), 10),
      retryDelay: parseInt(get(process.env, 'PROJECT_RETRY_DELAY', 5000).toString(), 10),
      submissionProxy: true,
      processAsClient: true,
      auth: { pkce: true }
    }));
    this.use({
      ProjectInterface: UAGProjectInterface,
      FormInterface: UAGFormInterface,
      actions: { agentDecide: AgentDecideAction }
    });
  }

  /** Browsers reading Agent API responses need the request id too. */
  get exposedHeaders(): string[] {
    return [...super.exposedHeaders, 'X-Request-Id'];
  }

  /** The loaded UAG project, once the project router has been built. */
  get uagProject(): UAGProjectInterface | undefined {
    return Object.values(this.projectRouter?.projects || {})[0] as UAGProjectInterface | undefined;
  }

  /**
   * Mount the Agent API ahead of the project routes. The project routes, and
   * the admin passthrough after them, would otherwise answer for `/agent/*`
   * and forward admin requests to the Form.io server.
   */
  protected async extendRouter(router: Router): Promise<void> {
    await super.extendRouter(router);
    const uagProject = this.uagProject;
    if (uagProject) {
      router.use(uagProject.agentRouter());
    }
  }

  async router() {
    const router = await super.router();
    const uagProject = this.uagProject;
    // Without a project there are no forms to expose, so there is nothing to
    // serve. Say why: this used to throw "Cannot read properties of undefined
    // (reading 'uagRouter')", which told the operator nothing about the
    // misconfiguration that caused it.
    if (!uagProject) {
      throw new Error(
        'No Form.io project could be loaded, so the UAG has nothing to serve. Check that PROJECT ' +
          'points at a reachable Form.io deployment, and that it is paired with the right ' +
          'credential — ADMIN_KEY for an Open Source server, PROJECT_KEY for a project on Form.io\'s ' +
          'hosted service, or PROJECT_KEY plus UAG_LICENSE for a self-hosted Enterprise project. ' +
          'Earlier log lines report why the project load failed.'
      );
    }
    // Decide which engines are on before serving anything, so a misconfigured
    // engine stops startup with its name in the error instead of failing the
    // first request.
    uagProject.engines = await loadUAGEngines(uagProject.config || {}, process.env);
    // Say which edition this is, and whether Agentic Formflow will run, so an
    // operator knows before the first request is refused.
    // A failure here only loses the message; it never stops the UAG starting.
    try {
      const formflowState = await formflow(uagProject).state();
      // A project on Form.io's hosted service runs under Form.io's license.
      const hosted = formflowState.reason === 'hosted' ? ', on Form.io\'s hosted service (no UAG_LICENSE needed)' : '';
      console.log(`[formio-uag] ${formflowState.edition === 'enterprise' ? 'Enterprise' : 'Open Source'} edition${hosted}. Agentic Formflow ` +
        (formflowState.allowed ? `is enabled (${formflowState.reason}).` : 'requires a UAG_LICENSE with the "uag" feature, or a project on Form.io\'s hosted service; MCP and conversation forms are unaffected.'));
    }
    catch (err: any) {
      debug(`Could not report the edition: ${err?.message || err}`);
    }
    router.use(uagProject.uagRouter(false));
    return router;
  }
}

export * from '@formio/appserver';
export * from './config';
export * from './agent';
export * from './tools';
export * from './router';
export * from './template';
export { UAGProjectInterface, UAGFormInterface };
