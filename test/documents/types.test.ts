import { expect } from 'chai';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, start, Started } from '../characterization/harness';

const converter = (overrides: any = {}) => ({ type: 'converter', name: 'my-converter', title: 'Mine', version: '1.0.0', apiVersion: 1, accepts: [{ type: 'application/x-mine', ext: ['.mine'] }], produces: ['text'], convert: async () => ({ text: '', textFormat: 'plain' }), ...overrides });
const documentPlugin = (overrides: any = {}) => ({ type: 'document', name: 'summary', title: 'Summary', version: '1.0.0', apiVersion: 1, inputs: [['text']], process: async () => ({ content: '', status: 'ok' }), ...overrides });

describe('Documents: the converter plugin type, and document plugins without the AI Document feature', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; });

    async function startupError(plugins: any[]) {
        try {
            started = await start({ modules: [{ plugins }] });
            return '';
        }
        catch (err: any) {
            return err.message;
        }
    }

    it('lists the built-in converters and the module\'s, experimental, with their public fields', async () => {
        started = await start({ modules: [{ plugins: [converter()] }] });
        const res = await started.request().get('/plugins').set('x-admin-key', ADMIN_KEY);
        const converters = res.body.filter((p: any) => p.type === 'converter');
        expect(converters.map((p: any) => p.name)).to.have.members(['pdf-text', 'text', 'image-pdf', 'my-converter']);
        expect(converters.every((p: any) => p.stability === 'experimental')).to.equal(true);
        expect(converters.find((p: any) => p.name === 'my-converter')).to.deep.include({ accepts: [{ type: 'application/x-mine', ext: ['.mine'] }], produces: ['text'] });
        expect(res.body.some((p: any) => p.type === 'document')).to.equal(false);
        expect(res.body.some((p: any) => 'convert' in p || 'detect' in p)).to.equal(false);
    });

    it('stops startup for a document plugin without the AI Document feature, naming the feature when the plugin does', async () => {
        expect(await startupError([documentPlugin()])).to.include('no plugin type "document"');
        expect(await startupError([documentPlugin({ feature: '@formio/uag-extras/features/ai-document' })]))
            .to.include('no plugin type "document". It is defined by @formio/uag-extras/features/ai-document: use that too.');
    });

    it('names what is wrong with a converter', async () => {
        const converterMessage = await startupError([converter({ produces: ['docx'], convert: undefined })]);
        expect(converterMessage).to.include('converter:my-converter').and.include('"produces"').and.include('"convert"');
    });
});
