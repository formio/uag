import { MIME, TEXT_TYPES } from './mime';
import { extensionsOf } from './detect';
import type { Converter, Representation } from './types';

/** How one file reaches the representations of one of a plugin's input sets. */
export type FileRoute = {
    inputs: Representation[];
    /** The converters that make the PDF ([] for a PDF: identity). */
    pdf?: Converter[];
    /** The converters that make the text; with a PDF in the set, the PDF's own steps then PDF to text. */
    text?: Converter[];
};

/** Converter pins by source type: a component's `uag.converters`. */
export type Pins = Record<string, string>;

/** A source type a document plugin can take, as its manifest's `accept` lists it. */
export type AcceptEntry = {
    type: string;
    ext: string[];
    /** The input set it reaches, and the converter names of each representation's route. */
    routes: { inputs: Representation[]; pdf?: string[]; text?: string[] };
    /** The converters that read this type: a pin chooses among them when there are several. */
    converters: string[];
};

/** A converter as `name@version`, as results record routes. */
export const stepName = (converter: Converter) => `${converter.name}@${converter.version}`;

/**
 * Routes from source types to representations over a set of converters.
 * When several converters can do a step, the component's pin wins, then the
 * operator's `documents.prefer`, then the highest rank, then the name.
 */
export class ConverterRoutes {
    constructor(public readonly converters: Converter[], private readonly prefer: Record<string, string> = {}) {}

    /** The converter for one step from `source` to `target`, or undefined when none can do it. */
    choose(source: string, target: Representation, pins: Pins = {}): Converter | undefined {
        const candidates = this.converters.filter((converter) =>
            converter.produces.includes(target) && converter.accepts.some((accept) => accept.type === source));
        if (!candidates.length) return undefined;
        for (const preferred of [pins[source], this.prefer[source]]) {
            const found = preferred && candidates.find((converter) => converter.name === preferred);
            if (found) return found;
        }
        return [...candidates].sort((a, b) => ((b.rank || 0) - (a.rank || 0)) || a.name.localeCompare(b.name))[0];
    }

    /** The steps from `source` to a PDF: [] for a PDF, one converter otherwise, or null. */
    toPdf(source: string, pins: Pins = {}): Converter[] | null {
        if (source === MIME.pdf) return [];
        const converter = this.choose(source, 'pdf', pins);
        return converter ? [converter] : null;
    }

    /** The steps from `source` to text: one converter, or to a PDF and then its text; null when none. */
    toText(source: string, pins: Pins = {}): Converter[] | null {
        const direct = this.choose(source, 'text', pins);
        if (direct) return [direct];
        const pdf = this.toPdf(source, pins);
        const fromPdf = pdf && this.choose(MIME.pdf, 'text', pins);
        return pdf && fromPdf ? [...pdf, fromPdf] : null;
    }

    /**
     * The first of a plugin's input sets every representation of which the
     * file can reach. With both PDF and text, the text is always that same
     * PDF's text, so content made from the PDF is checked against it.
     */
    route(source: string, inputs: Representation[][], pins: Pins = {}): FileRoute | null {
        for (const set of inputs) {
            if (set.includes('pdf')) {
                const pdf = this.toPdf(source, pins);
                if (!pdf) continue;
                if (!set.includes('text')) return { inputs: set, pdf };
                const fromPdf = this.choose(MIME.pdf, 'text', pins);
                if (!fromPdf) continue;
                return { inputs: set, pdf, text: [...pdf, fromPdf] };
            }
            if (set.includes('text')) {
                const text = this.toText(source, pins);
                if (text) return { inputs: set, text };
            }
        }
        return null;
    }

    /** Every source type a converter reads, and PDF. */
    sourceTypes(): string[] {
        return [...new Set([MIME.pdf, ...TEXT_TYPES.filter((type) => this.converters.some((c) => c.accepts.some((a) => a.type === type))),
            ...this.converters.flatMap((converter) => converter.accepts.map((accept) => accept.type))])];
    }

    /** The source types a plugin with these inputs can take, with their routes: its manifest's `accept`. */
    accept(inputs: Representation[][]): AcceptEntry[] {
        const entries: AcceptEntry[] = [];
        for (const type of this.sourceTypes()) {
            const route = this.route(type, inputs);
            if (!route) continue;
            entries.push({
                type,
                ext: extensionsOf(type, this.converters),
                routes: {
                    inputs: route.inputs,
                    ...(route.pdf && { pdf: route.pdf.map((c) => c.name) }),
                    ...(route.text && { text: route.text.map((c) => c.name) })
                },
                converters: this.converters.filter((c) => c.accepts.some((a) => a.type === type)).map((c) => c.name)
            });
        }
        return entries;
    }
}
