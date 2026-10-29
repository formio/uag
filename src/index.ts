import { Server, ServerModule } from '@formio/appserver';
import { formflow } from './formflow';
import { Router } from 'express';
import { UAGProjectInterface } from './UAGProjectInterface';
import { UAGFormInterface } from './UAGFormInterface';
import { defaultsDeep, get, set } from 'lodash';
import { UAGConfig } from './config';
import { loadUAGEngines } from './agent/engines';
import { agentNotFound } from './agent/router';
import { UAGDatabase } from './database';
import { TaskRunStore } from './runs';
import { ActionLogRouter } from './actionLogs';
import { taskRunner } from './runner';
import { RunTaskAction, runTaskHooks } from './actions/runTask';
const debug = require('debug')('formio:uag');
export type UAGModule = ServerModule & {
  config?: UAGConfig;
};

/**
 * Agentic Formflow keeps its license state inside @formio/appserver-core, so the
 * UAG and @formio/appserver must load the same copy of it, at 2.24.1 or later.
 * A second copy (an older lockfile, or a package manager that nests it) would
 * otherwise fail in confusing ways; say what to do instead.
 */
export function assertSingleCore(
  core: any = require('@formio/appserver-core'),
  appserver: any = require('@formio/appserver'),
  version: string = String(require('@formio/appserver-core/package.json').version || '0.0.0')
): void {
  const [major, minor, patch] = version.split('.').map((part: string) => parseInt(part, 10) || 0);
  if (major < 2 || (major === 2 && (minor < 24 || (minor === 24 && patch < 1)))) {
    throw new Error(`@formio/uag needs @formio/appserver-core 2.24.1 or later; ${version} is installed.`);
  }
  if (appserver.Formflow !== core.Formflow || appserver.ProjectInterface !== core.ProjectInterface) {
    throw new Error(
      'Two copies of @formio/appserver-core are installed: one for @formio/uag and an older one for @formio/appserver. ' +
      'Upgrade @formio/appserver to 2.24.1 or later and deduplicate (for example `yarn dedupe @formio/appserver-core`).'
    );
  }
}

/** The UAG's own database from the environment, when `MONGO` is set. */
function databaseFromEnv(env: NodeJS.ProcessEnv = process.env): UAGConfig['database'] {
  const url = get(env, 'MONGO', '').toString();
  if (!url) return undefined;
  const retention = get(env, 'TASK_RUN_RETENTION_DAYS', '').toString();
  return {
    url,
    name: get(env, 'UAG_DATABASE', '').toString() || 'uag',
    config: get(env, 'MONGO_CONFIG', '').toString() || undefined,
    ...(retention && { retentionDays: parseInt(retention, 10) })
  };
}

export class UAGServer extends Server {
  declare config: UAGConfig;
  /** The UAG's own database, once it may be used. */
  public database?: UAGDatabase;
  /** The database between connecting and the license check. */
  private pendingDatabase?: UAGDatabase;

  constructor(config?: UAGConfig) {
    assertSingleCore();
    const configuredDb = !!config?.db;
    const uagLicense = get(process.env, 'UAG_LICENSE', '').toString();
    if (uagLicense) {
      console.warn('[formio-uag] UAG_LICENSE is deprecated. Put a Form.io license that includes the UAG in LICENSE_KEY instead; UAG_LICENSE keeps working until UAG 3.0.');
    }
    super(defaultsDeep(config || {}, {
      baseUrl: get(process.env, 'BASE_URL', '').toString(),
      // Deprecated: core also reads LICENSE_KEY, the Form.io license, and a
      // feature is on when either key grants it.
      license: uagLicense,
      licenseName: 'UAG_LICENSE',
      // The license server counts each UAG environment as a "uagServer", and the
      // UAG runs on the "uag" feature: a key the license server accepts as a
      // uagServer, or one whose terms carry the "uag" option.
      licenseType: 'uagServer',
      licenseFeature: 'uag',
      // A project that is still starting up (a Form.io server in the same compose
      // file, for example) is retried with backoff before the load is given up on.
      retries: parseInt(get(process.env, 'PROJECT_RETRIES', 5).toString(), 10),
      retryDelay: parseInt(get(process.env, 'PROJECT_RETRY_DELAY', 5000).toString(), 10),
      submissionProxy: true,
      processAsClient: true,
      auth: { pkce: true, mcpOAuth: get(process.env, 'MCP_OAUTH', '').toString() === 'true' },
      database: databaseFromEnv()
    }));
    // MONGO is the UAG's own database, not a database for the appserver to keep
    // submissions in: Form.io stores those.
    if (!configuredDb && this.module.db) {
      delete this.module.db;
      delete this.config.db;
    }
    this.use({
      ProjectInterface: UAGProjectInterface,
      FormInterface: UAGFormInterface,
      actions: { agentRunTask: RunTaskAction },
      hooks: runTaskHooks()
    });
  }

