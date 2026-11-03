import { expect } from 'chai';
import { documentsSettings, documentLimitWarnings, DOCUMENTS_DEFAULTS } from '../../src/documents';

describe('Documents: configuration', () => {
    it('has the defaults of the specification', () => {
        expect(documentsSettings(undefined, {})).to.deep.equal({
            maxFileBytes: 25 * 1024 * 1024, maxFiles: 10, maxTotalBytes: 32 * 1024 * 1024, maxPages: 500, maxTextChars: 2000000,
            timeoutMs: 600000, heartbeatMs: 15000, perUser: 3, prefer: {}
        });
        expect(DOCUMENTS_DEFAULTS.maxPages).to.equal(500);
    });

    it('reads its environment variables, with configuration over them', () => {
        const env = { DOCUMENTS_MAX_FILE_BYTES: '1000', DOCUMENTS_MAX_PAGES: '100', DOCUMENTS_TIMEOUT_MS: '5000', DOCUMENTS_ENGINE: 'claude' };
        expect(documentsSettings({}, env)).to.include({ maxFileBytes: 1000, maxPages: 100, timeoutMs: 5000, engine: 'claude' });
        expect(documentsSettings({ maxPages: 20, engine: 'fast' }, env)).to.include({ maxPages: 20, engine: 'fast' });
    });

    it('warns about limits beyond what an engine provider takes', () => {
        expect(documentLimitWarnings(documentsSettings({}, {}))).to.deep.equal([]);
        const warnings = documentLimitWarnings(documentsSettings({ maxTotalBytes: 64 * 1024 * 1024, maxPages: 1000 }, {}));
        expect(warnings).to.have.length(2);
        expect(warnings[0]).to.include('documents.maxTotalBytes');
        expect(warnings[1]).to.include('documents.maxPages');
    });
});
