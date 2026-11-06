import { expect } from 'chai';
import { EventEmitter } from 'events';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stopOnSignals } = require('../bin/uag');

describe('The uag command', () => {
    it('destroys the server on SIGTERM, so modules and plugins close, then exits', async () => {
        const on = new EventEmitter();
        const calls: string[] = [];
        const exited = new Promise<number>((resolve) => {
            stopOnSignals({ destroy: async () => { calls.push('destroy'); } }, { close: () => calls.push('close') }, { on, exit: resolve });
        });
        on.emit('SIGTERM');
        on.emit('SIGINT');
        on.emit('SIGINT');
        expect(await exited).to.equal(0);
        expect(calls).to.deep.equal(['close', 'destroy']);
        // A repeated signal finds the handler still there, so Node's default (exit at once) never runs.
        expect(on.listenerCount('SIGINT')).to.equal(1);
    });

    it('exits with 1 when destroying the server fails', async () => {
        const on = new EventEmitter();
        const exited = new Promise<number>((resolve) => {
            stopOnSignals({ destroy: async () => { throw new Error('stuck'); } }, null, { on, exit: resolve });
        });
        on.emit('SIGINT');
        expect(await exited).to.equal(1);
    });
});