  /**
   * Connect the UAG's own database before the project loads, and check it
   * without writing: a database the UAG may not use stops startup. It is used
   * (its collections created, its stores handed out) only once the license is
   * known; see enableDatabase. Until then only the license check may write to
   * it, to record a license server outage.
   */
  protected async connectDatabase(): Promise<void> {
    const options = this.config.database;
    if (!options?.url) {
      console.log('[formio-uag] No database (MONGO): runs after the save are kept in memory, remote MCP sign-in (MCP_OAUTH) is unavailable, ' +
        'and the licensed features turn off at once, with no grace period, whenever the license server cannot be reached.');
      return;
    }
    if (this.database || this.pendingDatabase) return;
    const database = await UAGDatabase.connect(options);
    try {
      await database.inspect();
    }
    catch (err) {
      await database.close().catch(() => {});
      throw err;
    }
    this.pendingDatabase = database;
    this.config.licenseGrace = database.licenseGrace();
  }

  /**
   * Use the database once the project and its license are loaded: with a
   * license that includes the UAG (or the project and the database both on
   * development hosts), create its collections and hand out its stores;
   * otherwise leave it untouched, close it, and say why.
   */
  protected async enableDatabase(project: UAGProjectInterface): Promise<void> {
    const database = this.pendingDatabase;
    this.pendingDatabase = undefined;
    if (database) {
      let refusal = '';
      try {
        project.requireDatabaseLicense(this.config.database!.url);
      }
      catch (err: any) {
        refusal = err?.message || String(err);
      }
      if (refusal) {
        console.warn(`[formio-uag] The database (MONGO) is not used: ${refusal} Runs after the save are kept in memory, and remote MCP sign-in (MCP_OAUTH) is off.`);
        this.config.licenseGrace = undefined;
        await database.close().catch(() => {});
      }
      else {
        await database.bootstrap();
        this.database = database;
        set(this.config, 'auth.authCodeStore', database.authCodeStore());
        taskRunner(project).useStore(new TaskRunStore(database.taskRuns, String(project.project?._id || '')));
        console.log(`[formio-uag] Using the database "${database.name}": runs are recorded, and runs that act with an agent role survive a restart.` +
          (this.config.auth?.mcpOAuth ? ' Remote MCP sign-in (MCP_OAUTH) is on.' : ''));
      }
    }
    if (this.config.auth?.mcpOAuth && !this.database) {
      console.warn('[formio-uag] MCP_OAUTH is set, but remote MCP sign-in is off: it needs the UAG\'s database (MONGO), and a license that includes the UAG to use it.');
    }
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
   * Mount `/agent/capabilities` ahead of the project routes. The project routes,
   * and the admin passthrough after them, would otherwise answer for it and
   * forward admin requests to the Form.io server. A form's agent operations are
   * on the form's own routes.
   */
  protected async extendRouter(router: Router): Promise<void> {
    await super.extendRouter(router);
    const uagProject = this.uagProject;
    if (uagProject) {
      router.use(uagProject.agentRouter());
      // An agent operation of a form the project does not have is answered here, not passed to Form.io.
      router.use(agentNotFound(uagProject));
      // Action Logs in a connected portal stage, with the UAG's run records.
      router.use(ActionLogRouter(uagProject));
    }
  }

  async router() {
    await this.connectDatabase();
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
          'hosted service, or PROJECT_KEY plus a license (LICENSE_KEY) for a self-hosted Enterprise project. ' +
          'Earlier log lines report why the project load failed.'
      );
    }
    // A database of the UAG's own needs the license, on every edition.
    await this.enableDatabase(uagProject);
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
      const hosted = formflowState.reason === 'hosted' ? ', on Form.io\'s hosted service (no license needed)' : '';
      const reason = formflowState.licensedBy ? `licensed by ${formflowState.licensedBy}` : formflowState.reason;
      console.log(`[formio-uag] ${formflowState.edition === 'enterprise' ? 'Enterprise' : 'Open Source'} edition${hosted}. Agentic Formflow ` +
        (formflowState.allowed ? `is enabled (${reason}).` : 'requires a license (LICENSE_KEY) that includes the UAG, or a project on Form.io\'s hosted service; MCP and conversation forms are unaffected.'));
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
