import { defineEngine, EngineConfigError, EngineError, ENGINE_API_VERSION } from '@formio/uag-sdk';
import {
    PROTOCOL_VERSION,
    REQUEST_ID_HEADER,
    SCOPED_TOKEN_HEADER,
    checkDecisionResponse,
    checkDescription,
    checkExtractResponse,
    safeRequestId,
} from '@formio/uag-sdk/protocol';
import type { RemoteEngineDescription } from '@formio/uag-sdk/protocol';
import type { AgentEngine, DecisionEngine, DecisionRequest, ExtractRequest } from '../formflow';
import { currentRequestId } from './requestId';
const debug = require('debug')('formio:uag:remote');

/**
 * The `remote` engine type: an engine hosted by an engine server
 * (`formio/uag-engines`), reached over the remote engine protocol. Any
 * engine package can run there, so model credentials and model traffic stay in
 * that container.
 *
 *   UAG_ENGINES=jev,claude:remote
 *   UAG_ENGINE_CLAUDE_URL=http://engines:3300
 *   UAG_ENGINE_CLAUDE_KEY=<the engine server key, at least 32 characters>
 *
 * Every request carries the engine server key, and never a Form.io credential.
 * Research extracts also carry a scoped token, which the engine server uses for
 * its own MCP connection back to the UAG: it allows only the task's read-only
 * tools, with the caller's identity. Each call also carries the Agent API
 * request id, when it is a short token, for logs on either side.
 */

/** The shortest engine server key accepted. */
export const MIN_KEY_LENGTH = 32;
const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 60000;

type Fetch = typeof fetch;

type Connection = {
    /** The instance name, for errors. */
    name: string;
    baseUrl: string;
    key: string;
    fetch: Fetch;
};

class StartupError extends EngineConfigError {
    /** Whether trying again may help: the server was unreachable or failing. */
    constructor(message: string, public retry: boolean) {
        super(message);
    }
}

async function readJson(response: Response): Promise<any> {
    try {
        return await response.json();
    }
    catch {
        return undefined;
    }
}

/**
 * Describe the remote engine, retrying while the engine server is unreachable
 * or failing, with the backoff used to wait for a Form.io project. A refused
 * key, or a server that does not host the engine, stops startup at once.
 */
