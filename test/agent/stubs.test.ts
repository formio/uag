import { expect } from 'chai';
import { createEngine } from '@formio/uag-sdk/loader';
import { checkEngine } from '@formio/uag-sdk/conformance';
import { StubAgentEngine, StubDecisionEngine, stubGenerateRequests } from '../../src/agent/stubs';

describe('Stub engines', () => {
    it('the stub agent meets the generate and accepts contract, and reads text only', async () => {
        const report = await checkEngine(StubAgentEngine as any, { name: 'stub-agent' });
        const checks = report.results.filter((r) => /generate|accepts/.test(r.check));
        expect(checks.map((r) => r.check)).to.deep.equal(['accepts lists only known document kinds', 'generate returns text, its model and a valid stopReason', 'generate stops when its signal is aborted']);
        expect(checks.every((r) => r.ok)).to.equal(true);
        const engine: any = await createEngine(StubAgentEngine as any, { name: 'stub-agent' });
        expect(engine.accepts).to.deep.equal(['text']);
    });

    it('records each generate request and answers with what reached it', async () => {
        stubGenerateRequests.length = 0;
        const engine: any = await createEngine(StubAgentEngine as any, { name: 'writer' });
        let progress = 0;
        const response = await engine.generate({
            instructions: 'Summarize.',
            system: 'Be brief.',
            format: 'markdown',
            attachments: [{ kind: 'text', text: 'Ada lives in London.', label: 'Document 1: notes.txt', textFormat: 'plain' }],
            onProgress: (chars: number) => { progress = chars; }
        });
        expect(response).to.deep.equal({ text: '# Stub answer\n\nSummarize.\n\n## Document 1: notes.txt\n\nAda lives in London.', model: 'stub-agent-1', stopReason: 'end' });
        expect(progress).to.equal(response.text.length);
        expect(stubGenerateRequests).to.deep.equal([{
            engine: 'writer', instructions: 'Summarize.', system: 'Be brief.', format: 'markdown',
            attachments: [{ kind: 'text', text: 'Ada lives in London.', label: 'Document 1: notes.txt', textFormat: 'plain' }]
        }]);
    });

    it('the stub decision engine has no generate', async () => {
        const engine: any = await createEngine(StubDecisionEngine as any, { name: 'stub-decision' });
        expect(engine.generate).to.equal(undefined);
    });
});
