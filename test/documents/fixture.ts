import { defineEngine } from '@formio/uag-sdk';
import { start, Started } from '../characterization/harness';

/** What the test plugin and engine saw, per test. */
export const seen: { generate: any[]; contexts: any[]; aborted: boolean[]; converterAborted: boolean } = { generate: [], contexts: [], aborted: [], converterAborted: false };
export function resetSeen() {
    seen.generate.length = 0;
    seen.contexts.length = 0;
    seen.aborted.length = 0;
    seen.converterAborted = false;
}

/** An agent engine that reads text and PDFs and answers with what reached it. */
export const reader = defineEngine({
    type: 'engine',
    name: 'reader',
    kinds: ['agent'],
    apiVersion: 1,
    create: ({ name }) => ({
        name, kind: 'agent', model: 'reader-1', accepts: ['text', 'pdf'],
        extract: async () => ({ model: 'reader-1', values: {} }),
        async generate(request: any) {
            request.signal?.throwIfAborted();
            seen.generate.push(request);
            request.onProgress?.(10);
            const parts = (request.attachments || []).map((a: any) => a.kind === 'pdf' ? `${a.label}: PDF of ${a.data.length} bytes` : `${a.label}: ${a.text}`);
            return { text: `# Answer\n\n${parts.join('\n\n')}`, model: 'reader-1', stopReason: 'end' };
        }
    })
});

/** A document plugin whose behavior its settings choose. */
export const echo: any = {
    type: 'document',
    name: 'echo',
    title: 'Echo',
    version: '1.2.3',
    apiVersion: 1,
    inputs: [['pdf', 'text'], ['text']],
    editable: true,
    defaults: { mode: 'ok' },
    validateSettings: (settings: any) => ['ok', 'flag', 'slow', 'fail', 'leak', 'html'].includes(settings.mode) ? [] : [`mode "${settings.mode}" is not one of ok, flag, slow, fail, leak, html`],
    async process(ctx: any) {
        seen.contexts.push(ctx);
        ctx.progress(0.5, 'Half way');
        if (ctx.settings.mode === 'slow') {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, 2000);
                ctx.signal.addEventListener('abort', () => { seen.aborted.push(true); clearTimeout(timer); reject(ctx.signal.reason); }, { once: true });
            });
        }
        if (ctx.settings.mode === 'fail') throw new Error('The process failed for a reason that is safe to show.');
        if (ctx.settings.mode === 'leak') throw new Error(`Could not read: ${ctx.files[0].document.text}`);
        const attachments = ctx.files.map((file: any) => file.document.pdf ? { kind: 'pdf', data: file.document.pdf, label: file.name } : { kind: 'text', text: file.document.text, label: file.name });
        const answer = await ctx.agent.generate({ instructions: ctx.instructions, format: 'markdown', attachments });
        const extra = ctx.settings.mode === 'html' ? '\n\n<script>steal()</script>[bad](javascript:steal()) ![img](https://x/y.png)' : '';
        return {
            content: answer.text + extra,
            status: ctx.settings.mode === 'flag' ? 'flagged' : 'ok',
            issues: ctx.settings.mode === 'flag' ? Array.from({ length: 60 }, (_, i) => ({ kind: 'changed', message: `Issue ${i} ` + 'x'.repeat(400), page: 1 })) : [],
            summary: ctx.settings.mode === 'flag' ? 'Two passages differ.' : ''
        };
    }
};

/** A converter for a made-up slow format, which notices when it is aborted. */
export const slowConverter: any = {
    type: 'converter', name: 'slow-text', title: 'Slow', version: '1.0.0', apiVersion: 1,
    accepts: [{ type: 'application/x-slow', ext: ['.slow'] }], produces: ['text'],
    detect: (head: Buffer) => head.subarray(0, 5).toString() === 'SLOW\n' ? 'application/x-slow' : null,
    convert: (input: any, options: any) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ text: 'slow text', textFormat: 'plain' }), 2000);
        options.signal.addEventListener('abort', () => { seen.converterAborted = true; clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    })
};

const files = () => [{ type: 'file', key: 'files', input: true, storage: 'base64' }, { type: 'hidden', key: 'result', input: true }];
const doc = (key: string, uag: any = {}) => ({
    type: 'uagdocument', key, label: key[0].toUpperCase() + key.slice(1), input: true, tree: true,
    uag: { plugin: 'echo', settings: {}, instructions: '<p>Copy the parties, <b>exactly</b>. {{ data.name }}</p>', instructionsComponent: '', accept: [], converters: {}, engine: '', auto: true, target: '', ...uag },
    components: files()
});

export const contractsForm = {
    title: 'Contracts', type: 'form', name: 'contracts', path: 'contracts', tags: ['uag'],
    components: [
        { type: 'content', key: 'howTo', input: false, html: '<h2>Copy</h2><ul><li>Sections 1 to 4</li></ul>' },
        doc('contract'),
        doc('flagged', { settings: { mode: 'flag' } }),
        doc('slow', { settings: { mode: 'slow' } }),
        doc('failing', { settings: { mode: 'fail' } }),
        doc('leaking', { settings: { mode: 'leak' } }),
        doc('unsafe', { settings: { mode: 'html' } }),
        doc('badSettings', { settings: { mode: 'loud' } }),
        doc('fromContent', { instructions: '', instructionsComponent: 'howTo' }),
        doc('noInstructions', { instructions: '' }),
        doc('missingPlugin', { plugin: 'nope' }),
        doc('pdfOnly', { accept: ['application/pdf'] }),
        doc('textEngine', { engine: 'stub-agent' }),
        { type: 'textfield', key: 'name', label: 'Name', input: true },
        { type: 'datagrid', key: 'rows', label: 'Rows', input: true, tree: true, components: [doc('row', { instructions: '', instructionsComponent: 'howTo' })] }
    ],
    access: [{ type: 'read_all', roles: ['anonymous', 'authenticated'] }],
    submissionAccess: [{ type: 'create_own', roles: ['authenticated'] }]
};

export function startDocuments(config: any = {}): Promise<Started> {
    return start({
        forms: { contracts: contractsForm },
        modules: [{ plugins: [echo, slowConverter] }],
        config: { engines: ['reader', 'stub-agent'], engineTypes: { reader }, ...config }
    });
}

/** Parse a text/event-stream body into its events. */
export function events(text: string): Array<{ event: string; data: any }> {
    return text.split('\n\n').filter((block) => block.includes('event:')).map((block) => {
        const event = /^event: (.*)$/m.exec(block)![1];
        const data = JSON.parse(/^data: (.*)$/m.exec(block)![1]);
        return { event, data };
    });
}
