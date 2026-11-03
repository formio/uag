import { expect } from 'chai';
import { runConverter, pdfTextConverter, textConverter, imagePdfConverter, MIME } from '../../src/documents';
import { pdf, png, recordingLog } from '../helpers/documents';

const run = (converter: any, buffer: Buffer, type: string, to: 'pdf' | 'text') => runConverter(converter, { buffer, type, name: 'file' }, { to, log: recordingLog().log }) as Promise<any>;

describe('Documents: built-in converters', () => {
    it('pdf-text reads the text layer page by page', async () => {
        const out = await run(pdfTextConverter, pdf([['First page line'], ['Second page line']]), MIME.pdf, 'text');
        expect(out.textFormat).to.equal('plain');
        expect(out.pages).to.deep.equal([{ page: 1, text: 'First page line' }, { page: 2, text: 'Second page line' }]);
        expect(out.text).to.equal('First page line\n\nSecond page line');
        expect(out).to.not.have.property('warnings');
    });

    it('pdf-text warns about a PDF with no text layer', async () => {
        const out = await run(pdfTextConverter, pdf([[]]), MIME.pdf, 'text');
        expect(out.text).to.equal('');
        expect(out.warnings[0]).to.include('has no text layer');
    });

    it('text decodes UTF-8 and UTF-16, turns HTML into Markdown, and types its text', async () => {
        expect(await run(textConverter, Buffer.from('﻿Hello'), MIME.text, 'text')).to.deep.equal({ text: 'Hello', textFormat: 'plain' });
        expect((await run(textConverter, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hé', 'utf16le')]), MIME.text, 'text')).text).to.equal('Hé');
        expect(await run(textConverter, Buffer.from('<h1>Title</h1><p>Some <b>bold</b></p>'), MIME.html, 'text')).to.deep.equal({ text: '# Title\n\nSome **bold**', textFormat: 'markdown' });
        expect((await run(textConverter, Buffer.from('a,b'), MIME.csv, 'text')).textFormat).to.equal('csv');
        expect((await run(textConverter, Buffer.from('# x'), MIME.markdown, 'text')).textFormat).to.equal('markdown');
    });

    it('image-pdf makes a one-page PDF of an image', async () => {
        const out = await run(imagePdfConverter, png(4, 3), MIME.png, 'pdf');
        expect(out.pages).to.equal(1);
        expect(out.pdf.subarray(0, 5).toString()).to.equal('%PDF-');
        const { PDFDocument } = require('pdf-lib');
        expect((await PDFDocument.load(out.pdf)).getPageCount()).to.equal(1);
    });
});
