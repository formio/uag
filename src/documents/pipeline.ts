import { createHash } from 'crypto';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { Utils } from '@formio/core';
import type { AuthRequest } from '@formio/appserver';
import { formflow, FormflowError } from '../formflow';
import type { UAGProjectInterface } from '../UAGProjectInterface';
import type { UAGFormInterface } from '../UAGFormInterface';
import { sanitizeMarkdown } from '../markdown';
import { identify, DetectionError } from './detect';
import { runRoute, runConverter } from './convert';
import { documentsOf } from './plugins';
import { FileRoute, stepName } from './routes';
import { documentsSettings, DocumentsSettings } from './settings';
import { MIME } from './mime';
import type { Converter, DocumentContext, DocumentFile, DocumentPlugin, Issue, Representation } from './types';

const MAX_ISSUES = 50;
const MAX_ISSUE_CHARS = 300;

/** The stored `result` of an AI Document. */
export type DocumentResultValue = {
    content: string;
    format: 'markdown' | 'text';
    status: 'ok' | 'flagged';
    issues: Issue[];
    summary: string;
    edited: boolean;
    meta: { plugin: string; engine: string; model: string; files: Array<{ name: string; route: string[]; pages?: number }> };
};

export type ProcessProgress = (fraction: number, message?: string) => void;

export type PreparedDocument = {
    plugin: DocumentPlugin;
    /** Convert, run the plugin and normalize its content. Failures are FormflowErrors whose messages carry no document text. */
    run(options: { signal: AbortSignal; progress: ProcessProgress }): Promise<DocumentResultValue>;
};

const misconfigured = (label: string, why: string) =>
    new FormflowError(422, `The AI Document "${label}" is misconfigured: ${why}`, 'document_misconfigured');

/** The component at a data path in the stored form, row indices removed (`rows[2].contract` is `rows.contract`). */
function componentAt(components: any[], dataPath: string): any {
    const path = dataPath.replace(/\[\d+\]/g, '');
    let found: any;
    // The data path: with every component included, the second argument also names layout components (panels, columns).
    Utils.eachComponent(components, (component: any, componentPath: string, _components: any, _parent: any, paths: any) => {
        if (!found && (paths?.path ?? componentPath) === path) found = component;
    }, true);
    return found;
}

/** A component anywhere in the form, by key. */
function componentByKey(components: any[], key: string): any {
    let found: any;
    Utils.eachComponent(components, (component: any) => {
        if (!found && component.key === key) found = component;
    }, true);
    return found;
}

/** The instructions as Markdown: written HTML, or a content component's HTML. No {{ }} interpolation. */
function instructionsOf(form: any, uag: any, label: string): string {
    let html = '';
    if (uag.instructionsComponent) {
        const content = componentByKey(form.components || [], uag.instructionsComponent);
        if (!content || typeof content.html !== 'string') {
            throw misconfigured(label, `its instructions component "${uag.instructionsComponent}" is not a content component of the form.`);
        }
        html = content.html;
    }
    else {
        html = String(uag.instructions || '');
    }
    const markdown = NodeHtmlMarkdown.translate(html).trim();
    if (!markdown) throw misconfigured(label, 'it has no instructions.');
    return markdown;
}

const clip = (value: unknown) => typeof value === 'string' ? value.slice(0, MAX_ISSUE_CHARS) : undefined;

function normalizeIssues(issues: unknown): Issue[] {
    if (!Array.isArray(issues)) return [];
    return issues.slice(0, MAX_ISSUES).filter((issue) => issue && typeof issue === 'object').map((issue: any) => {
        const out: any = { kind: clip(String(issue.kind ?? 'issue')), message: clip(String(issue.message ?? '')) };
        for (const key of ['output', 'document', 'file']) if (typeof issue[key] === 'string') out[key] = clip(issue[key]);
        if (Number.isInteger(issue.page)) out.page = issue.page;
        return out;
    });
}

/** Strip control characters other than newline and tab from plain text content. */
const plainText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

