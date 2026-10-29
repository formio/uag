import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';
import type { AuthCodeRecord, AuthCodeStore } from '@formio/appserver-core';
const debug = require('debug')('formio:uag:database');

/**
 * The UAG's own database (MONGO, with the database named by UAG_DATABASE). It
 * holds only the UAG's state: authorization codes for remote MCP clients, the
 * start of a license server outage, and task-run records. Never submissions.
 *
 * Every collection the UAG uses is named `uag-*`, and nothing else in the
 * database is read or written, so the database may be shared. Before writing
 * anything, the UAG checks that the `uag-*` collections are its own.
 */

/** The schema version this UAG writes. Older databases are migrated; newer ones refused. */
export const UAG_SCHEMA_VERSION = 1;

export const UAG_COLLECTIONS = Object.freeze({
    meta: 'uag-meta',
    authCodes: 'uag-authcodes',
    taskRuns: 'uag-taskruns',
});

const PREFIX = 'uag-';
const APP = 'formio-uag';
const SCHEMA_ID = 'schema';
const LICENSE_ID = 'license';
const RETENTION_INDEX = 'retention';
const DEFAULT_RETENTION_DAYS = 90;
// MongoDB's "Unauthorized" error.
const UNAUTHORIZED = 13;

export type UAGDatabaseOptions = {
    /** The connection string (MONGO). Its database, if any, is ignored: UAG_DATABASE names the one used. */
    url: string;
    /** The database to use (UAG_DATABASE). */
    name?: string;
    /** Driver options (MONGO_CONFIG), as JSON or an object. */
    config?: string | MongoClientOptions;
    /** Days a task-run record is kept (TASK_RUN_RETENTION_DAYS); 0 keeps it forever. */
    retentionDays?: number;
};

/** Why the UAG may not use a database. Startup stops with this message. */
export class UAGDatabaseError extends Error {
    name = 'UAGDatabaseError';
}

/** The marker the UAG writes in `uag-meta` when it creates its collections. */
type SchemaMarker = { _id: string; app: string; version: number; created: Date; migrated?: Date };

function driverOptions(config: UAGDatabaseOptions['config']): MongoClientOptions {
    if (!config) return {};
    if (typeof config !== 'string') return config;
    try {
        return JSON.parse(config);
    }
    catch (err: any) {
        throw new UAGDatabaseError(`MONGO_CONFIG is not valid JSON: ${err.message}`);
    }
}

/** Authorization codes are stored by their hash, so the database never holds a usable code. */
const codeKey = (code: string) => createHash('sha256').update(code).digest('base64url');

/**
 * An authorization code's token, sealed with a key only the code gives: the
 * database holds neither the code nor a token it could use.
 */
