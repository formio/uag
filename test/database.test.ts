import { expect } from 'chai';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { UAG_COLLECTIONS, UAG_SCHEMA_VERSION, UAGDatabase, UAGDatabaseError } from '../src/database';
import { UAGServer } from '../src';

/**
 * The UAG's own database: selected by name on the MONGO connection, checked
 * before anything is written, and holding only `uag-*` collections.
 */
describe('UAG database', function () {
    this.timeout(60000);
    let mongod: MongoMemoryServer;
    let client: MongoClient;
    const opened: UAGDatabase[] = [];

    before(async () => {
        mongod = await MongoMemoryServer.create();
        client = await MongoClient.connect(mongod.getUri());
    });

    after(async () => {
        await client?.close();
        await mongod?.stop();
    });

    /** Replace a console method, recording its calls, until the test ends. */
    const restores: (() => void)[] = [];
    function capture(method: 'log' | 'warn'): string[] {
        const original = console[method];
        const lines: string[] = [];
        console[method] = (...args: any[]) => { lines.push(args.join(' ')); };
        restores.push(() => { console[method] = original; });
        return lines;
    }

    afterEach(async () => {
        while (restores.length) restores.pop()!();
        while (opened.length) await opened.pop()!.close();
    });

    let counter = 0;
    /** A database name no other test uses. */
    const fresh = () => `uagtest${++counter}`;

    async function connect(name: string, options: { retentionDays?: number; path?: string } = {}) {
        const database = await UAGDatabase.connect({ url: `${mongod.getUri()}${options.path || ''}`, name, retentionDays: options.retentionDays });
        opened.push(database);
        return database;
    }

    const collections = async (name: string) => (await client.db(name).listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name).sort();
    const indexes = async (name: string) => client.db(name).collection(UAG_COLLECTIONS.taskRuns).listIndexes().toArray();
    async function refusal(promise: Promise<any>): Promise<Error> {
        try {
            await promise;
        }
        catch (err) {
            return err as Error;
        }
        throw new Error('expected a refusal');
    }

    describe('bootstrap', () => {
        it('creates its collections, their indexes and the schema marker in a fresh database', async () => {
            const name = fresh();
            const database = await connect(name);
            expect(await database.bootstrap()).to.equal('created');
            expect(await collections(name)).to.deep.equal(['uag-authcodes', 'uag-meta', 'uag-taskruns']);
            const marker = await client.db(name).collection(UAG_COLLECTIONS.meta).findOne({ _id: 'schema' as any });
            expect(marker).to.include({ app: 'formio-uag', version: UAG_SCHEMA_VERSION });
            const codes = await client.db(name).collection(UAG_COLLECTIONS.authCodes).listIndexes().toArray();
            expect(codes.find((index) => index.name === 'expires')).to.include({ expireAfterSeconds: 0 });
            const runs = await indexes(name);
            expect(runs.map((index) => index.name)).to.include.members(['claim', 'submission', 'retention']);
            expect(runs.find((index) => index.name === 'retention')).to.include({ expireAfterSeconds: 90 * 24 * 60 * 60 });
        });

        it('starts on a database with its own marker, changing nothing', async () => {
            const name = fresh();
            await (await connect(name)).bootstrap();
            const before = await client.db(name).collection(UAG_COLLECTIONS.meta).findOne({ _id: 'schema' as any });
            expect(await (await connect(name)).bootstrap()).to.equal('ready');
            expect(await client.db(name).collection(UAG_COLLECTIONS.meta).findOne({ _id: 'schema' as any })).to.deep.equal(before);
        });

        it('migrates a marker of an older schema version', async () => {
            const name = fresh();
            await (await connect(name)).bootstrap();
            await client.db(name).collection(UAG_COLLECTIONS.meta).updateOne({ _id: 'schema' as any }, { $set: { version: 0 } });
            expect(await (await connect(name)).bootstrap()).to.equal('migrated');
            expect(await client.db(name).collection(UAG_COLLECTIONS.meta).findOne({ _id: 'schema' as any })).to.include({ version: UAG_SCHEMA_VERSION });
        });

        it('refuses a database a newer UAG created', async () => {
            const name = fresh();
            await client.db(name).collection(UAG_COLLECTIONS.meta).insertOne({ _id: 'schema' as any, app: 'formio-uag', version: UAG_SCHEMA_VERSION + 1, created: new Date() });
            const err = await refusal((await connect(name)).bootstrap());
            expect(err).to.be.instanceOf(UAGDatabaseError);
            expect(err.message).to.contain('newer UAG').and.contain(`"${name}"`).and.contain('UAG_DATABASE');
            expect(await collections(name)).to.deep.equal(['uag-meta']);
        });

        it('refuses uag-* collections it did not create, and changes nothing', async () => {
            const name = fresh();
            await client.db(name).collection('uag-authcodes').insertOne({ _id: 'theirs' as any });
            const err = await refusal((await connect(name)).bootstrap());
            expect(err).to.be.instanceOf(UAGDatabaseError);
            expect(err.message).to.contain('did not create').and.contain(`"${name}"`).and.contain('UAG_DATABASE');
            expect(await collections(name)).to.deep.equal(['uag-authcodes']);
            expect(await client.db(name).collection('uag-authcodes').listIndexes().toArray()).to.have.length(1);
        });

        it('refuses a uag-meta whose marker is someone else\'s', async () => {
            const name = fresh();
            await client.db(name).collection(UAG_COLLECTIONS.meta).insertOne({ _id: 'schema' as any, app: 'another-app', version: 1 });
            expect(await refusal((await connect(name)).bootstrap())).to.be.instanceOf(UAGDatabaseError);
        });

        it('shares Form.io\'s database, touching only uag-* collections, and recommends one of its own', async () => {
            const name = fresh();
            await client.db(name).collection('forms').insertOne({ title: 'Claim' });
            await client.db(name).collection('submissions').insertOne({ data: {} });
            const warn = capture('warn');
            expect(await (await connect(name)).bootstrap()).to.equal('created');
            expect(warn[0]).to.contain('a database of its own is recommended');
            expect(await collections(name)).to.deep.equal(['forms', 'submissions', 'uag-authcodes', 'uag-meta', 'uag-taskruns']);
            expect(await client.db(name).collection('forms').countDocuments()).to.equal(1);
            expect(await client.db(name).collection('forms').listIndexes().toArray()).to.have.length(1);
        });

        it('selects UAG_DATABASE by name, whatever database the connection string names', async () => {
            const name = fresh();
            const database = await connect(name, { path: 'formio' });
            await database.bootstrap();
            expect(database.name).to.equal(name);
            expect(await collections('formio')).to.deep.equal([]);
            expect(await collections(name)).to.include('uag-meta');
        });

        it('keeps records forever with TASK_RUN_RETENTION_DAYS=0, and follows a changed retention', async () => {
            const name = fresh();
            await (await connect(name, { retentionDays: 0 })).bootstrap();
            expect((await indexes(name)).map((index) => index.name)).to.not.include('retention');
            await (await connect(name, { retentionDays: 30 })).bootstrap();
            expect((await indexes(name)).find((index) => index.name === 'retention')).to.include({ expireAfterSeconds: 30 * 24 * 60 * 60 });
            await (await connect(name, { retentionDays: 7 })).bootstrap();
            expect((await indexes(name)).find((index) => index.name === 'retention')).to.include({ expireAfterSeconds: 7 * 24 * 60 * 60 });
            await (await connect(name, { retentionDays: 0 })).bootstrap();
            expect((await indexes(name)).map((index) => index.name)).to.not.include('retention');
        });

        it('says which database the MONGO user may not use, and how to fix it', async () => {
            const unauthorized = Object.assign(new Error('not authorized on uag to execute command'), { code: 13 });
            const db: any = { databaseName: 'uag', listCollections: () => ({ toArray: async () => { throw unauthorized; } }) };
            const err = await refusal(new UAGDatabase({} as any, db, { url: 'mongodb://x' }).bootstrap());
            expect(err).to.be.instanceOf(UAGDatabaseError);
            expect(err.message).to.contain('"uag"').and.contain('readWrite').and.contain('UAG_DATABASE');
        });
    });

    describe('authorization codes', () => {
        it('gives a code back once, and never stores the code itself', async () => {
            const name = fresh();
            const database = await connect(name);
            await database.bootstrap();
            const store = database.authCodeStore();
            await store.save('the-code', { jwt: 'header.the-user-token.signature', codeChallenge: 'challenge' }, 600);
            const stored = await client.db(name).collection(UAG_COLLECTIONS.authCodes).findOne({});
            expect(stored!._id).to.not.equal('the-code');
            expect(JSON.stringify(stored)).to.not.contain('the-code');
            // Nor the token: it is sealed with a key only the code gives.
            expect(JSON.stringify(stored)).to.not.contain('the-user-token');
            expect(await store.take('another-code')).to.equal(null);
            expect(await store.take('the-code')).to.deep.equal({ jwt: 'header.the-user-token.signature', codeChallenge: 'challenge' });
            expect(await store.take('the-code')).to.equal(null);
        });

        it('refuses an expired code that the TTL monitor has not removed yet', async () => {
            const database = await connect(fresh());
            await database.bootstrap();
            const store = database.authCodeStore();
            await store.save('old', { jwt: 'token', codeChallenge: 'challenge' }, -1);
            expect(await store.take('old')).to.equal(null);
        });
    });

    describe('license grace', () => {
        it('creates the schema marker with its first write, even before the database is used', async () => {
            const name = fresh();
            const database = await connect(name);
            expect(await database.inspect()).to.equal('fresh');
            await database.licenseGrace().write(1234);
            expect(await client.db(name).collection(UAG_COLLECTIONS.meta).findOne({ _id: 'schema' as any })).to.include({ app: 'formio-uag' });
            expect(await (await connect(name)).inspect()).to.equal('ready');
        });

        it('records, reads and clears the start of a license server outage in uag-meta', async () => {
            const name = fresh();
            const database = await connect(name);
            await database.bootstrap();
            const grace = database.licenseGrace();
            expect(await grace.read()).to.equal(undefined);
            await grace.write(1234);
            expect(await grace.read()).to.equal(1234);
            expect(await (await connect(name)).licenseGrace().read()).to.equal(1234);
            await grace.write(undefined);
            expect(await grace.read()).to.equal(undefined);
        });
    });

    describe('startup', () => {
        const env = { ...process.env };
        afterEach(() => { process.env = { ...env }; });

        /** A loaded project whose license covers the database, or does not. */
        const projectWith = (licensed: boolean) => ({
            requireDatabaseLicense: () => {
                if (!licensed) throw new Error('A database of this server\'s own (MONGO) needs a license that includes the UAG. No license is configured.');
            }
        });

        async function connected(name: string, mcpOAuth = false) {
            process.env.MONGO = mongod.getUri();
            process.env.UAG_DATABASE = name;
            if (mcpOAuth) process.env.MCP_OAUTH = 'true';
            else delete process.env.MCP_OAUTH;
            const server: any = new UAGServer({ project: 'http://localhost:3001' } as any);
            await server.connectDatabase();
            return server;
        }

        it('reads MONGO, UAG_DATABASE and TASK_RUN_RETENTION_DAYS, and keeps MONGO from the appserver', () => {
            process.env.MONGO = 'mongodb://localhost:27017/formio';
            process.env.UAG_DATABASE = 'agents';
            process.env.TASK_RUN_RETENTION_DAYS = '0';
            const server: any = new UAGServer({ project: 'http://localhost:3001' } as any);
            expect(server.config.database).to.deep.include({ url: 'mongodb://localhost:27017/formio', name: 'agents', retentionDays: 0 });
            expect(server.module.db).to.equal(undefined);
        });

        it('only reads the database before the license is known', async () => {
            const name = fresh();
            const server = await connected(name, true);
            opened.push(server.pendingDatabase);
            expect(await collections(name)).to.deep.equal([]);
            expect(server.config.licenseGrace).to.have.property('read');
            expect(server.config.auth.authCodeStore).to.equal(undefined);
            expect(server.database).to.equal(undefined);
        });

        it('with the license, creates its collections and gives the OAuth provider its store', async () => {
            const name = fresh();
            const server = await connected(name, true);
            capture('log');
            await server.enableDatabase(projectWith(true));
            opened.push(server.database);
            expect(server.database.name).to.equal(name);
            expect(await collections(name)).to.deep.equal(['uag-authcodes', 'uag-meta', 'uag-taskruns']);
            expect(server.config.auth.authCodeStore).to.have.property('take');
            expect(server.config.licenseGrace).to.have.property('read');
        });

        it('without the license, starts, writes nothing, and says its database features are off', async () => {
            const name = fresh();
            const server = await connected(name, true);
            const warn = capture('warn');
            await server.enableDatabase(projectWith(false));
            expect(await collections(name)).to.deep.equal([]);
            expect(server.database).to.equal(undefined);
            expect(server.config.licenseGrace).to.equal(undefined);
            expect(server.config.auth.authCodeStore).to.equal(undefined);
            expect(warn[0]).to.contain('The database (MONGO) is not used').and.contain('needs a license');
            expect(warn[1]).to.contain('MCP_OAUTH is set, but remote MCP sign-in is off');
        });

        it('without the license, starts through router() too', async () => {
            const name = fresh();
            process.env.MONGO = mongod.getUri();
            process.env.UAG_DATABASE = name;
            delete process.env.MCP_OAUTH;
            const server: any = new UAGServer({ project: 'https://forms.example.com' } as any);
            const project: any = {
                config: {},
                ...projectWith(false),
                agentRouter: () => require('express').Router(),
                uagRouter: () => require('express').Router()
            };
            server.initializing = Promise.resolve();
            server.projectRouter = { router: async () => require('express').Router(), projects: { only: project } };
            const warn = capture('warn');
            capture('log');
            await server.router();
            expect(warn.join('\n')).to.contain('The database (MONGO) is not used');
            expect(await collections(name)).to.deep.equal([]);
        });

        it('still refuses a database it may not use, licensed or not', async () => {
            const name = fresh();
            await client.db(name).collection('uag-authcodes').insertOne({ _id: 'theirs' as any });
            process.env.MONGO = mongod.getUri();
            process.env.UAG_DATABASE = name;
            const server: any = new UAGServer({ project: 'http://localhost:3001' } as any);
            expect(await refusal(server.connectDatabase())).to.be.instanceOf(UAGDatabaseError);
        });

        it('turns MCP_OAUTH off, and says why, without MONGO', async () => {
            delete process.env.MONGO;
            process.env.MCP_OAUTH = 'true';
            capture('log');
            const warn = capture('warn');
            const server: any = new UAGServer({ project: 'http://localhost:3001' } as any);
            await server.connectDatabase();
            await server.enableDatabase(projectWith(true));
            expect(warn.join('\n')).to.contain('MCP_OAUTH is set, but remote MCP sign-in is off');
            expect(server.config.auth.authCodeStore).to.equal(undefined);
        });

        it('says there is no grace period without the database', async () => {
            delete process.env.MONGO;
            delete process.env.MCP_OAUTH;
            const log = capture('log');
            const server: any = new UAGServer({ project: 'http://localhost:3001' } as any);
            await server.connectDatabase();
            expect(log[0]).to.contain('No database (MONGO)').and.contain('no grace period');
            expect(server.config.licenseGrace).to.equal(undefined);
        });
    });
});
