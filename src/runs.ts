import { randomUUID } from 'crypto';
import { Collection, ObjectId } from 'mongodb';
import type { ActingFor } from './identity';

/**
 * Run task records in the UAG's database (`uag-taskruns`): one per run, for
 * audit (Action Logs), and, for runs that act with an agent role, the queue
 * that lets a run survive a restart and be taken by one replica at a time.
 * A record never holds a token.
 */

export type TaskRunStatus = 'pending' | 'running' | 'done' | 'failed';

export type TaskRunRecord = {
    _id: ObjectId;
    project: string;
    /** The form's id, and its name for the runner. */
    form: string;
    formName: string;
    submission?: string;
    /** The action's title, and the task it runs. */
    action: string;
    task: string;
    answer: 'decisions' | 'task';
    /** When it ran: before the save, or after it. */
    handler: 'before' | 'after';
    method: string;
    /** Resumed after a restart (it acts with an agent role). */
    durable: boolean;
    actingFor: ActingFor;
    /** The X-Request-Id of the request that started the run. */
    requestId?: string;
    agentRole?: string;
    /** How many runner saves led to this run. */
    chain?: number;
    status: TaskRunStatus;
    attempts: number;
    owner?: string;
    leaseUntil?: Date;
    engines?: { kind: string; engine: string | null; model: string | null }[];
    written?: string[];
    cleared?: string[];
    /** Paths whose answers the form's validation refused, left out of the save. */
    refused?: string[];
    saved?: boolean;
    error?: string;
    created: Date;
    modified: Date;
    started?: Date;
    finished?: Date;
};

export type NewTaskRun = Omit<TaskRunRecord, '_id' | 'attempts' | 'created' | 'modified' | 'status'> & { status?: TaskRunStatus };

/** How long a replica holds a run before another may take it over, and how often it renews. */
export const LEASE_MS = 2 * 60 * 1000;
export const RENEW_MS = 30 * 1000;
/** Attempts before a run that keeps losing its replica is given up. */
export const MAX_ATTEMPTS = 3;

export class TaskRunStore {
    /** This replica, as the owner of the runs it holds. */
    readonly owner = randomUUID();

    /**
     * `project` limits the durable runs this replica takes to its project's:
     * UAGs of different projects may share one database.
     */
    constructor(readonly collection: Collection<TaskRunRecord>, readonly project?: string) {}

    private get scope(): Record<string, string> {
        return this.project === undefined ? {} : { project: this.project };
    }

    async add(run: NewTaskRun): Promise<ObjectId> {
        const now = new Date();
        const record = { ...run, _id: new ObjectId(), status: run.status || 'pending', attempts: 0, created: now, modified: now } as TaskRunRecord;
        await this.collection.insertOne(record);
        return record._id;
    }

    /**
     * Take the oldest durable run that is pending, or whose holder's lease ran
     * out, for this replica. Only one replica can take a run.
     */
    async claim(now = new Date()): Promise<TaskRunRecord | null> {
        await this.giveUp(now);
        return this.collection.findOneAndUpdate(
            {
                ...this.scope,
                durable: true,
                attempts: { $lt: MAX_ATTEMPTS },
                $or: [{ status: 'pending' }, { status: 'running', leaseUntil: { $lt: now } }]
            },
            { $set: { status: 'running', owner: this.owner, leaseUntil: new Date(now.getTime() + LEASE_MS), started: now, modified: now }, $inc: { attempts: 1 } },
            { sort: { created: 1 }, returnDocument: 'after' }
        );
    }

    /** Fail the runs that lost their replica too many times. */
    private async giveUp(now: Date): Promise<void> {
        await this.collection.updateMany(
            { ...this.scope, durable: true, status: 'running', leaseUntil: { $lt: now }, attempts: { $gte: MAX_ATTEMPTS } },
            { $set: { status: 'failed', error: `The run was given up after ${MAX_ATTEMPTS} attempts.`, finished: now, modified: now }, $unset: { leaseUntil: '', owner: '' } }
        );
    }

    /** Keep holding a run. False when another replica took it over. */
    async renew(id: ObjectId): Promise<boolean> {
        const now = new Date();
        const result = await this.collection.updateOne({ _id: id, owner: this.owner, status: 'running' }, { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), modified: now } });
        return result.matchedCount > 0;
    }

    /** Record how a run ended. Only the replica holding a durable run can. */
    async finish(id: ObjectId, result: Pick<TaskRunRecord, 'engines' | 'written' | 'cleared' | 'refused' | 'saved' | 'error'> & { status: 'done' | 'failed' }): Promise<void> {
        const now = new Date();
        await this.collection.updateOne(
            { _id: id, $or: [{ durable: false }, { owner: this.owner }] },
            { $set: { ...result, finished: now, modified: now }, $unset: { leaseUntil: '', owner: '' } }
        );
    }

    async get(id: string): Promise<TaskRunRecord | null> {
        if (!ObjectId.isValid(id)) return null;
        return this.collection.findOne({ _id: new ObjectId(id) });
    }

    /** The project's records matching a filter, newest change first. */
    async list(filter: Record<string, any>, limit: number): Promise<{ items: TaskRunRecord[]; total: number }> {
        const [items, total] = await Promise.all([
            // A limit of 0 would be none at all to MongoDB.
            limit > 0 ? this.collection.find(filter).sort({ modified: -1 }).limit(limit).toArray() : Promise.resolve([]),
            this.collection.countDocuments(filter)
        ]);
        return { items, total };
    }
}
