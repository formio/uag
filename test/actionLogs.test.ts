import { expect } from 'chai';
import { actionItem } from '../src/actionLogs';

describe('Action Logs for a run', () => {
    const record = (extra: any) => ({
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', task: 'admissions', action: 'Agent: Run task', answer: 'task', durable: false, status: 'done',
        attempts: 1, created: new Date('2026-10-30T00:00:00Z'), started: new Date('2026-10-30T00:00:01Z'), finished: new Date('2026-10-30T00:00:02Z'),
        modified: new Date('2026-10-30T00:00:02Z'), written: ['summary'], cleared: [], saved: true, ...extra
    } as any);

    it('says which answers the form refused, by path', () => {
        const item: any = actionItem(record({ refused: ['decision', 'score'] }));
        const last = item.messages[item.messages.length - 1];
        expect(last.info).to.equal('Saved 1 field(s): summary. Left out answers the form refused: decision, score.');
        expect(last.data.refused).to.deep.equal(['decision', 'score']);
    });

    it('says nothing of refusals when there were none', () => {
        const item: any = actionItem(record({}));
        const last = item.messages[item.messages.length - 1];
        expect(last.info).to.equal('Saved 1 field(s): summary.');
        expect(last.data).to.not.have.property('refused');
    });
});
