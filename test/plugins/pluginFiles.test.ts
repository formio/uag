import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pluginFiles, pluginFilesIn, usePluginFiles } from '../../src/pluginFiles';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, start, Started } from '../characterization/harness';

const FILES = path.join(__dirname, 'files');
const FILE = path.join(FILES, 'index.mjs');
const ADDONS = path.join(__dirname, 'addons');

describe('Plugin files', () => {
    const fakeServer = () => {
        const used: Array<{ module: any; source?: string }> = [];
        return { used, use: (module: any, source?: string) => { used.push({ module, source }); } };
    };

    it('loads the file UAG_PLUGINS names, naming it as the source', async () => {
        const server = fakeServer();
        const loaded = await usePluginFiles(server as any, { UAG_PLUGINS: FILE }, '/nonexistent');
        expect(loaded).to.deep.equal([FILE]);
        expect(server.used).to.have.length(1);
        expect(server.used[0].source).to.equal(FILE);
        expect(server.used[0].module.plugins.map((p: any) => p.name)).to.deep.equal(['fixture-text']);
    });

    it('uses a file whose default export is a module as the module it is', async () => {
        const server = fakeServer();
        const file = path.join(__dirname, 'files', 'module.mjs');
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent')).to.deep.equal([file]);
        expect(server.used).to.have.length(1);
        expect(server.used[0].source).to.equal(file);
        const [module] = server.used[0].module;
        expect(module).to.include({ name: 'notes', apiVersion: 1 });
        expect(module.pluginTypes.map((t: any) => t.type)).to.deep.equal(['note']);
        expect(module.plugins.map((p: any) => p.name)).to.deep.equal(['fixture-note']);
    });

    it('uses a list of modules and plugins: each module in turn, and the plugins together', async () => {
        const server = fakeServer();
        const file = path.join(__dirname, 'files', 'list.mjs');
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent')).to.deep.equal([file]);
        const modules = server.used[0].module;
        expect(modules.map((m: any) => m.name || 'plugins')).to.deep.equal(['notes', 'notes-plugins', 'plugins']);
        expect(modules[2].plugins.map((p: any) => p.name)).to.deep.equal(['loose-converter', 'typo']);
    });

    it('hands a module of the old shape (a "uag" key) to the server, which says what to change', async () => {
        const server = fakeServer();
        const file = path.join(__dirname, 'files', 'old-shape.mjs');
        await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent');
        expect(server.used[0].module[0].uag).to.deep.equal({ name: 'old', apiVersion: 1 });
    });

    it('loads nothing when UAG_PLUGINS is off, even where the image has a plugins folder', async () => {
        const server = fakeServer();
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: 'off' }, FILES)).to.deep.equal([]);
        expect(server.used).to.have.length(0);
    });

    it('loads the image\'s plugins folder when it exists and UAG_PLUGINS is unset', async () => {
        expect(pluginFiles({}, FILES)).to.deep.equal([FILE]);
        expect(pluginFiles({}, '/nonexistent')).to.deep.equal([]);
        const server = fakeServer();
        expect(await usePluginFiles(server as any, {}, FILES)).to.deep.equal([FILE]);
    });

    describe('a plugins folder', () => {
        let root: string;
        const write = (file: string, text = 'export default [];\n') => {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), text);
        };
        beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-plugins-')); });
        afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

        it('with an index.mjs is one plugins folder: that file alone, whatever folders it holds', () => {
            write('index.mjs');
            write('sample-text/index.mjs');
            expect(pluginFilesIn(root)).to.deep.equal([path.join(root, 'index.mjs')]);
        });

        it('without one holds add-ons: the index.mjs of each folder in it, in name order', () => {
            write('documents/index.mjs');
            write('crm/index.mjs');
            write('crm/node_modules/some-package/index.mjs');
            write('empty/README.md', 'no plugins here\n');
            write('node_modules/index.mjs');
            write('.cache/index.mjs');
            write('loose.mjs');
            expect(pluginFilesIn(root)).to.deep.equal([path.join(root, 'crm', 'index.mjs'), path.join(root, 'documents', 'index.mjs')]);
        });

        it('follows a folder linked into it', () => {
            write('real/documents/index.mjs');
            fs.mkdirSync(path.join(root, 'plugins'));
            fs.symlinkSync(path.join(root, 'real', 'documents'), path.join(root, 'plugins', 'documents'));
            expect(pluginFilesIn(path.join(root, 'plugins'))).to.deep.equal([path.join(root, 'plugins', 'documents', 'index.mjs')]);
        });

        it('that is empty loads nothing', async () => {
            const server = fakeServer();
            expect(await usePluginFiles(server as any, { UAG_PLUGINS: root }, '/nonexistent')).to.deep.equal([]);
            expect(server.used).to.have.length(0);
        });

        it('named by UAG_PLUGINS works as the image\'s does, and a path that is not there fails loading', async () => {
            write('documents/index.mjs');
            expect(pluginFiles({ UAG_PLUGINS: root }, '/nonexistent')).to.deep.equal([path.join(root, 'documents', 'index.mjs')]);
            let failed: any;
            await usePluginFiles(fakeServer() as any, { UAG_PLUGINS: path.join(root, 'missing.mjs') }, '/nonexistent').catch((err) => { failed = err; });
            expect(String(failed?.message)).to.include('missing.mjs');
        });
    });

    describe('several add-ons in one UAG', function () {
        this.timeout(30000);
        before(function () { requireTestLicense(this); });

        let started: Started | undefined;
        afterEach(async () => { await started?.stop(); started = undefined; });

        it('merge: each add-on is used in turn, a module two of them bring is used once, and a plugin may use a type another add-on defines', async () => {
            const dir = path.join(ADDONS, 'merge');
            let loaded: string[] = [];
            started = await start({ use: async (server) => { loaded = await usePluginFiles(server, { UAG_PLUGINS: dir }, '/nonexistent'); } });
            expect(loaded).to.deep.equal([path.join(dir, 'crm', 'index.mjs'), path.join(dir, 'documents', 'index.mjs')]);
            const res = await started.request().get('/plugins?type=note').set('x-admin-key', ADMIN_KEY);
            expect(res.status, res.text).to.equal(200);
            expect(res.body.map((p: any) => p.name)).to.deep.equal(['crm-note', 'documents-note']);
        });

        it('stop startup when two register the same plugin, naming both', async () => {
            const dir = path.join(ADDONS, 'conflict');
            let failed: any;
            await start({ use: (server) => usePluginFiles(server, { UAG_PLUGINS: dir }, '/nonexistent') }).catch((err) => { failed = err; });
            expect(String(failed?.message)).to.equal(`Plugin converter:same is registered twice: by ${path.join(dir, 'one', 'index.mjs')} and by ${path.join(dir, 'two', 'index.mjs')}`);
        });
    });
});
