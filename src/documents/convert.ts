import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginContext } from '@formio/appserver';
import type { Converter, ConverterOutput, Representation } from './types';

export const CONVERTER_DEFAULTS = { maxBytes: 25 * 1024 * 1024, timeoutMs: 120000, concurrency: 2 };

/** A conversion that did not complete. The message names the converter and the file, never its content. */
export class ConversionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ConversionError';
    }
}

/**
 * A queue per converter, so at most `concurrency` of its conversions run at
 * once. A slot is held until its conversion has actually stopped: a converter
 * that ignores its signal still counts after its caller has given up on it.
 */
class Queue {
    private running = 0;
    private waiting: Array<() => void> = [];
    constructor(private readonly limit: number) {}

    /** Wait for a slot; the returned function frees it (once). */
    async acquire(signal?: AbortSignal): Promise<() => void> {
        signal?.throwIfAborted();
        if (this.running < this.limit) {
            this.running++;
        }
        else {
            // A freed slot passes straight to the next waiter, so no new caller can take it in between.
            await new Promise<void>((resolve, reject) => {
                const go = () => { signal?.removeEventListener('abort', cancel); resolve(); };
                const cancel = () => { this.waiting = this.waiting.filter((entry) => entry !== go); reject(signal!.reason ?? new Error('aborted')); };
                this.waiting.push(go);
                signal?.addEventListener('abort', cancel, { once: true });
            });
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const next = this.waiting.shift();
            if (next) next();
            else this.running--;
        };
    }
}

const queues = new WeakMap<Converter, Queue>();

export type ConvertOptions = {
    to: Representation;
    settings?: Record<string, any>;
    signal?: AbortSignal;
    log: PluginContext['log'];
};

/**
 * Run one conversion: under the converter's size limit, in a temporary
 * directory made for the call and removed after it, aborted at its timeout,
 * and queued behind its other conversions beyond its concurrency.
 */
export async function runConverter(converter: Converter, input: { buffer: Buffer; type: string; name: string }, options: ConvertOptions): Promise<ConverterOutput> {
    const limits = { ...CONVERTER_DEFAULTS, ...(converter.limits || {}) };
    if (input.buffer.length > limits.maxBytes) {
        throw new ConversionError(`"${input.name}" is larger than the ${converter.name} converter takes (${limits.maxBytes} bytes).`);
    }
    let queue = queues.get(converter);
    if (!queue) {
        queue = new Queue(Math.max(1, limits.concurrency));
        queues.set(converter, queue);
    }
    const release = await queue.acquire(options.signal);
    let tmpdir: string;
    try {
        options.signal?.throwIfAborted();
        tmpdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'uag-convert-'));
    }
    catch (err) {
        release();
        throw err;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const work = Promise.resolve().then(() => converter.convert(input, { to: options.to, settings: options.settings || {}, signal: controller.signal, tmpdir, log: options.log }));
    // The slot and the temporary directory are kept until convert() settles, even after a timeout or an abort.
    const stopped = work.then(() => undefined, () => undefined).then(async () => {
        await fs.promises.rm(tmpdir, { recursive: true, force: true }).catch(() => undefined);
        release();
    });
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    try {
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const error = new ConversionError(`Converting "${input.name}" with ${converter.name} took longer than ${limits.timeoutMs} ms.`);
                // Abort first: a converter running a process stops it on its signal.
                controller.abort(error);
                reject(error);
            }, limits.timeoutMs);
        });
        const aborted = new Promise<never>((_, reject) => {
            if (controller.signal.aborted) reject(controller.signal.reason);
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
        });
        const output = await Promise.race([work.finally(() => { finished = true; }), timeout, aborted]);
        return checkOutput(converter, input.name, options.to, output);
    }
    finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        // A conversion that completed has its directory removed before its result is used.
        if (finished) await stopped;
    }
}

function checkOutput(converter: Converter, name: string, to: Representation, output: any): ConverterOutput {
    if (to === 'pdf') {
        if (!output || !Buffer.isBuffer(output.pdf)) throw new ConversionError(`The ${converter.name} converter did not produce a PDF for "${name}".`);
        return output;
    }
    if (!output || typeof output.text !== 'string' || !['plain', 'markdown', 'csv'].includes(output.textFormat)) {
        throw new ConversionError(`The ${converter.name} converter did not produce text for "${name}".`);
    }
    return output;
}

/**
 * Run a route: each step's output feeds the next (an intermediate step always
 * makes a PDF), with each converter's operator settings.
 */
export async function runRoute(
    steps: Converter[],
    input: { buffer: Buffer; type: string; name: string },
    to: Representation,
    options: Omit<ConvertOptions, 'to' | 'settings'> & { settingsOf?: (converter: Converter) => Record<string, any> | undefined }
): Promise<ConverterOutput> {
    let current = input;
    let output: ConverterOutput | undefined;
    for (let i = 0; i < steps.length; i++) {
        const target: Representation = i === steps.length - 1 ? to : 'pdf';
        output = await runConverter(steps[i], current, { ...options, to: target, settings: options.settingsOf?.(steps[i]) });
        if (target === 'pdf') current = { buffer: (output as any).pdf, type: 'application/pdf', name: input.name };
    }
    if (!output) throw new ConversionError(`No converter step for "${input.name}".`);
    return output;
}
