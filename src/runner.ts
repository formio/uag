import { AuthRequest } from '@formio/appserver';
import { formflow, FormflowError, identityOf } from './formflow';
import type { CallerIdentity, FormflowForm } from './formflow';
import { ActingFor, agentAuth, refusedSignedToken, userAuth } from './identity';
import { RENEW_MS, TaskRunRecord, TaskRunStore } from './runs';
import { withRequestId } from './agent/requestId';
import type { ObjectId } from 'mongodb';
import type { UAGProjectInterface } from './UAGProjectInterface';
const debug = require('debug')('formio:uag:runner');

/** A Run task action's run after the save, on the submission Form.io stored. */
export type TaskRunJob = {
    /** The form's name. */
    form: string;
    submission: string;
    task: string;
    answer: 'decisions' | 'task';
    /** The user the run acts for: who sent the submission. Never a token. */
    actingFor: ActingFor;
    /**
     * The role the agent acts with at Form.io, on the user's behalf. Such runs
     * can be recorded and resumed: everything they need is in the job.
     */
    agentRole?: string;
    /**
     * Without an agent role, the caller's own identity (with their token), kept
     * in memory only and never recorded.
     */
    caller?: AuthRequest;
    /** Without an agent role, who the engines research as (the caller's bearer token, if any). */
    identity?: CallerIdentity;
    /**
     * Without an agent role or the caller's token: act as the user, with their
     * recorded roles and tokens the UAG signs. A run started by the save of a
     * run that acted with an agent role, so it never inherits that role.
     */
    asUser?: boolean;
    /** How many runner saves led to this run: none for a run a client's request started. */
    chain?: number;
    /** The action that started the run, for the record. */
    action?: string;
    /** For the record: the form's id, and the method that started the run. */
    formId?: string;
    method?: string;
    /** The X-Request-Id of the request that started the run, passed on to the engines. */
    requestId?: string;
};

export type TaskRunOutcome = {
    status: 'done' | 'failed';
    /** Paths written, with their values, and paths cleared. Empty when nothing changed. */
    written: Record<string, any>;
    cleared: string[];
    /** The engines and models that answered. */
    engines: { kind: string; engine: string | null; model: string | null }[];
    /** Whether the results were saved (nothing is saved when nothing changed). */
    saved: boolean;
    error?: string;
};

/**
 * The request field that marks the runner's own save, so the form's Run task
 * actions that run before the save skip it: its data is the agent's output.
 */
export const RUN_TASK_SAVE = 'uagRunTaskSave';

/**
 * The request fields that carry, through the runner's own save, who the run
 * acts for, so a Run task action that the save starts acts for the same user.
 */
export const RUN_TASK_ACTING_FOR = 'uagActingFor';
export const RUN_TASK_CALLER = 'uagCaller';
export const RUN_TASK_REQUEST_ID = 'uagRequestId';
export const RUN_TASK_IDENTITY = 'uagIdentity';
export const RUN_TASK_AS_USER = 'uagAsUser';
export const RUN_TASK_CHAIN = 'uagChain';

/**
 * Runs a runner's save may start in a row: a task whose save starts a task
 * that changes something each time would otherwise never stop.
 */
export const MAX_CHAIN = 5;

const DEFAULT_CONCURRENCY = 4;
/** How often a replica looks for runs that are pending or lost their replica. */
export const SWEEP_MS = 60 * 1000;

/**
 * Runs Run task actions' background runs: load the stored submission, run the
 * task, and save only what changed, as an update through the UAG's own
 * pipeline (so the form's update actions, including other Run task actions,
 * run on it). If the submission changes while the task runs, the run starts
 * again once on the new version, then gives up as a conflict.
 *
 * Without the UAG's database, runs are kept in memory, a few at a time, and
 * are lost if the process stops. With it, every run is recorded; a run that
 * acts with an agent role is recorded as pending before the caller's response
 * and taken from the database by one replica at a time, under a lease it
 * renews, so it survives a restart. A sweep at startup and every minute takes
 * runs that are pending or whose replica stopped.
 */
export class TaskRunner {
    private queue: { job: TaskRunJob; record?: ObjectId }[] = [];
    private active = 0;
    private waiting: (() => void)[] = [];
    private store?: TaskRunStore;
    private sweeper?: ReturnType<typeof setInterval>;
    private sweeping = false;

    constructor(private project: UAGProjectInterface, private concurrency: number = DEFAULT_CONCURRENCY) {}

    /** Whether runs acting with an agent role are recorded and survive a restart. */
    get durable(): boolean {
        return !!this.store;
    }

    /** Record runs in the UAG's database, and take durable runs from it. */
    useStore(store: TaskRunStore): void {
        this.store = store;
        this.stop();
        this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
        this.sweeper.unref?.();
        this.sweep();
    }

    /** Stop sweeping (the runs in progress finish). */
    stop(): void {
        if (this.sweeper) clearInterval(this.sweeper);
        this.sweeper = undefined;
    }

    /** The project's run records, when there is a database. */
    get records(): TaskRunStore | undefined {
        return this.store;
    }

