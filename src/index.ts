import { Server, ServerModule } from '@formio/appserver';
import { formflow } from './formflow';
import { Request, Response, Router } from 'express';
import path from 'path';
import { UAGProjectInterface } from './UAGProjectInterface';
import { UAGFormInterface } from './UAGFormInterface';
import { defaultsDeep, get, set } from 'lodash';
import { UAGConfig } from './config';
import { loadUAGEngines } from './agent/engines';
import { agentNotFound } from './agent/router';
import { agentErrorShape, errorBody, isAgentApiRequest, requestIdOf } from './agent/errors';
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
 * Agentic Formflow keeps its license state inside @formio/appserver-core. The UAG
 * loads it only through @formio/appserver, so the two always share one copy,
 * which must be 2.25.2 or later. An older @formio/appserver, or an old lockfile,
 * can still resolve an older one, which would fail in confusing ways; say what
 * to do instead.
 */
export function assertSingleCore(version: string = appserverCoreVersion()): void {
  const [major, minor, patch] = version.split('.').map((part: string) => parseInt(part, 10) || 0);
  if (major < 2 || (major === 2 && (minor < 25 || (minor === 25 && patch < 2)))) {
    throw new Error(`@formio/uag needs @formio/appserver-core 2.25.2 or later, through @formio/appserver; ${version} is installed. Upgrade @formio/appserver.`);
  }
}

/** The version of the @formio/appserver-core that @formio/appserver loads. */
function appserverCoreVersion(): string {
  const appserver = path.dirname(require.resolve('@formio/appserver/package.json'));
  return String(require(require.resolve('@formio/appserver-core/package.json', { paths: [appserver] })).version || '0.0.0');
}

/**
 * isolated-vm, which runs form logic, needs Node's startup snapshot off. Without
 * it nothing fails at once: the process can crash later, in native code. So an
 * embedding server that forgot the flag is stopped here, saying what to do.
 */
export function assertNodeSnapshotDisabled(execArgv: string[] = process.execArgv, nodeOptions: string = process.env.NODE_OPTIONS || ''): void {
  if (execArgv.includes('--no-node-snapshot') || /(^|\s)--no-node-snapshot(\s|$)/.test(nodeOptions)) return;
  throw new Error('@formio/uag needs Node started with --no-node-snapshot: isolated-vm, which runs form logic, can crash the process without it. ' +
    'Start node with --no-node-snapshot, or set NODE_OPTIONS=--no-node-snapshot. The uag command and the formio/uag image do this for you.');
}

/** A host name a browser cannot reach: a container or service name, with no dot. */
function internalHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return !!hostname && hostname !== 'localhost' && !hostname.includes('.') && !hostname.includes(':');
  }
  catch {
    return false;
  }
}

/** Warnings for settings that start fine and fail later, in ways far from their cause. */
function warnAboutSettings(config: UAGConfig, secretGiven: boolean): void {
  if (!secretGiven) {
    console.warn('[formio-uag] JWT_SECRET is not set, so the UAG signs its tokens with a random secret that lasts only as long as this process: ' +
      'every token stops working when it restarts, and other instances refuse it. Set JWT_SECRET, the same on every instance.');
  }
  const auth: any = config.auth || {};
  if (auth.mcpOAuth && !auth.loginForm && internalHost(String(config.project || ''))) {
    console.warn(`[formio-uag] MCP_OAUTH is on, but LOGIN_FORM is not set: the sign-in page loads ${String(config.project).replace(/\/+$/, '')}/user/login, ` +
      'an address a person\'s browser cannot reach. Set LOGIN_FORM to the login form\'s public URL.');
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
    assertNodeSnapshotDisabled();
    assertSingleCore();
    const configuredDb = !!config?.db;
    // Read before the server fills in a random one.
    const secretGiven = !!(config?.auth?.secret || get(process.env, 'JWT_SECRET', '').toString());
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
      // Bodies are parsed before authentication, so keep them to what Form.io accepts.
      maxBodySize: get(process.env, 'MAX_BODY_SIZE', '16mb').toString(),
      auth: { pkce: true, mcpOAuth: get(process.env, 'MCP_OAUTH', '').toString() === 'true' },
      database: databaseFromEnv()
    }));
    // MONGO is the UAG's own database, not a database for the appserver to keep
    // submissions in: Form.io stores those.
    if (!configuredDb && this.module.db) {
      delete this.module.db;
      delete this.config.db;
    }
    warnAboutSettings(this.config, secretGiven);
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

  /**
   * An Agent API request that failed before its handlers (a body that is not JSON,
   * one over the size limit) is answered in the Agent API's error shape; every other
   * route keeps Form.io's plain-text answer.
   */
  protected sendError(req: Request, res: Response, status: number, message: string, err?: any): void {
    if (!isAgentApiRequest(req)) return super.sendError(req, res, status, message, err);
    const error = err?.type === 'entity.parse.failed' ? 'The request body is not valid JSON.' : message;
    // Written past any shaping wrapper, which may not have run for this request.
    res.status(status).type('application/json').end(JSON.stringify(errorBody(requestIdOf(req, res), status, { error })));
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
      // First: the Agent API's request id and one error shape, for every refusal after it.
      router.use(agentErrorShape());
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
