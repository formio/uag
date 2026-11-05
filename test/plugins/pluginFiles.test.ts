import { expect } from 'chai';
import path from 'path';
import { pluginsFile, usePluginFiles } from '../../src/pluginFiles';

const FILE = path.join(__dirname, 'files', 'index.mjs');

describe('Plugin files', () => {
    const fakeServer = () => {
        const used: Array<{ module: any; source?: string }> = [];
        return { used, use: (module: any, source?: string) => { used.push({ module, source }); } };
    };

    it('loads the file UAG_PLUGINS names, naming it as the source', async () => {
        const server = fakeServer();
        const loaded = await usePluginFiles(server as any, { UAG_PLUGINS: FILE }, '/nonexistent/index.mjs');
        expect(loaded).to.equal(FILE);
        expect(server.used).to.have.length(1);
        expect(server.used[0].source).to.equal(FILE);
        expect(server.used[0].module.plugins.map((p: any) => p.name)).to.deep.equal(['fixture-text']);
    });

    it('uses a file whose default export is a module as the module it is', async () => {
        const server = fakeServer();
        const file = path.join(__dirname, 'files', 'module.mjs');
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent/index.mjs')).to.equal(file);
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
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent/index.mjs')).to.equal(file);
        const modules = server.used[0].module;
        expect(modules.map((m: any) => m.name || 'plugins')).to.deep.equal(['notes', 'notes-plugins', 'plugins']);
        expect(modules[2].plugins.map((p: any) => p.name)).to.deep.equal(['loose-converter', 'typo']);
    });

    it('hands a module of the old shape (a "uag" key) to the server, which says what to change', async () => {
        const server = fakeServer();
        const file = path.join(__dirname, 'files', 'old-shape.mjs');
        await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent/index.mjs');
        expect(server.used[0].module[0].uag).to.deep.equal({ name: 'old', apiVersion: 1 });
    });

    it('loads nothing when UAG_PLUGINS is off, even where the image keeps its default file', async () => {
        const server = fakeServer();
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: 'off' }, FILE)).to.equal(undefined);
        expect(server.used).to.have.length(0);
    });

    it('loads the image\'s default file when it exists and UAG_PLUGINS is unset', async () => {
        expect(pluginsFile({}, FILE)).to.equal(FILE);
        expect(pluginsFile({}, '/nonexistent/index.mjs')).to.equal(undefined);
        const server = fakeServer();
        expect(await usePluginFiles(server as any, {}, FILE)).to.equal(FILE);
    });
});
