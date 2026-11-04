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

    it('uses a file whose default export declares a feature as the module it is', async () => {
        const server = fakeServer();
        const file = path.join(__dirname, 'files', 'feature.mjs');
        expect(await usePluginFiles(server as any, { UAG_PLUGINS: file }, '/nonexistent/index.mjs')).to.equal(file);
        expect(server.used).to.have.length(1);
        expect(server.used[0].source).to.equal(file);
        expect(server.used[0].module.uag).to.deep.equal({ name: 'notes', apiVersion: 1 });
        expect(server.used[0].module.pluginTypes.map((t: any) => t.type)).to.deep.equal(['note']);
        expect(server.used[0].module.plugins.map((p: any) => p.name)).to.deep.equal(['fixture-note']);
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