export async function describeRemote(
    connection: Connection,
    engine: string,
    { retries = DEFAULT_RETRIES, retryDelay = DEFAULT_RETRY_DELAY, timeout = 10000 }: { retries?: number; retryDelay?: number; timeout?: number } = {}
): Promise<RemoteEngineDescription> {
    const where = `the engine server at ${connection.baseUrl}`;
    const attempts = Math.max(1, retries);
    for (let attempt = 1; ; attempt++) {
        try {
            return await describeOnce(connection, engine, where, timeout);
        }
        catch (err: any) {
            if (!(err instanceof StartupError && err.retry) || attempt >= attempts) {
                throw new EngineConfigError(`The "${connection.name}" engine could not start: ${err.message}`);
            }
            const delay = Math.min(retryDelay * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
            debug(`${err.message} Retrying in ${delay}ms (attempt ${attempt} of ${attempts}).`);
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}

async function describeOnce(connection: Connection, engine: string, where: string, timeout: number): Promise<RemoteEngineDescription> {
    let response: Response;
    try {
        response = await connection.fetch(`${connection.baseUrl}/v1/engines`, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${connection.key}` },
            signal: AbortSignal.timeout(timeout),
        });
    }
    catch (err: any) {
        throw new StartupError(`${where} is unreachable (${err?.cause?.code || err?.name || 'no response'}).`, true);
    }
    if (response.status === 401 || response.status === 403) {
        throw new StartupError(`${where} refused the engine server key (HTTP ${response.status}).`, false);
    }
    if (!response.ok) {
        throw new StartupError(`${where} answered HTTP ${response.status}.`, response.status >= 500);
    }
    let engines: RemoteEngineDescription[];
    try {
        engines = checkDescription(await readJson(response));
    }
    catch (err: any) {
        throw new StartupError(`${where} did not answer as an engine server: ${err.message}`, false);
    }
    const described = engines.find((candidate) => candidate.name === engine);
    if (!described) {
        throw new StartupError(
            `${where} does not host an engine named "${engine}"` +
            (engines.length ? ` (it hosts ${engines.map((e) => `"${e.name}"`).join(', ')}).` : ' (it hosts none).'),
            false
        );
    }
    return described;
}

/** One protocol call. Failures are engine failures, safe to show unless the server says otherwise. */
async function call(connection: Connection, path: string, body: Record<string, any>, signal?: AbortSignal, scopedToken?: string): Promise<any> {
    signal?.throwIfAborted();
    const requestId = safeRequestId(currentRequestId());
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${connection.key}`,
        ...(scopedToken && { [SCOPED_TOKEN_HEADER]: scopedToken }),
        ...(requestId && { [REQUEST_ID_HEADER]: requestId }),
    };
    let response: Response;
    try {
        response = await connection.fetch(`${connection.baseUrl}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ protocol: PROTOCOL_VERSION, ...body }),
            signal,
        });
    }
    catch (err: any) {
        if (signal?.aborted) throw signal.reason ?? err;
        throw new EngineError(`The engine server at ${connection.baseUrl} could not be reached.`);
    }
    const json = await readJson(response);
    if (!response.ok) {
        if (json?.expose === true && typeof json.error === 'string') {
            throw new EngineError(json.error);
        }
        debug(`The engine server answered HTTP ${response.status}: ${json?.error || '(no message)'}`);
        throw new EngineError(`The engine server answered HTTP ${response.status}.`);
    }
    return json;
}

/** Validate a response, reporting a malformed one as an engine failure. */
function valid<T>(check: (body: unknown) => T, body: unknown): T {
    try {
        return check(body);
    }
    catch (err: any) {
        throw new EngineError(`The engine server's answer did not follow the remote engine protocol: ${err.message}`);
    }
}

/** An engine object for a described remote engine. */
export function remoteEngine(connection: Connection, remoteName: string, described: RemoteEngineDescription): DecisionEngine | AgentEngine {
    const path = `/v1/engines/${encodeURIComponent(remoteName)}`;
    if (described.kind === 'decision') {
        return {
            name: connection.name,
            kind: 'decision',
            apiVersion: ENGINE_API_VERSION,
            model: described.model,
            maxOptions: described.maxOptions!,
            async decide({ state, questions, signal }: DecisionRequest) {
                const response = valid(checkDecisionResponse, await call(connection, `${path}/decide`, { state, questions }, signal));
                return { ...response, model: response.model || described.model };
            },
        };
    }
    return {
        name: connection.name,
        kind: 'agent',
        apiVersion: ENGINE_API_VERSION,
        model: described.model,
        toolUse: described.toolUse === true,
        async extract(request: ExtractRequest) {
            const research = !!request.tools?.length;
            // The engine server researches through its own MCP connection to the
            // UAG, which needs a scoped token; without one (no JWT_SECRET), no call.
            if (research && !request.scopedToken) {
                throw new EngineError('The remote engine cannot research without a scoped token. Set JWT_SECRET on the UAG.');
            }
            const body = {
                instructions: request.instructions,
                state: request.state,
                fields: request.fields,
                schema: request.schema,
                ...(research && { tools: request.tools, maxIterations: request.maxIterations || 10 }),
            };
            const response = valid(checkExtractResponse, await call(connection, `${path}/extract`, body, request.signal, research ? request.scopedToken : undefined));
            return { ...response, model: response.model || described.model };
        },
    };
}

export const RemoteEngine = defineEngine({
    type: 'remote',
    kinds: ['decision', 'agent'],
    apiVersion: ENGINE_API_VERSION,
    description: 'An engine hosted by an engine server, over the remote engine protocol.',
    settings: {
        url: { required: true, description: 'The engine server, such as http://engines:3300.' },
        key: { required: true, secret: true, description: `The engine server key, at least ${MIN_KEY_LENGTH} characters.` },
        engine: { description: 'The engine\'s name on the engine server. Default: the instance name.' },
        timeout: { type: 'number', default: 10000, description: 'Milliseconds for each attempt to describe the engine at startup.' },
    },
    async create({ name, settings, options, config }) {
        let url: URL;
        try {
            url = new URL(settings.url);
        }
        catch {
            throw new EngineConfigError(`The "${name}" engine's url setting is not a URL: ${JSON.stringify(settings.url)}.`);
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new EngineConfigError(`The "${name}" engine's url setting must be an http or https URL.`);
        }
        if (String(settings.key).length < MIN_KEY_LENGTH) {
            throw new EngineConfigError(`The "${name}" engine's key setting must be at least ${MIN_KEY_LENGTH} characters, the same key as the engine server's UAG_ENGINE_SERVER_KEY.`);
        }
        const connection: Connection = {
            name,
            baseUrl: url.href.replace(/\/+$/, ''),
            key: settings.key,
            fetch: options.fetch || fetch,
        };
        const remoteName = settings.engine || name;
        const described = await describeRemote(connection, remoteName, {
            retries: config.retries,
            retryDelay: config.retryDelay,
            timeout: settings.timeout,
        });
        debug(`"${name}" is the ${described.kind} engine "${remoteName}" (${described.model}) at ${connection.baseUrl}.`);
        return remoteEngine(connection, remoteName, described);
    },
});
