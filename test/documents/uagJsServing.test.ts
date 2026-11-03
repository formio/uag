import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { requireTestLicense } from '../agent/fixtures';
import { Started } from '../characterization/harness';
import { startDocuments } from './fixture';

const bundle = fs.readFileSync(path.join(__dirname, '..', '..', 'packages', 'uag-js', 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'packages', 'uag-js', 'uag-js.css'), 'utf8');

describe('Documents: serving uag-js and the portal script', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; });

    const manifestOf = (script: string) => JSON.parse(/var manifest = (.*);\n/.exec(script)![1]);

    it('serves uag.use.js: the bundle, registering itself with the manifest, publicly and revalidated', async () => {
        started = await startDocuments();
        const res = await started.request().get('/uag-js/uag.use.js');
        expect(res.status).to.equal(200);
        expect(res.headers['content-type']).to.include('application/javascript');
        expect(res.headers['cache-control']).to.equal('no-cache');
        expect(res.headers.etag).to.match(/^".+"$/);
        expect(res.text.startsWith(bundle)).to.equal(true);
        expect(res.text).to.include("lib.UAG(uagUrl, { manifest: manifest })");
        const manifest = manifestOf(res.text);
        expect(manifest.map((p: any) => `${p.type}:${p.name}`)).to.include.members(['document:echo', 'converter:pdf-text']);
        expect(manifest.every((p: any) => p.type === 'document' || p.type === 'converter')).to.equal(true);
        const again = await started.request().get('/uag-js/uag.use.js').set('If-None-Match', res.headers.etag);
        expect(again.status).to.equal(304);
    });

    it('serves portal.js in portal mode with the manifest embedded, chaining an https script only', async () => {
        started = await startDocuments();
        const plain = await started.request().get('/uag-js/portal.js');
        expect(plain.text).to.include('lib.UAG(uagUrl, { portal: true, manifest: manifest })');
        expect(manifestOf(plain.text).find((p: any) => p.name === 'echo')).to.exist;
        expect(plain.text).to.not.include('createElement(\'script\')');
        const chained = await started.request().get(`/uag-js/portal.js?chain=${encodeURIComponent('https://cdn.example.com/custom.js')}`);
        expect(chained.text).to.include('chain.src = "https://cdn.example.com/custom.js"');
        const insecure = await started.request().get(`/uag-js/portal.js?chain=${encodeURIComponent('http://cdn.example.com/custom.js')}`);
        expect(insecure.text).to.not.include('cdn.example.com');
        const script = await started.request().get(`/uag-js/portal.js?chain=${encodeURIComponent('javascript:alert(1)')}`);
        expect(script.text).to.not.include('alert(1)');
    });

    it('serves portal.css with the chained stylesheet imported first, and uag-js.css', async () => {
        started = await startDocuments();
        const chained = await started.request().get(`/uag-js/portal.css?chain=${encodeURIComponent('https://cdn.example.com/custom.css')}`);
        expect(chained.headers['content-type']).to.include('text/css');
        expect(chained.text.startsWith('@import url("https://cdn.example.com/custom.css");\n')).to.equal(true);
        expect(chained.text.endsWith(css)).to.equal(true);
        const plain = await started.request().get('/uag-js/uag-js.css');
        expect(plain.text).to.equal(css);
        expect(plain.headers['cache-control']).to.equal('no-cache');
    });

    it('changes the ETag when the manifest changes, at the same URL', async () => {
        started = await startDocuments();
        const first = (await started.request().get('/uag-js/portal.js')).headers.etag;
        await started.stop();
        started = await startDocuments({ engines: ['reader'] });
        const same = (await started.request().get('/uag-js/portal.js')).headers.etag;
        expect(same).to.equal(first);
        await started.stop();
        const { start } = require('../characterization/harness');
        started = await start({ forms: {}, config: {} });
        const other = (await started!.request().get('/uag-js/portal.js')).headers.etag;
        expect(other).to.not.equal(first);
    });
});