    /**
     * Start a run. A durable run is recorded as pending before this resolves, so
     * the caller's response is sent only once it can survive a restart.
     */
    async enqueue(job: TaskRunJob): Promise<void> {
        if (this.store) {
            const durable = !!job.agentRole;
            try {
                const record = await this.store.add(this.newRecord(job, durable));
                if (durable) {
                    this.sweep();
                    return;
                }
                this.queue.push({ job, record });
            }
            catch (err: any) {
                console.error(`[formio-uag] Run task "${job.task}" could not be recorded (${err?.message || err}); it runs in memory.`);
                this.queue.push({ job });
            }
        }
        else {
            this.queue.push({ job });
        }
        this.drain();
    }

    /** Record a run made before the save, once the save gave the submission its id. */
    async recordBefore(job: TaskRunJob, outcome: TaskRunOutcome): Promise<void> {
        if (!this.store) return;
        try {
            const record = await this.store.add({ ...this.newRecord(job, false, 'before'), status: 'running' });
            await this.store.finish(record, resultOf(outcome));
        }
        catch (err: any) {
            debug(`Could not record a run before the save: ${err?.message || err}`);
        }
    }

    private newRecord(job: TaskRunJob, durable: boolean, handler: 'before' | 'after' = 'after') {
        return {
            project: String(this.project.project?._id || ''),
            form: job.formId || '',
            formName: job.form,
            submission: job.submission,
            action: job.action || 'Agent: Run task',
            task: job.task,
            answer: job.answer,
            handler,
            method: job.method || 'create',
            durable,
            actingFor: job.actingFor,
            ...(job.agentRole && { agentRole: job.agentRole }),
            ...(job.requestId && { requestId: job.requestId }),
            ...(job.chain && { chain: job.chain }),
            status: (durable ? 'pending' : 'running') as 'pending' | 'running'
        };
    }

    /** Resolves once every queued and running job has finished (for tests and shutdown). */
    idle(): Promise<void> {
        if (this.isIdle()) return Promise.resolve();
        return new Promise((resolve) => this.waiting.push(resolve));
    }

    private isIdle(): boolean {
        return !this.active && !this.queue.length && !this.sweeping;
    }

    private settled(): void {
        if (this.isIdle()) this.waiting.splice(0).forEach((resolve) => resolve());
    }

    private drain(): void {
        while (this.active < this.concurrency && this.queue.length) {
            const { job, record } = this.queue.shift()!;
            this.track(job, record ? (outcome) => this.store!.finish(record, resultOf(outcome)) : undefined);
        }
    }

    /** Take durable runs from the database while there is room. */
    private async sweep(): Promise<void> {
        if (!this.store || this.sweeping) return;
        this.sweeping = true;
        try {
            while (this.active < this.concurrency) {
                const record = await this.store.claim();
                if (!record) break;
                this.runRecord(record);
            }
        }
        catch (err: any) {
            debug(`Could not take runs from the database: ${err?.message || err}`);
        }
        finally {
            this.sweeping = false;
            this.settled();
        }
    }

    private runRecord(record: TaskRunRecord): void {
        const store = this.store!;
        const renewal = setInterval(() => store.renew(record._id).catch(() => {}), RENEW_MS);
        renewal.unref?.();
        this.track(jobOf(record), (outcome) => store.finish(record._id, resultOf(outcome)), () => {
            clearInterval(renewal);
            this.sweep();
        });
    }

    /** Run a job, report it, and record its end. */
    private track(job: TaskRunJob, finish?: (outcome: TaskRunOutcome) => Promise<void>, done?: () => void): void {
        this.active++;
        // Engines (the remote type) send the id of the request that started the run.
        withRequestId(job.requestId, () => this.execute(job))
            .catch((err): TaskRunOutcome => ({ status: 'failed', written: {}, cleared: [], engines: [], saved: false, error: err?.message || String(err) }))
            .then(async (outcome) => {
                this.report(job, outcome);
                await finish?.(outcome).catch((err) => debug(`Could not record the end of a run: ${err?.message || err}`));
            })
            .finally(() => {
                this.active--;
                done?.();
                this.drain();
                this.settled();
            });
    }

    protected report(job: TaskRunJob, outcome: TaskRunOutcome): void {
        if (outcome.status === 'failed') {
            console.error(`[formio-uag] Run task "${job.task}" failed for submission ${job.submission} of "${job.form}": ${outcome.error}`);
        }
        else {
            debug(`Run task "${job.task}" on ${job.form}/${job.submission}: ${outcome.saved ? `saved ${Object.keys(outcome.written).length} field(s)` : 'nothing changed'}`);
        }
    }

