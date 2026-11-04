import { expect } from 'chai';
import { JSDOM } from 'jsdom';

/**
 * The AI Document component in @formio/uag-js, with the real formio.js in a
 * DOM: registration, the settings form, the stored definition, processing
 * (streamed and plain), the target field, validation and the renderer.
 */
describe('uag-js: the AI Document component', function () {
    this.timeout(20000);
    const UAG_URL = 'https://uag.test';
    const manifest = [
        {
            type: 'document', name: 'extract', title: 'Extract', version: '1.0.0', stability: 'experimental', inputs: [['pdf', 'text'], ['text']], editable: true, output: 'markdown',
            defaults: { minScore: 0.98 },
            editForm: [{ type: 'number', key: 'minScore', label: 'Minimum score', input: true }],
            accept: [
                { type: 'application/pdf', ext: ['.pdf'], routes: { inputs: ['pdf', 'text'], pdf: [], text: ['pdf-text'] }, converters: ['pdf-text'] },
                { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: ['.docx'], routes: { inputs: ['text'], text: ['office-text'] }, converters: ['office-text', 'office-pdf'] }
            ]
        },
        { type: 'document', name: 'analyze', title: 'Analyze', version: '1.0.0', stability: 'experimental', inputs: [['pdf'], ['text']], editable: false, output: 'markdown', defaults: {}, editForm: [{ type: 'number', key: 'maxWords', label: 'Most words', input: true }], accept: [] }
    ];

    let dom: JSDOM;
    let Formio: any;
    let uag: any;
    const added: string[] = [];
    const saved: Record<string, any> = {};
    let requests: any[] = [];
    let respond: (body: any) => any = () => ({ events: [['done', { result: { content: '# Done', format: 'markdown', status: 'ok', issues: [], summary: '', edited: false, meta: {} } }]] });

    /** A Response-like answer: a stream of events, or JSON. */
    function answer(spec: any) {
        if (spec.status && spec.status >= 400) {
            return { ok: false, status: spec.status, headers: { get: () => 'application/json' }, json: async () => spec.body };
        }
        if (spec.json) {
            return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => spec.json };
        }
        const text = spec.events.map(([name, data]: any) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
        return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, text: async () => text };
    }

    const fakeFetch = async (url: string, init: any = {}) => {
        const body = init.body ? JSON.parse(init.body) : undefined;
        const request = { url, init, body, aborted: false };
        requests.push(request);
        init.signal?.addEventListener('abort', () => { request.aborted = true; });
        const spec = respond(body);
        if (spec.wait) {
            await new Promise((resolve, reject) => {
                const timer = setTimeout(resolve, spec.wait);
                init.signal?.addEventListener('abort', () => { clearTimeout(timer); const err: any = new Error('aborted'); err.name = 'AbortError'; reject(err); });
            });
        }
        return answer(spec);
    };

    before(() => {
        dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/', pretendToBeVisual: true });
        const win: any = dom.window;
        win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } }));
        win.scrollTo = () => { };
        const isDom = (key: string) => /^(HTML|SVG)|Event$|^(Element|Node|Text|Document|DocumentFragment|EventTarget|MutationObserver|getComputedStyle)$/.test(key);
        for (const key of [...Object.getOwnPropertyNames(win), 'window', 'document']) {
            const exists = key in globalThis;
            if (exists && !isDom(key) && key !== 'window' && key !== 'document') continue;
            try {
                if (exists) saved[key] = (globalThis as any)[key];
                (globalThis as any)[key] = key === 'window' ? win : win[key];
                added.push(key);
            }
            catch {
                // Read-only in Node.
            }
        }
        const purify = require.resolve('dompurify');
        const earlier = require.cache[purify];
        delete require.cache[purify];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        Formio = require('@formio/js').Formio;
        if (earlier) require.cache[purify] = earlier;
        // A fresh copy of uag-js: its manifest is per module.
        const uagPath = require.resolve('../packages/uag-js');
        delete require.cache[uagPath];
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        uag = require('../packages/uag-js');
    });

    after(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        for (const key of added) {
            if (key in saved) (globalThis as any)[key] = saved[key];
            else delete (globalThis as any)[key];
        }
        dom.window.close();
    });

    beforeEach(() => { requests = []; });

    function registerWith(options: any = {}) {
        Formio.use(uag.UAG(UAG_URL, { manifest, fetch: fakeFetch, agentInput: false, ...options }));
    }

    const docComponent = (key = 'contract', uag: any = {}, extra: any = {}) => ({
        type: 'uagdocument', key, label: 'Contract', input: true, tree: true,
        uag: { plugin: 'extract', settings: { minScore: 0.9 }, instructions: '<p>Copy.</p>', instructionsComponent: '', accept: [], converters: {}, engine: '', auto: true, target: '', ...uag },
        components: [{ type: 'file', key: 'files', input: true, storage: 'base64' }, { type: 'hidden', key: 'result', input: true }],
        ...extra
    });

    async function render(components: any[], options: any = {}) {
        const element = document.createElement('div');
        document.body.appendChild(element);
        const form = await Formio.createForm(element, { _id: 'f1', project: 'p1', name: 'contracts', path: 'contracts', components }, options);
        return form;
    }

    /** Every component of a settings tab, panels' children included. */
    function walk(components: any[], fn: (component: any) => void) {
        (components || []).forEach((component) => { fn(component); walk(component.components, fn); });
    }

    const file = (name = 'contract.pdf') => ({ storage: 's3', key: `uploads/${name}`, name, originalName: name, size: 100, type: 'application/pdf' });

    /** Simulate formio.js finishing an upload: the files child gets its value and changes. */
    async function upload(form: any, path: string, files: any[]) {
        const document = form.getComponent(path);
        const child = document.getComponent('files');
        child.dataValue = files;
        child.triggerChange({ modified: true });
        await new Promise((resolve) => setTimeout(resolve, 250));
        return document;
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

    describe('registration and the builder', () => {
        it('registers AI Document next to File, with its fixed children', () => {
            registerWith();
            const Document = Formio.Components.components.uagdocument;
            expect(Document).to.equal(uag.UAGDocument);
            expect(Document.builderInfo).to.include({ title: 'AI Document', group: 'premium', icon: 'file-text', weight: 101 });
            const schema = Document.schema();
            expect(schema).to.include({ type: 'uagdocument', input: true, tree: true });
            expect(schema.components.map((c: any) => `${c.type}:${c.key}`)).to.deep.equal(['file:files', 'hidden:result']);
            expect(uag.UAG.ready).to.be.instanceOf(Promise);
        });

        it('renders a static preview in the builder, with no nested drop zones', async () => {
            registerWith();
            const Document = Formio.Components.components.uagdocument;
            const instance = new Document(docComponent(), { attachMode: 'builder' });
            const html = instance.render();
            expect(html).to.include('uag-document-preview').and.include('Extract');
            expect(html).to.not.include('data-noattach').and.not.include('drag-container');
        });

        it('builds the AI tab from the manifest: Process, each plugin\'s settings prefixed, accepted files, instructions, target, advanced', () => {
            registerWith();
            const editForm = Formio.Components.components.uagdocument.editForm();
            const ai = editForm.components[0].components.find((tab: any) => tab.key === 'ai');
            const keys: string[] = [];
            walk(ai.components, (c: any) => keys.push(c.key));
            expect(keys).to.include.members(['uag.plugin', 'uag.pluginSettings.extract.minScore', 'uag.pluginAccept.extract', 'uag.pluginSettings.analyze.maxWords', 'uag.instructionsSource', 'uag.instructions', 'uag.instructionsComponent', 'uag.target', 'uag.auto', 'uag.engine', 'uag.converters']);
            const process = ai.components.find((c: any) => c.key === 'uag.plugin');
            expect(process.data.values).to.deep.equal([{ label: 'Extract', value: 'extract' }, { label: 'Analyze', value: 'analyze' }]);
            const file = editForm.components[0].components.find((tab: any) => tab.key === 'file');
            expect(file.components.map((c: any) => c.key)).to.deep.equal(['filesSettings.storage', 'filesSettings.url', 'filesSettings.options', 'filesSettings.dir', 'filesSettings.fileNameTemplate', 'filesSettings.multiple', 'filesSettings.fileMinSize', 'filesSettings.fileMaxSize', 'filesSettings.webcam']);
        });

        it('defaults accepted files to every type the plugin can take, and loads stored settings into the plugin panel', () => {
            registerWith();
            const ai = Formio.Components.components.uagdocument.editForm().components[0].components.find((tab: any) => tab.key === 'ai');
            const fields: Record<string, any> = {};
            walk(ai.components, (c: any) => { fields[c.key] = c; });
            const data = { uag: { plugin: 'extract', settings: { minScore: 0.9 }, accept: [] } };
            expect(fields['uag.pluginAccept.extract'].customDefaultValue({ data })).to.deep.equal(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
            expect(fields['uag.pluginSettings.extract.minScore'].customDefaultValue({ data })).to.equal(0.9);
            expect(fields['uag.instructionsSource'].customDefaultValue({ data: { uag: { instructionsComponent: 'howTo' } } })).to.equal('component');
        });

        it('lists the form\'s text fields as targets, those of the same grid inside a Data Grid', () => {
            registerWith();
            const ai = Formio.Components.components.uagdocument.editForm().components[0].components.find((tab: any) => tab.key === 'ai');
            const target = ai.components.find((c: any) => c.key === 'uag.target');
            const edited = { components: [
                { type: 'textarea', key: 'agreement', label: 'Agreement' },
                { type: 'textfield', key: 'name', label: 'Name' },
                docComponent('top'),
                { type: 'datagrid', key: 'rows', components: [docComponent('inRow'), { type: 'textarea', key: 'rowText', label: 'Row text' }] }
            ] };
            const choices = (key: string) => target.data.custom({ instance: { options: { editForm: edited } }, data: { key } }).map((c: any) => c.value);
            expect(choices('top')).to.deep.equal(['', 'agreement', 'name']);
            expect(choices('inRow')).to.deep.equal(['', 'rowText']);
        });

        it('opens the settings with the files component\'s storage and limits on the File tab, and saves them back unchanged', () => {
            registerWith();
            const Document = Formio.Components.components.uagdocument;
            const stored: any = docComponent('contract', {}, {});
            Object.assign(stored.components[0], { storage: 'azure', fileMaxSize: '3MB', dir: 'contracts' });
            // The builder edits a copy, made with `inFormBuilder`, and gives the settings form its definition.
            const copy = new Document(JSON.parse(JSON.stringify(stored)), { inFormBuilder: true });
            expect(copy.component.filesSettings).to.include({ storage: 'azure', fileMaxSize: '3MB', dir: 'contracts' });
            // Rendered on a form, the definition carries no copy of them.
            expect(new Document(JSON.parse(JSON.stringify(stored)), {}).component).to.not.have.property('filesSettings');
            const saved: any = JSON.parse(JSON.stringify(copy.component));
            uag.normalizeDefinition(saved);
            expect(saved).to.not.have.property('filesSettings');
            expect(saved.components[0]).to.include({ storage: 'azure', fileMaxSize: '3MB', dir: 'contracts' });
        });

        it('stores the chosen plugin\'s settings, accepted types and file settings in the stored shape', () => {
            registerWith();
            const definition: any = docComponent('contract', {
                plugin: 'extract', settings: {}, instructionsSource: 'write', instructionsComponent: 'stale',
                pluginSettings: { extract: { minScore: 0.95 }, analyze: { maxWords: 100 } },
                pluginAccept: { extract: ['application/pdf'] }
            }, { filesSettings: { storage: 'azure', multiple: true, dir: 'contracts' } });
            uag.normalizeDefinition(definition);
            expect(definition.uag.settings).to.deep.equal({ minScore: 0.95 });
            expect(definition.uag).to.not.have.property('pluginSettings');
            expect(definition.uag).to.not.have.property('pluginAccept');
            expect(definition.uag).to.not.have.property('instructionsSource');
            expect(definition.uag.accept).to.deep.equal(['application/pdf']);
            expect(definition.uag.instructionsComponent).to.equal('');
            expect(definition).to.not.have.property('filesSettings');
            expect(definition.components[0]).to.include({ storage: 'azure', multiple: true, dir: 'contracts', filePattern: '.pdf' });
        });
    });

    describe('processing', () => {
        beforeEach(() => {
            respond = () => ({ events: [['progress', { progress: 0.3, message: 'Reading' }], ['progress', { progress: 0.6 }], ['done', { result: { content: '# Agreement\n\nThe parties **agree**.', format: 'markdown', status: 'ok', issues: [], summary: '', edited: false, meta: { plugin: 'extract@1.0.0' } } }]] });
        });

        it('posts the path, files and data after the upload, streams progress and shows the result', async () => {
            registerWith();
            const form = await render([docComponent(), { type: 'textfield', key: 'name', input: true }]);
            const events: string[] = [];
            ['uagDocumentStart', 'uagDocumentProgress', 'uagDocumentResult'].forEach((name) => form.on(name, () => events.push(name)));
            form.getComponent('name').setValue('Ada');
            const document = await upload(form, 'contract', [file()]);
            await settle();
            expect(requests).to.have.length(1);
            expect(requests[0].url).to.equal('https://uag.test/project/p1/form/f1/document/process');
            expect(requests[0].init.headers.Accept).to.equal('text/event-stream');
            expect(requests[0].body).to.deep.include({ path: 'contract', files: [file()] });
            expect(requests[0].body.data.name).to.equal('Ada');
            expect(document.dataValue.result.content).to.equal('# Agreement\n\nThe parties **agree**.');
            const panel = document.refs.uagDocument.innerHTML;
            expect(panel).to.include('<h1>Agreement</h1>').and.include('<strong>agree</strong>');
            expect(events).to.deep.equal(['uagDocumentStart', 'uagDocumentProgress', 'uagDocumentProgress', 'uagDocumentResult']);
        });

        it('takes a plain JSON answer where the response is not streamed', async () => {
            respond = () => ({ json: { result: { content: 'Plain answer', format: 'markdown', status: 'ok', issues: [], summary: '', edited: false, meta: {} } } });
            registerWith();
            const form = await render([docComponent()]);
            const document = await upload(form, 'contract', [file()]);
            await settle();
            expect(document.dataValue.result.content).to.equal('Plain answer');
        });

        it('aborts the running request when the files change, and clears the result when they are removed', async () => {
            respond = (body) => body.files[0].name === 'slow.pdf' ? { wait: 2000, events: [] } : { events: [['done', { result: { content: 'Fast', format: 'markdown', status: 'ok', issues: [], summary: '', edited: false, meta: {} } }]] };
            registerWith();
            const form = await render([docComponent()]);
            const document = await upload(form, 'contract', [file('slow.pdf')]);
            expect(document.uagDocumentValidity()).to.equal('Processing Contract…');
            await upload(form, 'contract', [file('fast.pdf')]);
            await settle();
            expect(requests[0].aborted).to.equal(true);
            expect(document.dataValue.result.content).to.equal('Fast');
            await upload(form, 'contract', []);
            expect(document.dataValue.result).to.deep.equal({});
        });

        it('shows the error and Try again when processing fails', async () => {
            respond = () => ({ status: 422, body: { error: 'The AI Document "Contract" is misconfigured: it has no instructions.', code: 'document_misconfigured' } });
            registerWith();
            const form = await render([docComponent()]);
            const document = await upload(form, 'contract', [file()]);
            await settle();
            expect(document.refs.uagDocument.innerHTML).to.include('it has no instructions').and.include('Try again');
            respond = () => ({ events: [['done', { result: { content: 'Second try', format: 'markdown', status: 'ok', issues: [], summary: '', edited: false, meta: {} } }]] });
            document.refs.uagDocument.querySelector('[ref="uagRetry"]').click();
            await settle();
            expect(document.dataValue.result.content).to.equal('Second try');
        });

        it('shows a flagged result\'s summary and issues', async () => {
            respond = () => ({ events: [['done', { result: { content: 'Text', format: 'markdown', status: 'flagged', issues: [{ kind: 'changed', message: 'A word changed', page: 2 }], summary: 'One passage differs.', edited: false, meta: {} } }]] });
            registerWith();
            const form = await render([docComponent()]);
            const document = await upload(form, 'contract', [file()]);
            await settle();
            const html = document.refs.uagDocument.innerHTML;
            expect(html).to.include('Review this result').and.include('One passage differs.').and.include('A word changed').and.include('<details>');
        });

        it('lets people edit the content of an editable process, marking it edited', async () => {
            registerWith();
            const form = await render([docComponent()]);
            const document = await upload(form, 'contract', [file()]);
            await settle();
            document.refs.uagDocument.querySelector('[ref="uagEdit"]').click();
            const editor = document.refs.uagDocument.querySelector('[ref="uagEditor"]');
            editor.value = '# Edited';
            editor.dispatchEvent(new window.Event('input'));
            expect(document.dataValue.result).to.include({ content: '# Edited', edited: true });
        });

        it('has no Edit toggle for a process that is not editable', async () => {
            registerWith();
            const form = await render([docComponent('contract', { plugin: 'analyze' })]);
            const document = await upload(form, 'contract', [file()]);
            await settle();
            expect(document.refs.uagDocument.querySelector('[ref="uagEdit"]')).to.equal(null);
        });

        it('sends the row path of a component in a Data Grid, and keeps each row\'s result', async () => {
            registerWith();
            const form = await render([{ type: 'datagrid', key: 'rows', input: true, tree: true, components: [docComponent('doc')] }]);
            form.getComponent('rows').addRow();
            await settle();
            const second = form.getComponent('rows').rows[1].doc;
            const child = second.getComponent('files');
            child.dataValue = [file()];
            child.triggerChange({ modified: true });
            await settle();
            await settle();
            expect(requests[0].body.path).to.equal('rows[1].doc');
            expect(second.dataValue.result.content).to.include('Agreement');
            expect(form.getComponent('rows').rows[0].doc.dataValue.result || {}).to.not.have.property('content');
        });

        it('makes required files without a result invalid', async () => {
            registerWith();
            const form = await render([docComponent('contract', {}, { validate: { required: true } })]);
            expect(form.getComponent('contract').uagDocumentValidity()).to.equal('Contract needs files with a result.');
        });

        it('waits for the Process button when processing on upload is off', async () => {
            registerWith();
            const form = await render([docComponent('contract', { auto: false })]);
            const document = await upload(form, 'contract', [file()]);
            expect(requests).to.have.length(0);
            document.refs.uagDocument.querySelector('[ref="uagRun"]').click();
            await settle();
            expect(requests).to.have.length(1);
        });

        it('never processes in read-only mode', async () => {
            registerWith();
            const form = await render([docComponent()], { readOnly: true });
            await upload(form, 'contract', [file()]);
            expect(requests).to.have.length(0);
        });
    });

    describe('the target field', () => {
        beforeEach(() => {
            respond = () => ({ events: [['done', { result: { content: '# Agreement\n\nThe parties <b>agree</b>.', format: 'markdown', status: 'ok', issues: [], summary: '', edited: false, meta: {} } }]] });
        });

        it('writes HTML from the renderer into a rich-text textarea, keeps the result, and shows no Edit toggle', async () => {
            registerWith();
            const form = await render([docComponent('contract', { target: 'agreement' }), { type: 'textarea', key: 'agreement', input: true, editor: 'quill', wysiwyg: true, hidden: true }]);
            // The rich-text editor does not run in this DOM (hidden: never attached): record what the component writes.
            const target = form.getComponent('agreement');
            const written: any[] = [];
            const setValue = target.setValue.bind(target);
            target.setValue = (value: any, flags: any) => { written.push({ value, flags }); return setValue(value, flags); };
            const document = await upload(form, 'contract', [file()]);
            await settle();
            expect(written[0].flags).to.include({ modified: true });
            expect(written[0].value).to.equal('<h1>Agreement</h1><p>The parties &lt;b&gt;agree&lt;/b&gt;.</p>');
            expect(document.dataValue.result.content).to.equal('# Agreement\n\nThe parties <b>agree</b>.');
            expect(document.refs.uagDocument.querySelector('[ref="uagEdit"]')).to.equal(null);
            expect(document.refs.uagDocument.innerHTML).to.not.include('<h1>');
        });

        it('writes the Markdown into a plain textarea or text field', async () => {
            registerWith();
            const form = await render([docComponent('contract', { target: 'notes' }), { type: 'textarea', key: 'notes', input: true }]);
            await upload(form, 'contract', [file()]);
            await settle();
            expect(form.getComponent('notes').dataValue).to.equal('# Agreement\n\nThe parties <b>agree</b>.');
        });

        it('asks before replacing a value the field already has, keeping it leaves the field alone, and says which happened', async () => {
            registerWith();
            const form = await render([docComponent('contract', { target: 'notes' }), { type: 'textarea', key: 'notes', input: true }]);
            form.getComponent('notes').setValue('My own notes');
            const document = await upload(form, 'contract', [file()]);
            await settle();
            expect(form.getComponent('notes').dataValue).to.equal('My own notes');
            expect(document.refs.uagDocument.innerHTML).to.include('Replace').and.include('Keep current');
            expect(document.refs.uagDocument.textContent).to.not.include('Written into');
            document.refs.uagDocument.querySelector('[ref="uagKeep"]').click();
            expect(form.getComponent('notes').dataValue).to.equal('My own notes');
            expect(document.dataValue.result.content).to.include('Agreement');
            expect(document.refs.uagDocument.textContent).to.include('Not written').and.not.include('Written into');
            await upload(form, 'contract', [file('other.pdf')]);
            await settle();
            expect(document.refs.uagDocument.textContent).to.not.include('Not written').and.not.include('Written into');
            document.refs.uagDocument.querySelector('[ref="uagReplace"]').click();
            expect(form.getComponent('notes').dataValue).to.include('# Agreement');
            expect(document.refs.uagDocument.textContent).to.include('Written into');
        });

        it('writes into the field of the same row inside a Data Grid', async () => {
            registerWith();
            const form = await render([{ type: 'datagrid', key: 'rows', input: true, tree: true, components: [docComponent('doc', { target: 'rowText' }), { type: 'textarea', key: 'rowText', input: true }] }]);
            form.getComponent('rows').addRow();
            await settle();
            const row = form.getComponent('rows').rows[1];
            const child = row.doc.getComponent('files');
            child.dataValue = [file()];
            child.triggerChange({ modified: true });
            await settle();
            await settle();
            expect(row.rowText.dataValue).to.include('# Agreement');
            expect(form.getComponent('rows').rows[0].rowText.dataValue || '').to.equal('');
        });
    });

    describe('portal mode and the renderer', () => {
        it('registers only the component in portal mode', () => {
            const mod = uag.UAG(UAG_URL, { portal: true, manifest })(Formio);
            expect(Object.keys(mod)).to.deep.equal(['components']);
            expect(mod.components.uagdocument).to.equal(uag.UAGDocument);
        });

        it('escapes HTML and drops unsafe links', () => {
            const html = uag.renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1)) [ok](mailto:a@b.c) ![img](https://x/y.png)\n\n```\n<b>code</b>\n```');
            expect(html).to.not.include('<script>').and.not.include('javascript:').and.not.include('<img');
            expect(html).to.include('&lt;script&gt;').and.include('href="mailto:a@b.c"').and.include('&lt;b&gt;code&lt;/b&gt;');
        });
    });
});