const sealKey = (code: string) => createHash('sha256').update(`uag-authcode:${code}`).digest();
function sealToken(code: string, token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', sealKey(code), iv);
    const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64url')).join('.');
}
function openToken(code: string, sealed: string): string | null {
    try {
        const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
        const decipher = createDecipheriv('aes-256-gcm', sealKey(code), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    catch {
        return null;
    }
}

export class UAGDatabase {
    readonly name: string;
    readonly retentionDays: number;
    private bootstrapped?: Promise<'created' | 'ready' | 'migrated'>;
    private warned = false;

    constructor(readonly client: MongoClient, readonly db: Db, options: UAGDatabaseOptions) {
        this.name = db.databaseName;
        const days = options.retentionDays;
        this.retentionDays = days === undefined || Number.isNaN(days) ? DEFAULT_RETENTION_DAYS : Math.max(0, days);
    }

    /**
     * Connect, and select the database by name on the connection: the
     * connection string's database and `authSource` are left as they are.
     */
    static async connect(options: UAGDatabaseOptions): Promise<UAGDatabase> {
        const name = options.name || 'uag';
        const client = new MongoClient(options.url, driverOptions(options.config));
        try {
            await client.connect();
        }
        catch (err: any) {
            throw new UAGDatabaseError(`Could not connect to MONGO: ${err.message}`);
        }
        return new UAGDatabase(client, client.db(name), { ...options, name });
    }

    get meta(): Collection<any> { return this.db.collection(UAG_COLLECTIONS.meta); }
    get authCodes(): Collection<any> { return this.db.collection(UAG_COLLECTIONS.authCodes); }
    get taskRuns(): Collection<any> { return this.db.collection(UAG_COLLECTIONS.taskRuns); }

    /**
     * Check the database without writing anything: whether the UAG may use it,
     * and what bootstrap would do. Refuses (throws) a database whose `uag-*`
     * collections the UAG did not create, or that a newer UAG created.
     */
    async inspect(): Promise<'fresh' | 'ready' | 'older'> {
        return this.privileged(async () => {
            const names: string[] = (await this.db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name);
            const ours = names.filter((name) => name.startsWith(PREFIX));
            if (names.length > ours.length && !this.warned) {
                this.warned = true;
                console.warn(`[formio-uag] The database "${this.name}" holds other data too. The UAG uses only its uag-* collections there, ` +
                    'but a database of its own is recommended (UAG_DATABASE).');
            }
            if (!ours.length) return 'fresh';
            const marker: SchemaMarker | null = ours.includes(UAG_COLLECTIONS.meta) ? await this.meta.findOne({ _id: SCHEMA_ID }) : null;
            if (!marker || marker.app !== APP || typeof marker.version !== 'number') {
                throw new UAGDatabaseError(`The database "${this.name}" holds uag-* collections that the UAG did not create (${ours.join(', ')}). ` +
                    'Nothing was changed. Choose another database with UAG_DATABASE.');
            }
            if (marker.version > UAG_SCHEMA_VERSION) {
                throw new UAGDatabaseError(`The database "${this.name}" was created by a newer UAG (schema version ${marker.version}; ` +
                    `this UAG supports ${UAG_SCHEMA_VERSION}). Upgrade the UAG, or choose another database with UAG_DATABASE.`);
            }
            return marker.version < UAG_SCHEMA_VERSION ? 'older' : 'ready';
        });
    }

    /**
     * Check the database (see inspect), then create what is missing: the schema
     * marker first, then the collections and their indexes; or migrate an older
     * schema. Safe to call again.
     */
    bootstrap(): Promise<'created' | 'ready' | 'migrated'> {
        this.bootstrapped = this.bootstrapped || this.privileged(async () => {
            const state = await this.inspect();
            if (state === 'fresh') {
                // The marker first: a start interrupted after it finishes the rest next time.
                await this.meta.insertOne({ _id: SCHEMA_ID, app: APP, version: UAG_SCHEMA_VERSION, created: new Date() } as SchemaMarker);
                await this.ensureCollections();
                debug(`Created the UAG's collections in "${this.name}".`);
                return 'created';
            }
            await this.ensureCollections();
            if (state === 'older') {
                // No migrations yet: each schema version adds its steps here.
                await this.meta.updateOne({ _id: SCHEMA_ID }, { $set: { version: UAG_SCHEMA_VERSION, migrated: new Date() } });
                return 'migrated';
            }
            return 'ready';
        });
        // A failed attempt can be tried again.
        this.bootstrapped.catch(() => { this.bootstrapped = undefined; });
        return this.bootstrapped;
    }

    /** Create the collections and indexes, as needed; safe to repeat. */
    private async ensureCollections(): Promise<void> {
        await this.authCodes.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expires' });
        await this.taskRuns.createIndex({ status: 1, leaseUntil: 1 }, { name: 'claim' });
        await this.taskRuns.createIndex({ project: 1, form: 1, submission: 1, created: -1 }, { name: 'submission' });
        await this.ensureRetention();
    }

    /** The task-run records' TTL index, following TASK_RUN_RETENTION_DAYS; none when it is 0. */
    private async ensureRetention(): Promise<void> {
        const seconds = this.retentionDays * 24 * 60 * 60;
        const indexes = await this.taskRuns.listIndexes().toArray().catch(() => [] as any[]);
        const existing = indexes.find((index: any) => index.name === RETENTION_INDEX);
        if (!seconds) {
            if (existing) await this.taskRuns.dropIndex(RETENTION_INDEX);
            return;
        }
        if (!existing) {
            await this.taskRuns.createIndex({ created: 1 }, { expireAfterSeconds: seconds, name: RETENTION_INDEX });
        }
        else if (existing.expireAfterSeconds !== seconds) {
            await this.db.command({ collMod: UAG_COLLECTIONS.taskRuns, index: { name: RETENTION_INDEX, expireAfterSeconds: seconds } });
        }
    }

    /** Run database work, reporting a missing privilege with the database's name. */
    private async privileged<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        }
        catch (err: any) {
            if (err?.code === UNAUTHORIZED) {
                throw new UAGDatabaseError(`The MONGO user may not use the database "${this.name}" (${err.message}). ` +
                    `Grant it the readWrite role on "${this.name}", or choose another database with UAG_DATABASE.`);
            }
            throw err;
        }
    }

    /** Authorization codes for remote MCP clients (MCP_OAUTH), in `uag-authcodes`. */
    authCodeStore(): AuthCodeStore {
        const collection = this.authCodes;
        return {
            async save(code: string, record: AuthCodeRecord, ttl: number) {
                await collection.insertOne({ _id: codeKey(code), sealed: sealToken(code, record.jwt), codeChallenge: record.codeChallenge, expiresAt: new Date(Date.now() + ttl * 1000) });
            },
            async take(code: string) {
                // The TTL monitor runs about once a minute, so expiry is checked here too.
                const found = await collection.findOneAndDelete({ _id: codeKey(code), expiresAt: { $gt: new Date() } });
                const jwt = typeof found?.sealed === 'string' ? openToken(code, found.sealed) : null;
                return jwt ? { jwt, codeChallenge: found!.codeChallenge } : null;
            }
        };
    }

    /** When the license server became unreachable, in `uag-meta`, so a restart neither begins nor extends the grace period. */
    licenseGrace() {
        const meta = this.meta;
        const database = this;
        return {
            async read(): Promise<number | undefined> {
                const found = await meta.findOne({ _id: LICENSE_ID });
                return typeof found?.outageSince === 'number' ? found.outageSince : undefined;
            },
            async write(since?: number): Promise<void> {
                // It may write before the license is known, so it never leaves uag-* collections without the marker.
                await database.bootstrap();
                await meta.updateOne({ _id: LICENSE_ID }, since === undefined ? { $unset: { outageSince: '' } } : { $set: { outageSince: since } }, { upsert: true });
            }
        };
    }

    async close(): Promise<void> {
        await this.client.close();
    }
}
