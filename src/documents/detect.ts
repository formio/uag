import { EXTENSIONS, FAMILY_BY_EXTENSION, MIME, TEXT_BY_EXTENSION, extensionOf, familyOf } from './mime';
import type { Converter } from './types';

/** A file refused for what its bytes are. The message names the file, never its content. */
export class DetectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DetectionError';
    }
}

const startsWith = (buffer: Buffer, bytes: number[] | string, offset = 0) => {
    const expected = typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes);
    return buffer.length >= offset + expected.length && buffer.subarray(offset, offset + expected.length).equals(expected);
};

/**
 * The names in a ZIP archive's central directory, read from the end of the
 * buffer only: no entry is ever inflated. Undefined when it is not a readable
 * ZIP archive.
 */
export function zipEntryNames(buffer: Buffer): string[] | undefined {
    // End of central directory: 22 bytes, plus a comment of up to 65535.
    const start = Math.max(0, buffer.length - 22 - 0xffff);
    let end = -1;
    for (let i = buffer.length - 22; i >= start; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) return undefined;
    const count = buffer.readUInt16LE(end + 10);
    const size = buffer.readUInt32LE(end + 12);
    let offset = buffer.readUInt32LE(end + 16);
    if (offset + size > end) return undefined;
    const names: string[] = [];
    for (let i = 0; i < count && offset + 46 <= end; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) return undefined;
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return names;
}

/** An ODF document's type, from its `mimetype` entry when stored uncompressed first, as ODF requires. */
function odfType(buffer: Buffer): string | undefined {
    if (buffer.readUInt32LE(0) !== 0x04034b50) return undefined;
    const method = buffer.readUInt16LE(8);
    const size = buffer.readUInt32LE(18);
    const nameLength = buffer.readUInt16LE(26);
    const extraLength = buffer.readUInt16LE(28);
    const name = buffer.subarray(30, 30 + nameLength).toString('utf8');
    if (method !== 0 || name !== 'mimetype' || size > 200) return undefined;
    const type = buffer.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + size).toString('ascii').trim();
    return /^application\/vnd\.oasis\.opendocument\.[a-z.-]+$/.test(type) ? type : undefined;
}

function zipType(buffer: Buffer): string {
    const names = zipEntryNames(buffer);
    if (!names) return MIME.zip;
    const has = new Set(names);
    if (has.has('word/document.xml')) return MIME.docx;
    if (has.has('xl/workbook.xml')) return MIME.xlsx;
    if (has.has('ppt/presentation.xml')) return MIME.pptx;
    if (has.has('mimetype')) return odfType(buffer) || MIME.zip;
    return MIME.zip;
}

/** Whether a buffer is valid UTF-8 (or UTF-16 with a byte order mark) without NUL bytes. */
export function isText(buffer: Buffer): boolean {
    if (startsWith(buffer, [0xff, 0xfe]) || startsWith(buffer, [0xfe, 0xff])) {
        return buffer.length % 2 === 0;
    }
    if (buffer.includes(0)) return false;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Whether a buffer is text in a legacy 8-bit encoding (Latin-1, Windows-1252):
 * no NUL bytes and no control characters other than tab, line breaks, form feed
 * and the DOS end-of-file mark. Spreadsheet and editor exports still write these.
 */
export function isLegacyText(buffer: Buffer): boolean {
    for (const byte of buffer) {
        if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c && byte !== 0x1a) return false;
    }
    return true;
}

/** The type the shared detection gives the bytes, or undefined when it does not know them. */
function signatureType(buffer: Buffer, ext: string): string | undefined {
    if (startsWith(buffer, '%PDF-')) return MIME.pdf;
    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return MIME.png;
    if (startsWith(buffer, [0xff, 0xd8, 0xff])) return MIME.jpeg;
    if (startsWith(buffer, 'GIF87a') || startsWith(buffer, 'GIF89a')) return MIME.gif;
    if (startsWith(buffer, 'RIFF') && startsWith(buffer, 'WEBP', 8)) return MIME.webp;
    if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])) return zipType(buffer);
    if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
        return ({ '.doc': MIME.doc, '.xls': MIME.xls, '.ppt': MIME.ppt } as Record<string, string>)[ext] || MIME.ole;
    }
    if (startsWith(buffer, '{\\rtf')) return MIME.rtf;
    return undefined;
}

/**
 * Identify a file's type from its bytes. The name and the client's MIME type
 * are hints only: known signatures first, then each converter's `detect`, then
 * text (typed by extension). A detected type that contradicts the family the
 * extension promises is refused.
 */
export function identify(buffer: Buffer, hint: { name: string; type?: string }, converters: Converter[] = []): string {
    const ext = extensionOf(hint.name);
    let type = signatureType(buffer, ext);
    if (!type) {
        const head = buffer.subarray(0, 4096);
        for (const converter of converters) {
            if (typeof converter.detect !== 'function') continue;
            const detected = converter.detect(head, { name: hint.name, type: hint.type || '' });
            if (typeof detected === 'string' && detected) { type = detected; break; }
        }
    }
    if (!type) {
        // Text named as text may also be in a legacy 8-bit encoding; decodeText reads it as Windows-1252.
        const text = isText(buffer) || (!!TEXT_BY_EXTENSION[ext] && isLegacyText(buffer));
        type = text ? (TEXT_BY_EXTENSION[ext] || MIME.text) : MIME.binary;
    }
    const promised = FAMILY_BY_EXTENSION[ext];
    if (promised && promised !== familyOf(type)) {
        throw new DetectionError(`"${hint.name}" is named ${ext} but its content is not a ${ext.slice(1).toUpperCase()} file; it was refused.`);
    }
    return type;
}

/** The extensions known for a type, from the converters that accept it and the usual ones. */
export function extensionsOf(type: string, converters: Converter[] = []): string[] {
    const fromConverters = converters.flatMap((converter) => converter.accepts.filter((accept) => accept.type === type).flatMap((accept) => accept.ext || []));
    return [...new Set([...fromConverters, ...(EXTENSIONS[type] || [])].map((ext) => ext.toLowerCase()))];
}
