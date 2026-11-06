import { ObjectId } from 'mongodb';
import type { ActingFor } from './identity';
import { LEASE_MS, MAX_ATTEMPTS, RENEW_MS } from './formflow';
import type { CoreNewTaskRun, CoreTaskRunRecord, CoreTaskRunStore, TaskRunStatus } from './formflow';

/**
 * Run task records in the UAG's database (`uag-taskruns`): one per run, for
 * audit (Action Logs), and, for runs that act with an agent role, the queue
 * that lets a run survive a restart and be taken by one replica at a time.
 * A record never holds a token.
 *
 * The store is Agentic Formflow's (`useDatabase`); the UAG gives it the
 * collection and its ids.
 */

export type { TaskRunStatus };
export type TaskRunRecord = CoreTaskRunRecord<ObjectId> & { actingFor: ActingFor };
export type NewTaskRun = CoreNewTaskRun<ObjectId> & { actingFor: ActingFor };
export type TaskRunStore = CoreTaskRunStore<ObjectId>;

export { LEASE_MS, MAX_ATTEMPTS, RENEW_MS };

/** The ids of the UAG's database: MongoDB ObjectIds. */
export const OBJECT_IDS = {
    create: () => new ObjectId(),
    parse: (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null)
};
