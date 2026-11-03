import { NodeHtmlMarkdown } from 'node-html-markdown';
import { MIME } from './mime';
import type { Converter, TextFormat } from './types';
import { UAG_VERSION } from '../version';

/** pdf-text: a PDF's text layer, page by page, with unpdf. */
export const pdfTextConverter: Converter = {
    type: 'converter',
    name: 'pdf-text',
    title: 'PDF text',
    description: 'The text layer of a PDF, page by page. A PDF without one (a scan) yields empty text and a warning.',
    version: UAG_VERSION,
    apiVersion: 1,
    accepts: [{ type: MIME.pdf, ext: ['.pdf'] }],
    produces: ['text'],
    async convert(input, options) {
        options.signal.throwIfAborted();
        // Loaded on first use: it carries a PDF.js build.
        const { extractText, getDocumentProxy } = require('unpdf');
        const document = await getDocumentProxy(new Uint8Array(input.buffer));
        const { totalPages, text } = await extractText(document, { mergePages: false });
        const pages = (text as string[]).map((pageText, i) => ({ page: i + 1, text: String(pageText || '').trim() }));
        const all = pages.map((page) => page.text).join('\n\n').trim();
        return {
            text: all,
            textFormat: 'plain',
            pages,
            ...(!all && { warnings: [`"${input.name}" has no text layer (${totalPages} page${totalPages === 1 ? '' : 's'}): it may be a scan.`] })
        };
    }
};

/** Decode text: UTF-16 with a byte order mark, else UTF-8 (without its BOM). */
export function decodeText(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
    return new TextDecoder('utf-8').decode(buffer).replace(/^﻿/, '');
}

const TEXT_FORMATS: Record<string, TextFormat> = {
    [MIME.markdown]: 'markdown',
    [MIME.html]: 'markdown',
    [MIME.csv]: 'csv'
};

/** text: plain text, Markdown, CSV, JSON, HTML (as Markdown) and XML. */
export const textConverter: Converter = {
    type: 'converter',
    name: 'text',
    title: 'Text',
    description: 'Text files as they are; HTML as Markdown.',
    version: UAG_VERSION,
    apiVersion: 1,
    accepts: [
        { type: MIME.text, ext: ['.txt'] },
        { type: MIME.markdown, ext: ['.md', '.markdown'] },
        { type: MIME.csv, ext: ['.csv'] },
        { type: MIME.json, ext: ['.json'] },
        { type: MIME.html, ext: ['.html', '.htm'] },
        { type: MIME.xml, ext: ['.xml'] }
    ],
    produces: ['text'],
    async convert(input, options) {
        options.signal.throwIfAborted();
        const decoded = decodeText(input.buffer);
        const text = input.type === MIME.html ? NodeHtmlMarkdown.translate(decoded) : decoded;
        return { text, textFormat: TEXT_FORMATS[input.type] || 'plain' };
    }
};

/** A4 portrait, in points. */
const PAGE = { width: 595.28, height: 841.89, margin: 36 };

/** image-pdf: PNG and JPEG images into a PDF, one page per image, scaled to fit and never resampled. */
export const imagePdfConverter: Converter = {
    type: 'converter',
    name: 'image-pdf',
    title: 'Image to PDF',
    description: 'A PNG or JPEG image as a one-page PDF, scaled to fit the page.',
    version: UAG_VERSION,
    apiVersion: 1,
    accepts: [{ type: MIME.png, ext: ['.png'] }, { type: MIME.jpeg, ext: ['.jpg', '.jpeg'] }],
    produces: ['pdf'],
    async convert(input, options) {
        options.signal.throwIfAborted();
        const { PDFDocument } = require('pdf-lib');
        const pdf = await PDFDocument.create();
        const image = input.type === MIME.png ? await pdf.embedPng(input.buffer) : await pdf.embedJpg(input.buffer);
        const landscape = image.width > image.height;
        const width = landscape ? PAGE.height : PAGE.width;
        const height = landscape ? PAGE.width : PAGE.height;
        const scale = Math.min(1, (width - 2 * PAGE.margin) / image.width, (height - 2 * PAGE.margin) / image.height);
        const page = pdf.addPage([width, height]);
        const drawn = { width: image.width * scale, height: image.height * scale };
        // The image is embedded as it is and only drawn smaller: its pixels are never resampled.
        page.drawImage(image, { x: (width - drawn.width) / 2, y: (height - drawn.height) / 2, ...drawn });
        return { pdf: Buffer.from(await pdf.save()), pages: 1 };
    }
};

/** The converters every UAG has. None needs a system binary. */
export const BUILT_IN_CONVERTERS: Converter[] = [pdfTextConverter, textConverter, imagePdfConverter];