async function countPages(pdf: Buffer): Promise<number | undefined> {
    try {
        const { PDFDocument } = require('pdf-lib');
        return (await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
    }
    catch {
        return undefined;
    }
}

/**
 * Check a process request and load its files: the component (from the stored
 * form, never the request), the caller's access and the license, the
 * instructions, each file (read with the caller's credentials, identified by
 * its bytes, accepted by the component, routed to the plugin's
 * representations) and the engine. Every problem here is answered with its
 * status code, before any processing starts.
 */
export async function prepareDocument(request: {
    project: UAGProjectInterface;
    form: UAGFormInterface;
    path: string;
    files: any;
    data?: any;
    auth: AuthRequest;
}): Promise<PreparedDocument> {
    const { project, form, auth } = request;
    const registry = project.plugins;
    if (!registry) throw new FormflowError(503, 'Documents cannot be processed until the server has started.', 'not_ready');
    const settings: DocumentsSettings = documentsSettings(project.config?.documents);
    const formJson: any = form.form || {};

    // 1. Locate the component in the stored form.
    const path = String(request.path || '');
    const component = path ? componentAt(formJson.components || [], path) : undefined;
    if (!component || component.type !== 'uagdocument') {
        throw new FormflowError(404, `The form "${formJson.title || formJson.name}" has no AI Document at "${path}".`, 'component_not_found');
    }
    const label = component.label || component.key;
    const uag = component.uag || {};
    const plugin = uag.plugin ? registry.get<DocumentPlugin>('document', uag.plugin) : undefined;
    if (!plugin) throw misconfigured(label, uag.plugin ? `its process "${uag.plugin}" is not installed or not available.` : 'it has no process.');
    const pluginSettings = { ...(plugin.defaults || {}), ...(uag.settings || {}) };
    const problems = plugin.validateSettings?.(pluginSettings) || [];
    if (problems.length) throw misconfigured(label, problems.join('; '));
    const filesComponent = (component.components || []).find((child: any) => child.key === 'files' && child.type === 'file');
    if (!filesComponent) throw misconfigured(label, 'it has no files component.');

    // 2. Authorize: as the Agent API does, and Agentic Formflow must be allowed.
    const service = formflow(project);
    service.requireAccess(auth, form as any, ['create', 'update']);
    await service.requireLicense();

    // 3. Instructions.
    const instructions = instructionsOf(formJson, uag, label);

    // 4–7. Load, identify, check and route each file.
    const files: any[] = Array.isArray(request.files) ? request.files.filter(Boolean) : [];
    if (!files.length) throw new FormflowError(400, `Send the files of "${label}" to process.`, 'no_files');
    if (files.length > settings.maxFiles) {
        throw new FormflowError(413, `"${label}" has ${files.length} files; at most ${settings.maxFiles} (documents.maxFiles) are processed at once.`, 'payload_too_large');
    }
    const routes = documentsOf(registry).routes;
    const converters = registry.list<Converter>('converter');
    const accept: string[] = Array.isArray(uag.accept) ? uag.accept : [];
    const loaded: Array<{ name: string; type: string; buffer: Buffer; sha256: string; route: FileRoute }> = [];
    let total = 0;
    for (const file of files) {
        const name = String(file.originalName || file.name || 'file');
        let buffer: Buffer | null;
        try {
            buffer = await form.readFile(file, auth, { maxBytes: settings.maxFileBytes, component: filesComponent });
        }
        catch (err: any) {
            throw new FormflowError(413, `"${name}" could not be read: ${err?.message || 'it was refused'}`, 'file_unreadable');
        }
        if (!buffer) throw new FormflowError(422, `"${name}" is stored as ${file.storage || 'unknown'}, which cannot be read here.`, 'file_unreadable');
        total += buffer.length;
        if (total > settings.maxTotalBytes) {
            throw new FormflowError(413, `The files of "${label}" are larger than ${settings.maxTotalBytes} bytes together (documents.maxTotalBytes).`, 'payload_too_large');
        }
        let type: string;
        try {
            // The bytes decide the type; the file's declared type only breaks ties.
            type = identify(buffer, { name, type: typeof file.type === 'string' ? file.type : undefined }, converters);
        }
        catch (err) {
            if (err instanceof DetectionError) throw new FormflowError(415, err.message, 'unsupported_file');
            throw err;
        }
        if (accept.length && !accept.includes(type)) {
            throw new FormflowError(415, `"${name}" is ${type}, which "${label}" does not accept.`, 'unsupported_file');
        }
        const route = routes.route(type, plugin.inputs, uag.converters || {});
        if (!route) {
            throw new FormflowError(415, `"${name}" is ${type}, which no installed converter brings to the "${plugin.name}" process.`, 'unsupported_file');
        }
        loaded.push({ name, type, buffer, route, sha256: createHash('sha256').update(buffer).digest('hex') });
    }

    // The engine: the component's, then documents.engine, then the first agent engine that generates and reads what the routes produced.
    const needed = [...new Set(loaded.flatMap((file) => file.route.inputs))] as Representation[];
    const engines = project.formflowEngines();
    const reads = (engine: any) => (Array.isArray(engine?.accepts) ? engine.accepts : ['text']);
    const capable = (engine: any) => engine?.kind === 'agent' && typeof engine.generate === 'function' && needed.every((kind) => reads(engine).includes(kind));
    const named = uag.engine || settings.engine;
    const engine: any = named ? engines.get(named) : engines.agent.find(capable);
    if (!engine || !capable(engine)) {
        const missing = needed.find((kind) => !engine || !reads(engine).includes(kind)) || needed[0];
        throw new FormflowError(503, named && !engine ? `The engine "${named}" is not enabled.` : `no enabled engine can read ${missing} documents`, 'no_engine');
    }

    const log = {
        info: (msg: string) => console.log(`[plugin document:${plugin.name}] ${msg}`),
        warn: (msg: string) => console.warn(`[plugin document:${plugin.name}] ${msg}`),
        error: (msg: string) => console.error(`[plugin document:${plugin.name}] ${msg}`)
    };

    return {
        plugin,
        async run({ signal, progress: report }) {
            // Progress never goes back, whatever order the plugin and the engine report in.
            let reached = 0;
            const progress: ProcessProgress = (fraction, message) => {
                reached = Math.max(reached, fraction);
                report(reached, message);
            };
            const settingsOf = (converter: Converter) => registry.settings('converter', converter.name);
            // 7. Convert, in memory, for this request only.
            const documentFiles: DocumentFile[] = [];
            let pages = 0;
            let chars = 0;
            for (let i = 0; i < loaded.length; i++) {
                const file = loaded[i];
                progress(0.3 * i / loaded.length, `Reading ${file.name}`);
                const input = { buffer: file.buffer, type: file.type, name: file.name };
                const document: DocumentFile['document'] = {};
                const steps: string[] = [];
                try {
                    if (file.route.pdf) {
                        if (file.route.pdf.length) {
                            const out: any = await runRoute(file.route.pdf, input, 'pdf', { signal, log, settingsOf });
                            document.pdf = out.pdf;
                            if (out.pages) document.pages = out.pages;
                            steps.push(...file.route.pdf.map(stepName));
                        }
                        else {
                            document.pdf = file.buffer;
                        }
                    }
                    if (file.route.text) {
                        if (file.route.pdf) {
                            // The text of that same PDF.
                            const last = file.route.text[file.route.text.length - 1];
                            const out: any = await runConverter(last, { buffer: document.pdf!, type: MIME.pdf, name: file.name }, { to: 'text', signal, log, settings: settingsOf(last) });
                            Object.assign(document, { text: out.text, textFormat: out.textFormat, ...(out.pages && { textPages: out.pages }) });
                            steps.push(stepName(last));
                        }
                        else {
                            const out: any = await runRoute(file.route.text, input, 'text', { signal, log, settingsOf });
                            Object.assign(document, { text: out.text, textFormat: out.textFormat, ...(out.pages && { textPages: out.pages }) });
                            steps.push(...file.route.text.map(stepName));
                        }
                    }
                }
                catch (err: any) {
                    if (signal.aborted) throw signal.reason ?? err;
                    throw new FormflowError(422, err?.message || `"${file.name}" could not be converted.`, 'conversion_failed');
                }
                if (document.pdf && document.pages === undefined) {
                    document.pages = document.textPages?.length ?? await countPages(document.pdf);
                }
                pages += document.pages ?? document.textPages?.length ?? 0;
                chars += document.text?.length || 0;
                documentFiles.push({
                    name: file.name, type: file.type, size: file.buffer.length, sha256: file.sha256,
                    document, route: [...new Set(steps)],
                    original: async () => file.buffer
                });
            }

            // 8. Limits after conversion: nothing is truncated silently.
            if (pages > settings.maxPages) {
                throw new FormflowError(413, `The documents have ${pages} pages; at most ${settings.maxPages} (documents.maxPages) are processed.`, 'too_many_pages');
            }
            if (chars > settings.maxTextChars) {
                throw new FormflowError(413, `The documents have ${chars} characters of text; at most ${settings.maxTextChars} (documents.maxTextChars) are processed.`, 'too_much_text');
            }

            // 9. Run the plugin, under documents.timeoutMs.
            progress(0.3, 'Processing');
            const controller = new AbortController();
            const stop = () => controller.abort(signal.reason);
            signal.addEventListener('abort', stop, { once: true });
            let model = engine.model;
            let timer: NodeJS.Timeout | undefined;
            const context: DocumentContext = {
                files: documentFiles,
                instructions,
                settings: pluginSettings,
                config: registry.settings('document', plugin.name) || {},
                form: { id: String(formJson._id || ''), path: String(formJson.path || ''), title: String(formJson.title || '') },
                component: { key: component.key, path, label },
                data: request.data && typeof request.data === 'object' ? request.data : {},
                agent: {
                    generate: async (generate) => {
                        controller.signal.throwIfAborted();
                        const response = await engine.generate({
                            ...generate,
                            signal: controller.signal,
                            onProgress: (outputChars: number) => progress(0.5, `Writing (${outputChars} characters)`)
                        });
                        model = response.model || model;
                        return response;
                    }
                },
                progress: (fraction, message) => progress(0.3 + 0.7 * Math.max(0, Math.min(1, Number(fraction) || 0)), message),
                signal: controller.signal,
                log
            };
            let result: any;
            try {
                const timeout = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        const error = new FormflowError(504, `Processing "${label}" took longer than ${settings.timeoutMs} ms (documents.timeoutMs).`, 'timeout');
                        controller.abort(error);
                        reject(error);
                    }, settings.timeoutMs);
                });
                const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
                result = await Promise.race([plugin.process(context), timeout, aborted]);
            }
            catch (err: any) {
                if (err instanceof FormflowError) throw err;
                if (signal.aborted) throw signal.reason ?? err;
                // A plugin's message is shown to the person; plugins keep document text out of it.
                throw new FormflowError(422, err?.message || 'The document could not be processed.', 'process_failed');
            }
            finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', stop);
            }

            // 10. Normalize.
            const format = plugin.output === 'text' ? 'text' : 'markdown';
            const content = typeof result?.content === 'string' ? result.content : '';
            progress(1, 'Done');
            return {
                content: format === 'markdown' ? sanitizeMarkdown(content) : plainText(content),
                format,
                status: result?.status === 'flagged' ? 'flagged' : 'ok',
                issues: normalizeIssues(result?.issues),
                summary: typeof result?.summary === 'string' ? result.summary.slice(0, 2000) : '',
                edited: false,
                meta: {
                    plugin: stepName(plugin as any),
                    engine: engine.name,
                    model,
                    files: documentFiles.map((file) => ({ name: file.name, route: file.route, ...(file.document.pages !== undefined && { pages: file.document.pages }) }))
                }
            };
        }
    };
}
