import { expect } from 'chai';
import { PluginRegistry } from '@formio/appserver';
import { pdf, png } from '../helpers/documents';
import { identify, readAsText, converterFileReader, registerDocuments, MIME } from '../../src/documents';

async function registry() {
    const plugins = new PluginRegistry();
    registerDocuments(plugins);
    await plugins.initialize({ server: { config: {} } as any });
    return plugins;
}

describe('Documents: reading files as text', () => {
    const latinCsv = Buffer.from('name,city\nJos\xe9,M\xfcnchen\n', 'latin1');

    it('reads text files in a legacy 8-bit encoding (Latin-1, Windows-1252)', async () => {
        expect(identify(latinCsv, { name: 'people.csv' })).to.equal(MIME.csv);
        expect(identify(Buffer.from('caf\xe9 notes', 'latin1'), { name: 'notes.txt' })).to.equal(MIME.text);
        expect((await readAsText(await registry(), latinCsv, { name: 'people.csv' })).text).to.equal('name,city\nJosé,München\n');
        expect((await readAsText(await registry(), Buffer.from('smart \x93quotes\x94', 'latin1'), { name: 'a.txt' })).text).to.equal('smart “quotes”');
    });

    it('reads a Latin-1 CSV task input', async () => {
        const reader = converterFileReader(await registry());
        const meta = { name: 'people.csv', type: 'text/csv' } as any;
        expect(reader.accepts(meta, latinCsv.subarray(0, 16))).to.equal(true);
        expect((await reader.read(latinCsv, meta) as any).text).to.include('José');
    });

    it('still refuses binary content named as text', () => {
        expect(() => identify(Buffer.from([0x41, 0x00, 0x01, 0x42]), { name: 'notes.txt' })).to.throw('is named .txt');
        expect(identify(Buffer.from([0xe9, 0x01]), { name: 'data' })).to.equal(MIME.binary);
    });

    it('refuses an image or a scan, which has no text, instead of reading it as an empty document', async () => {
        const plugins = await registry();
        for (const [buffer, name] of [[png(4, 3), 'photo.png'], [pdf([[]]), 'scan.pdf']] as Array<[Buffer, string]>) {
            let error: any;
            try { await readAsText(plugins, buffer, { name }); }
            catch (err) { error = err; }
            expect(error?.name, name).to.equal('ConversionError');
            expect(error.message, name).to.include('has no text layer');
        }
        expect((await readAsText(plugins, Buffer.from(''), { name: 'empty.txt' })).text).to.equal('');
    });

    it('stops reading a task input when core aborts its read', async () => {
        const reader = converterFileReader(await registry());
        const controller = new AbortController();
        controller.abort(new Error('out of time'));
        let error: any;
        try { await reader.read(latinCsv, { name: 'people.csv', type: 'text/csv' } as any, { signal: controller.signal }); }
        catch (err) { error = err; }
        expect(error?.message).to.equal('out of time');
    });
});
