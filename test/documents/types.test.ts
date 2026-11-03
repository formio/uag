import { expect } from 'chai';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, start, Started } from '../characterization/harness';

const converter = (overrides: any = {}) => ({ type: 'converter', name: 'my-converter', title: 'Mine', version: '1.0.0', apiVersion: 1, accepts: [{ type: 'application/x-mine', ext: ['.mine'] }], produces: ['text'], convert: async () => ({ text: '', textFormat: 'plain' }), ...overrides });
const documentPlugin = (overrides: any = {}) => ({ type: 'document', name: 'summary', title: 'Summary', version: '1.0.0', apiVersion: 1, inputs: [['text']], process: async () => ({ content: '', status: 'ok' }), ...overrides });

describe('Documents: the converter and document plugin types', function () {
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

    it('lists the built-in converters and the module\'s plugins, both types experimental, with their public fields', async () => {
        started = await start({ modules: [{ plugins: [converter(), documentPlugin({ editable: true, defaults: { words: 100 }, editForm: [{ type: 'number', key: 'words', input: true }] })] }] });
        const res = await started.request().get('/plugins').set('x-admin-key', ADMIN_KEY);
        const converters = res.body.filter((p: any) => p.type === 'converter');
        expect(converters.map((p: any) => p.name)).to.have.members(['pdf-text', 'text', 'image-pdf', 'my-converter']);
        expect(converters.every((p: any) => p.stability === 'experimental')).to.equal(true);
        expect(converters.find((p: any) => p.name === 'my-converter')).to.deep.include({ accepts: [{ type: 'application/x-mine', ext: ['.mine'] }], produces: ['text'] });
        const summary = res.body.find((p: any) => p.type === 'document');
        expect(summary).to.deep.include({ name: 'summary', stability: 'experimental', inputs: [['text']], editable: true, output: 'markdown', defaults: { words: 100 }, editForm: [{ type: 'number', key: 'words', input: true }] });
        expect(summary.accept.map((entry: any) => entry.type)).to.include.members(['application/x-mine', 'text/plain', 'application/pdf']);
        expect(res.body.some((p: any) => 'convert' in p || 'process' in p || 'detect' in p)).to.equal(false);
    });

    it('refuses a document plugin with a function editForm', async () => {
        expect(await startupError([documentPlugin({ editForm: async () => [] })])).to.include('has a function editForm');
    });

    it('names what is wrong with a converter or a document plugin', async () => {
        const converterMessage = await startupError([converter({ produces: ['docx'], convert: undefined })]);
        expect(converterMessage).to.include('converter:my-converter').and.include('"produces"').and.include('"convert"');
        const documentMessage = await startupError([documentPlugin({ inputs: [['html']], process: undefined, output: 'html' })]);
        expect(documentMessage).to.include('document:summary').and.include('"inputs"').and.include('"process"').and.include('"output"');
    });
});
