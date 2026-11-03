/** Canonical MIME types the UAG identifies, and the extensions that go with them. */
export const MIME = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword',
    xls: 'application/vnd.ms-excel',
    ppt: 'application/vnd.ms-powerpoint',
    rtf: 'application/rtf',
    zip: 'application/zip',
    ole: 'application/x-ole-storage',
    text: 'text/plain',
    markdown: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    xml: 'application/xml',
    binary: 'application/octet-stream'
} as const;

/** Text types, by extension. */
export const TEXT_BY_EXTENSION: Record<string, string> = {
    '.txt': MIME.text,
    '.text': MIME.text,
    '.md': MIME.markdown,
    '.markdown': MIME.markdown,
    '.csv': MIME.csv,
    '.json': MIME.json,
    '.html': MIME.html,
    '.htm': MIME.html,
    '.xml': MIME.xml
};

/** The usual extensions of each type, for the builder's file picker. */
export const EXTENSIONS: Record<string, string[]> = {
    [MIME.pdf]: ['.pdf'],
    [MIME.png]: ['.png'],
    [MIME.jpeg]: ['.jpg', '.jpeg'],
    [MIME.gif]: ['.gif'],
    [MIME.webp]: ['.webp'],
    [MIME.docx]: ['.docx'],
    [MIME.xlsx]: ['.xlsx'],
    [MIME.pptx]: ['.pptx'],
    [MIME.doc]: ['.doc'],
    [MIME.xls]: ['.xls'],
    [MIME.ppt]: ['.ppt'],
    [MIME.rtf]: ['.rtf'],
    [MIME.text]: ['.txt'],
    [MIME.markdown]: ['.md', '.markdown'],
    [MIME.csv]: ['.csv'],
    [MIME.json]: ['.json'],
    [MIME.html]: ['.html', '.htm'],
    [MIME.xml]: ['.xml'],
    'application/vnd.oasis.opendocument.text': ['.odt'],
    'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
    'application/vnd.oasis.opendocument.presentation': ['.odp']
};

/**
 * The family of content an extension promises. A file whose detected content
 * belongs to another family is refused: a disguised file.
 */
export const FAMILY_BY_EXTENSION: Record<string, string> = {
    '.pdf': 'pdf',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image',
    '.docx': 'zip', '.xlsx': 'zip', '.pptx': 'zip', '.odt': 'zip', '.ods': 'zip', '.odp': 'zip', '.zip': 'zip',
    '.doc': 'ole', '.xls': 'ole', '.ppt': 'ole',
    '.rtf': 'rtf',
    ...Object.fromEntries(Object.keys(TEXT_BY_EXTENSION).map((ext) => [ext, 'text']))
};

/** The family of a detected type. */
export function familyOf(type: string): string {
    if (type === MIME.pdf) return 'pdf';
    if (type.startsWith('image/')) return 'image';
    if ([MIME.docx, MIME.xlsx, MIME.pptx, MIME.zip].includes(type as any) || type.startsWith('application/vnd.oasis.opendocument.')) return 'zip';
    if ([MIME.doc, MIME.xls, MIME.ppt, MIME.ole].includes(type as any)) return 'ole';
    if (type === MIME.rtf) return 'rtf';
    if (type.startsWith('text/') || type === MIME.json || type === MIME.xml) return 'text';
    return 'other';
}

/** A file name's extension, lower-case with its dot ('' when it has none). */
export function extensionOf(name: string | undefined): string {
    const match = /(\.[A-Za-z0-9]+)$/.exec(String(name || ''));
    return match ? match[1].toLowerCase() : '';
}

/** Whether a type is one the built-in text converter reads. */
export const TEXT_TYPES = [MIME.text, MIME.markdown, MIME.csv, MIME.json, MIME.html, MIME.xml] as string[];
