import { expect } from 'chai';
import fs from 'fs';
import { runConverter } from '../../src/documents';
import { recordingLog } from '../helpers/documents';

const input = { buffer: Buffer.from('x'), type: 'text/plain', name: 'x.txt' };
const converter = (convert: any, limits: any = {}): any => ({ type: 'converter', name: 'slow', title: 'Slow', version: '1.0.0', apiVersion: 1, accepts: [{ type: 'text/plain' }], produces: ['text'], limits, convert });

describe('Documents: running converters', () => {
    it('gives each call its own temporary directory, removed after it', async () => {
        let dir = '';
        const output = await runConverter(converter(async (_: any, options: any) => {
            dir = options.tmpdir;
            fs.writeFileSync(`${dir}/work.txt`, 'scratch');
            return { text: 'ok', textFormat: 'plain' };
        }), input, { to: 'text', log: recordingLog().log });
        expect(output).to.deep.equal({ text: 'ok', textFormat: 'plain' });
        expect(dir).to.match(/uag-convert-/);
        expect(fs.existsSync(dir)).to.equal(false);
    });

    it('aborts at its timeout, naming it, and cleans up', async () => {
        let dir = '';
        let signalled = false;
        const slow = converter((_: any, options: any) => new Promise((resolve) => {
            dir = options.tmpdir;
            options.signal.addEventListener('abort', () => { signalled = true; });
            setTimeout(() => resolve({ text: 'late', textFormat: 'plain' }), 500);
        }), { timeoutMs: 30 });
        let message = '';
        try { await runConverter(slow, input, { to: 'text', log: recordingLog().log }); } catch (err: any) { message = err.message; }
        expect(message).to.include('took longer than 30 ms');
        expect(signalled).to.equal(true);
        expect(fs.existsSync(dir)).to.equal(false);
    });

    it('queues calls beyond its concurrency', async () => {
        let running = 0;
        let most = 0;
        const busy = converter(async () => {
            running++; most = Math.max(most, running);
            await new Promise((r) => setTimeout(r, 20));
            running--;
            return { text: 'ok', textFormat: 'plain' };
        }, { concurrency: 2 });
        await Promise.all([1, 2, 3, 4].map(() => runConverter(busy, input, { to: 'text', log: recordingLog().log })));
        expect(most).to.equal(2);
    });

    it('refuses a file over its size limit, and output of the wrong shape', async () => {
        const small = converter(async () => ({ text: 'ok', textFormat: 'plain' }), { maxBytes: 0.5 });
        let message = '';
        try { await runConverter(small, input, { to: 'text', log: recordingLog().log }); } catch (err: any) { message = err.message; }
        expect(message).to.include('larger than the slow converter takes');
        try { await runConverter(converter(async () => ({ pdf: 'nope' })), input, { to: 'pdf', log: recordingLog().log }); } catch (err: any) { message = err.message; }
        expect(message).to.include('did not produce a PDF');
    });

    it('stops when the request is aborted', async () => {
        const controller = new AbortController();
        const never = converter(() => new Promise(() => {}));
        const running = runConverter(never, input, { to: 'text', signal: controller.signal, log: recordingLog().log });
        controller.abort(new Error('closed'));
        let message = '';
        try { await running; } catch (err: any) { message = err.message; }
        expect(message).to.equal('closed');
    });
});
