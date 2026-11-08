import type { PluginRegistry } from '@formio/appserver';
import type { FormflowFileReader } from '../formflow';
import { identify } from './detect';
import { ConversionError, runRoute } from './convert';
import { MIME, extensionOf } from './mime';
import { documentsOf } from './plugins';
import type { Converter } from './types';

/** What a ZIP file is, from its extension: the first bytes cannot tell a Word file from any other ZIP. */
const ZIP_BY_EXTENSION: Record<string, string> = {
    '.docx': MIME.docx, '.xlsx': MIME.xlsx, '.pptx': MIME.pptx,
    '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.odp': 'application/vnd.oasis.opendocument.presentation'
};

const log = {
    info: () => undefined,
    warn: (msg: string) => console.warn(`[formio-uag] ${msg}`),
    error: (msg: string) => console.error(`[formio-uag] ${msg}`)
};

/** Read a file as text through the converters: its detected type, its text, and its page count when known. */
export async function readAsText(registry: PluginRegistry, buffer: Buffer, meta: { name: string; type?: string }, options: { signal?: AbortSignal } = {}): Promise<{ type: string; text: string; pages?: number }> {
    const converters = registry.list<Converter>('converter');
    const type = identify(buffer, { name: meta.name, type: meta.type }, converters);
    const steps = documentsOf(registry).routes.toText(type);
    if (!steps) {
        throw new Error(`"${meta.name}" (${type}) cannot be read as text: no installed converter reads it.`);
    }
    const output: any = await runRoute(steps, { buffer, type, name: meta.name }, 'text', {
        log,
        signal: options.signal,
        settingsOf: (converter) => registry.settings('converter', converter.name)
    });
    // No text, with the converters saying why (an image, a scan): an error, never an empty document.
    if (!String(output.text).trim() && Array.isArray(output.warnings) && output.warnings.length) {
        throw new ConversionError(`"${meta.name}" has no text to read: ${output.warnings.join(' ')}`);
    }
    return { type, text: output.text, ...(Array.isArray(output.pages) && { pages: output.pages.length }) };
}

/**
 * A reader for task file inputs, built from the converters: it accepts a file
 * whose type has a route to text, and reads it through that route. Task file
 * inputs therefore read every type the installed converters handle.
 */
export function converterFileReader(registry: PluginRegistry): FormflowFileReader {
    const converters = () => registry.list<Converter>('converter');
    return {
        name: 'converters',
        accepts(meta, head) {
            let type: string;
            try {
                type = identify(head, { name: meta.name, type: meta.type }, converters());
            }
            catch {
                // Too few bytes to be sure, or a name that contradicts them: read() decides on the whole file.
                return true;
            }
            if (type === MIME.zip) type = ZIP_BY_EXTENSION[extensionOf(meta.name)] || type;
            return !!documentsOf(registry).routes.toText(type);
        },
        async read(buffer, meta, options) {
            return { text: (await readAsText(registry, buffer, meta, { signal: options?.signal })).text };
        }
    };
}
