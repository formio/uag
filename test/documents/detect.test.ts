import { expect } from 'chai';
import { identify, zipEntryNames, MIME } from '../../src/documents';
import { docx, pdf, png, zip } from '../helpers/documents';

const refused = (fn: () => any) => { try { fn(); return ''; } catch (err: any) { return err.message; } };

describe('Documents: identifying files by their bytes', () => {
    it('knows each signature', () => {
        const cases: Array<[Buffer, string, string]> = [
            [pdf(['Hello']), 'a.pdf', MIME.pdf],
            [png(), 'a.png', MIME.png],
            [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'a.jpg', MIME.jpeg],
            [Buffer.from('GIF89a\x01\x00', 'latin1'), 'a.gif', MIME.gif],
            [Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), 'a.webp', MIME.webp],
            [docx([[{ text: 'Hi' }]]), 'a.docx', MIME.docx],
            [zip({ '[Content_Types].xml': '<x/>', 'xl/workbook.xml': '<x/>' }), 'a.xlsx', MIME.xlsx],
            [zip({ '[Content_Types].xml': '<x/>', 'ppt/presentation.xml': '<x/>' }), 'a.pptx', MIME.pptx],
            [zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' }), 'a.odt', 'application/vnd.oasis.opendocument.text'],
            [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'a.doc', MIME.doc],
            [Buffer.from('{\\rtf1\\ansi Hello}'), 'a.rtf', MIME.rtf]
        ];
        for (const [buffer, name, type] of cases) {
            expect(identify(buffer, { name }), name).to.equal(type);
        }
    });

    it('takes the name only as a hint: a docx named without its extension is still a docx', () => {
        expect(identify(docx([[{ text: 'Hi' }]]), { name: 'upload', type: 'application/octet-stream' })).to.equal(MIME.docx);
    });

    it('reads a ZIP\'s central directory only, and a ZIP that is not Office is a ZIP', () => {
        const archive = zip({ 'notes/a.txt': 'x', 'b.bin': Buffer.alloc(10) });
        expect(zipEntryNames(archive)).to.deep.equal(['notes/a.txt', 'b.bin']);
        expect(identify(archive, { name: 'archive.zip' })).to.equal(MIME.zip);
        // A ZIP named .docx is refused only if its content is not a ZIP at all; an Office-less ZIP named .docx is a ZIP.
        expect(identify(archive, { name: 'fake.docx' })).to.equal(MIME.zip);
    });

    it('refuses a disguised executable named .pdf', () => {
        const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64, 0)]);
        expect(refused(() => identify(exe, { name: 'report.pdf', type: 'application/pdf' }))).to.include('"report.pdf" is named .pdf but its content is not a PDF file');
        expect(refused(() => identify(Buffer.from('plain words'), { name: 'report.pdf' }))).to.include('is named .pdf');
        expect(refused(() => identify(png(), { name: 'notes.txt' }))).to.include('is named .txt');
    });

    it('tells text from binary, typing text by its extension', () => {
        expect(identify(Buffer.from('a,b\n1,2\n'), { name: 'data.csv' })).to.equal(MIME.csv);
        expect(identify(Buffer.from('# Title'), { name: 'notes.md' })).to.equal(MIME.markdown);
        expect(identify(Buffer.from('{"a":1}'), { name: 'x.json' })).to.equal(MIME.json);
        expect(identify(Buffer.from('<p>Hi</p>'), { name: 'x.html' })).to.equal(MIME.html);
        expect(identify(Buffer.from('plain'), { name: 'notes' })).to.equal(MIME.text);
        expect(identify(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hi', 'utf16le')]), { name: 'u.txt' })).to.equal(MIME.text);
        expect(identify(Buffer.from([0x41, 0x00, 0x42]), { name: 'data' })).to.equal(MIME.binary);
        expect(identify(Buffer.from([0xc3, 0x28]), { name: 'bad' })).to.equal(MIME.binary);
    });

    it('asks converters to detect formats the shared detection does not know, before calling them text', () => {
        const sample: any = { name: 'sample-text', accepts: [], detect: (head: Buffer) => head.subarray(0, 11).toString() === 'UAGSAMPLE1\n' ? 'application/x-uag-sample' : null };
        expect(identify(Buffer.from('UAGSAMPLE1\nhello'), { name: 'x.uagsample' }, [sample])).to.equal('application/x-uag-sample');
        expect(identify(Buffer.from('hello'), { name: 'x.txt' }, [sample])).to.equal(MIME.text);
    });
});