    /**
     * Who the job acts as at Form.io (`act`: a new identity for each request,
     * since signed tokens are short-lived), and who its engines research as.
     * Never the project's key: the agent role's signed token, or the caller's own.
     */
    private async identities(job: TaskRunJob) {
        if (job.agentRole) {
            const claim = { action: job.action, task: job.task };
            const research = await userAuth(this.project, job.actingFor, claim);
            return {
                act: () => agentAuth(this.project, job.actingFor, job.agentRole!, claim),
                research,
                identity: identityOf(research, `Bearer ${research.token}`)
            };
        }
        if (job.asUser) {
            const claim = { action: job.action, task: job.task };
            const research = await userAuth(this.project, job.actingFor, claim);
            return {
                act: () => userAuth(this.project, job.actingFor, claim),
                research,
                identity: identityOf(research, `Bearer ${research.token}`)
            };
        }
        if (!job.caller) throw new FormflowError(500, 'A run without an agent role needs the caller\'s identity.');
        const caller = job.caller;
        return { act: async () => caller.clone(), research: caller, identity: job.identity };
    }

    /**
     * Why Form.io refused the agent's signed token, when it did: asks Form.io who
     * the token is, so a JWT_SECRET that is not Form.io's is told apart from
     * other failures.
     */
    private async refusal(job: TaskRunJob): Promise<Error | null> {
        if (!job.agentRole || !this.project.endpoint) return null;
        try {
            const auth = await agentAuth(this.project, job.actingFor, job.agentRole, { action: job.action, task: job.task });
            const response = await fetch(`${this.project.endpoint}/current`, { headers: { 'x-jwt-token': auth.token || '', Accept: 'application/json' } });
            return refusedSignedToken(response.status);
        }
        catch {
            return null;
        }
    }

    /** Run one job to completion. */
    async execute(job: TaskRunJob): Promise<TaskRunOutcome> {
        try {
            return await this.run(job);
        }
        catch (err) {
            throw (await this.refusal(job)) || err;
        }
    }

    private async run(job: TaskRunJob): Promise<TaskRunOutcome> {
        const form = await this.project.formflowForm(job.form);
        if (!form) throw new FormflowError(404, `The form "${job.form}" was not found.`);
        const { act, research, identity } = await this.identities(job);
        const service = formflow(this.project);
        const load = async () => {
            const stored = await form.loadSubmission(job.submission, await act());
            if (!stored) throw new FormflowError(404, `Submission "${job.submission}" was not found.`);
            return stored as any;
        };
        let stored = await load();
        for (let attempt = 1; ; attempt++) {
            const run = await service.runTask(form as FormflowForm, job.task, stored, research, { answer: job.answer, stored: true, identity, requestId: job.requestId });
            const engines = run.results.map((result) => ({ kind: result.kind, engine: result.engine ?? null, model: result.model ?? null }));
            const failed = run.failed.map((group) => group.error || 'no engine could answer').join('; ');
            const changed = Object.keys(run.written).length > 0 || run.cleared.length > 0;
            if (!changed) {
                return { status: failed ? 'failed' : 'done', written: {}, cleared: [], engines, saved: false, ...(failed && { error: failed }) };
            }
            try {
                // Only the task's fields changed; `modified` refuses the save if a person saved in the meantime.
                await form.submit({ _id: stored._id, modified: stored.modified, data: run.submission.data, metadata: run.submission.metadata }, await act(), {
                    [RUN_TASK_SAVE]: true,
                    [RUN_TASK_ACTING_FOR]: job.actingFor,
                    ...(job.requestId && { [RUN_TASK_REQUEST_ID]: job.requestId }),
                    // The runs this save starts act as the user, never with this run's agent role.
                    ...(job.caller ? { [RUN_TASK_CALLER]: job.caller, [RUN_TASK_IDENTITY]: job.identity } : { [RUN_TASK_AS_USER]: true }),
                    [RUN_TASK_CHAIN]: (job.chain || 0) + 1
                });
                return { status: failed ? 'failed' : 'done', written: run.written, cleared: run.cleared, engines, saved: true, ...(failed && { error: failed }) };
            }
            catch (err: any) {
                if (err?.name !== 'ConflictError' || attempt >= 2) {
                    if (err?.name === 'ConflictError') {
                        throw new FormflowError(409, 'The submission changed while its task was running, and again on the second try. Nothing was saved.');
                    }
                    throw err;
                }
                stored = await load();
            }
        }
    }
}

/** What a record keeps of a run's outcome: paths, never values. */
function resultOf(outcome: TaskRunOutcome) {
    return {
        status: outcome.status,
        engines: outcome.engines,
        written: Object.keys(outcome.written),
        cleared: outcome.cleared,
        saved: outcome.saved,
        ...(outcome.error && { error: outcome.error })
    };
}

/** The job a durable record describes. */
function jobOf(record: TaskRunRecord): TaskRunJob {
    return {
        form: record.formName,
        formId: record.form,
        submission: record.submission!,
        task: record.task,
        answer: record.answer,
        actingFor: record.actingFor,
        agentRole: record.agentRole,
        action: record.action,
        method: record.method,
        ...(record.requestId && { requestId: record.requestId }),
        ...(record.chain && { chain: record.chain })
    };
}

/** The project's runner, created on first use. */
const runners = new WeakMap<object, TaskRunner>();
export function taskRunner(project: UAGProjectInterface): TaskRunner {
    let runner = runners.get(project);
    if (!runner) {
        runner = new TaskRunner(project);
        runners.set(project, runner);
    }
    return runner;
}
