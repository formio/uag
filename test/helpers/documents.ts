/**
 * Real documents, built in memory, so the tests exercise the parsers rather
 * than mocks of them and the repository carries no binary fixtures.
 */
import zlib from 'zlib';

/** A PDF with one page per entry, each a list of lines of Helvetica text; an empty page has no text layer. */
export function pdf(pages: string[][] | string[]): Buffer {
    const list: string[][] = Array.isArray(pages[0]) ? pages as string[][] : [pages as string[]];
    const escape = (text: string) => text.replace(/[()\\]/g, '\\$&');
    const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
    const kids: string[] = [];
    for (const lines of list) {
        const stream = lines.length ? 'BT /F1 12 Tf 72 720 Td 14 TL ' + lines.map((line) => `(${escape(line)}) Tj T*`).join(' ') + ' ET' : '';
        const pageId = objects.length + 1;
        kids.push(`${pageId} 0 R`);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${pageId + 2} 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
        objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    }
    objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${list.length} >>`;
    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((object, i) => {
        offsets.push(out.length);
        out += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
}

/** A zip archive of the given files, stored uncompressed. */
export function zip(files: Record<string, string | Buffer>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
        const data = Buffer.from(content as any);
        const nameBytes = Buffer.from(name);
        const crc = (zlib as any).crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, data);
        centrals.push(central, nameBytes);
        offset += local.length + nameBytes.length + data.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

/** A Word document whose paragraphs are runs of `{ text, bold }`. */
export function docx(paragraphs: Array<Array<{ text: string; bold?: boolean }>>): Buffer {
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = paragraphs.map((runs) => '<w:p>' + runs.map((run) =>
        `<w:r>${run.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${escape(run.text)}</w:t></w:r>`).join('') + '</w:p>').join('');
    return zip({
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            `<w:body>${body}</w:body></w:document>`
    });
}

/** A 2x2 PNG, made with zlib. */
export function png(width = 2, height = 2): Buffer {
    const crcOf = (buffer: Buffer) => (zlib as any).crc32(buffer) >>> 0;
    const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crcOf(body));
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)])));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** A file component's value for a base64 upload. */
export function upload(buffer: Buffer, name: string, type: string) {
    return { storage: 'base64', name, originalName: name, type, size: buffer.length, url: `data:${type};base64,${buffer.toString('base64')}` };
}

/** A logger that records its lines. */
export function recordingLog() {
    const lines: string[] = [];
    return { lines, log: { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } };
}
