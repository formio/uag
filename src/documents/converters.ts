import { NodeHtmlMarkdown } from 'node-html-markdown';
import { MIME } from './mime';
import { ConversionError } from './convert';
import type { Converter, TextFormat } from './types';
import { UAG_VERSION } from '../version';

/**
 * A real dynamic import: TypeScript compiles `import()` in a CommonJS build to
 * `require()`, which cannot load an ES module before Node 22.12.
 */
const esmImport: (specifier: string) => Promise<any> = new Function('specifier', 'return import(specifier)') as any;

/** unpdf, loaded on first use: it is an ES module, and carries a PDF.js build. */
export function loadUnpdf(): Promise<typeof import('unpdf')> {
    return esmImport('unpdf');
}

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
        const { extractText, getDocumentProxy } = await loadUnpdf();
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

/** Decode text: UTF-16 with a byte order mark, else UTF-8 (without its BOM), else Windows-1252 (a superset of Latin-1). */
export function decodeText(buffer: Buffer): string {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    }
    catch {
        return new TextDecoder('windows-1252').decode(buffer);
    }
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

/**
 * The most pixels of a PNG image-pdf takes (50 megapixels, about 200 MB once
 * decoded). A PNG is decoded whole, in memory and synchronously, so its pixel
 * count is checked from its header first: a small, highly compressed file can
 * describe an image far larger than its size suggests. JPEGs are embedded
 * without being decoded. The converter's `maxPixels` setting changes it
 * (config.plugins.settings.converter['image-pdf'].maxPixels, or
 * DOCUMENTS_MAX_IMAGE_PIXELS).
 */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** A PNG's width and height, from its IHDR header; undefined when it has none. */
export function pngSize(buffer: Buffer): { width: number; height: number } | undefined {
    if (buffer.length < 24 || buffer.toString('latin1', 12, 16) !== 'IHDR') return undefined;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

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
    settings: {
        maxPixels: {
            type: 'number',
            env: 'DOCUMENTS_MAX_IMAGE_PIXELS',
            default: MAX_IMAGE_PIXELS,
            description: 'The largest PNG, in pixels (width × height), converted; a larger one is refused before it is decoded.'
        }
    },
    async convert(input, options) {
        options.signal.throwIfAborted();
        if (input.type === MIME.png) {
            const size = pngSize(input.buffer);
            if (!size) throw new ConversionError(`"${input.name}" is not a PNG image the image-pdf converter can read.`);
            const maxPixels = Number(options.settings?.maxPixels) > 0 ? Number(options.settings.maxPixels) : MAX_IMAGE_PIXELS;
            if (size.width * size.height > maxPixels) {
                throw new ConversionError(`"${input.name}" is ${size.width}×${size.height} pixels, more than the image-pdf converter takes (${maxPixels} pixels).`);
            }
        }
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
