import { AsyncLocalStorage } from 'async_hooks';

/**
 * The Agent API request an operation runs for, so the `remote` engine type can
 * send its id to the engine server: the engine contract carries no request id,
 * and Formflow calls engines within the operation's async context.
 */
const current = new AsyncLocalStorage<string | undefined>();

/** Run `fn` as part of the request `requestId`. */
export function withRequestId<T>(requestId: string | undefined, fn: () => T): T {
    return current.run(requestId, fn);
}

/** The id of the request being served, if any. */
export function currentRequestId(): string | undefined {
    return current.getStore();
}
