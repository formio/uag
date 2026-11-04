import { expect } from 'chai';
import { requireTestLicense } from '../agent/fixtures';
import { Started } from '../characterization/harness';
import { ADMIN_KEY } from '../characterization/harness';
import { docx, pdf, png, upload } from '../helpers/documents';
import { resetSeen, seen, startDocuments } from './fixture';

/** The processing pipeline, through the process route answering plain JSON. */
describe('Documents: the processing pipeline', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    beforeEach(() => resetSeen());
    afterEach(async () => { await started?.stop(); started = undefined; });

    const contract = () => upload(pdf([['Section 1. The parties agree.'], ['Section 2. Payment.']]), 'contract.pdf', 'application/pdf');
    const process = (body: any, headers: Record<string, string> = { 'x-admin-key': ADMIN_KEY }) =>
        started!.request().post('/contracts/document/process').set(headers).send(body);

    it('processes a PDF: the plugin gets the PDF and that PDF\'s text, the engine the documents, and the result records the route', async () => {
        started = await startDocuments();
        const res = await process({ path: 'contract', files: [contract()], data: { name: 'Ada' } });
        expect(res.status, res.text).to.equal(200);
        const { result } = res.body;
        expect(result).to.include({ format: 'markdown', status: 'ok', summary: '', edited: false });
        expect(result.content).to.equal('# Answer\n\ncontract.pdf: PDF of ' + seen.generate[0].attachments[0].data.length + ' bytes');
        expect(result.meta).to.deep.equal({ plugin: 'echo@1.2.3', engine: 'reader', model: 'reader-1', files: [{ name: 'contract.pdf', route: [`pdf-text@${result.meta.files[0].route[0].split('@')[1]}`], pages: 2 }] });
        const ctx = seen.contexts[0];
        expect(ctx.files[0]).to.include({ name: 'contract.pdf', type: 'application/pdf' });
        expect(ctx.files[0].sha256).to.match(/^[0-9a-f]{64}$/);
        expect(ctx.files[0].document.text).to.equal('Section 1. The parties agree.\n\nSection 2. Payment.');
        expect(ctx.files[0].document.textPages).to.have.length(2);
        expect(ctx.settings).to.deep.equal({ mode: 'ok' });
        expect(ctx.component).to.deep.equal({ key: 'contract', path: 'contract', label: 'Contract' });
        expect(ctx.data).to.deep.equal({ name: 'Ada' });
    });

    it('turns written instructions into Markdown, with no interpolation', async () => {
        started = await startDocuments();
        await process({ path: 'contract', files: [contract()], data: { name: 'Ada' } });
        expect(seen.contexts[0].instructions).to.equal('Copy the parties, **exactly**. {{ data.name }}');
    });

    it('takes instructions from a content component, and a component in a Data Grid by its path with the row index', async () => {
        started = await startDocuments();
        const res = await process({ path: 'rows[2].row', files: [upload(Buffer.from('Notes'), 'notes.txt', 'text/plain')] });
        expect(res.status, res.text).to.equal(200);
        expect(seen.contexts[0].instructions).to.equal('## Copy\n\n* Sections 1 to 4');
        expect(seen.contexts[0].component.path).to.equal('rows[2].row');
        expect(res.body.result.meta.files[0].route[0]).to.match(/^text@/);
    });

    it('finds a component inside a layout component by its data path', async () => {
        started = await startDocuments();
        const res = await process({ path: 'inPanel', files: [contract()] });
        expect(res.status, res.text).to.equal(200);
        expect(seen.contexts[0].component).to.deep.equal({ key: 'inPanel', path: 'inPanel', label: 'InPanel' });
    });

    it('routes other types: text, and an image through a PDF', async () => {
        started = await startDocuments();
        const res = await process({ path: 'contract', files: [upload(Buffer.from('a,b\n1,2'), 'data.csv', 'text/csv'), upload(png(), 'scan.png', 'image/png')] });
        expect(res.status, res.text).to.equal(200);
        const [csv, image] = res.body.result.meta.files;
        expect(csv.route.map((step: string) => step.split('@')[0])).to.deep.equal(['text']);
        expect(image.route.map((step: string) => step.split('@')[0])).to.deep.equal(['image-pdf', 'pdf-text']);
        expect(seen.contexts[0].files[1].document.pdf.subarray(0, 5).toString()).to.equal('%PDF-');
    });

    it('sanitizes Markdown content, and caps issues and their length', async () => {
        started = await startDocuments();
        const unsafe = await process({ path: 'unsafe', files: [contract()] });
        expect(unsafe.body.result.content).to.not.include('<script>').and.not.include('javascript:').and.not.include('![img]');
        expect(unsafe.body.result.content).to.include('steal()').and.include('bad');
        const flagged = await process({ path: 'flagged', files: [contract()] });
        expect(flagged.body.result.status).to.equal('flagged');
        expect(flagged.body.result.summary).to.equal('Two passages differ.');
        expect(flagged.body.result.issues).to.have.length(50);
        expect(flagged.body.result.issues[0].message.length).to.equal(300);
    });

    describe('refusals before processing, as status codes', () => {
        const refusal = async (body: any, headers?: Record<string, string>) => {
            const res = await process(body, headers);
            return { status: res.status, error: res.body.error, code: res.body.code };
        };

        it('names misconfigured components', async () => {
            started = await startDocuments();
            expect(await refusal({ path: 'missingPlugin', files: [contract()] })).to.deep.include({ status: 422, code: 'document_misconfigured' });
            expect((await refusal({ path: 'missingPlugin', files: [contract()] })).error).to.include('"MissingPlugin"').and.include('"nope" is not installed');
            expect((await refusal({ path: 'noInstructions', files: [contract()] })).error).to.include('has no instructions');
            expect((await refusal({ path: 'badSettings', files: [contract()] })).error).to.include('mode "loud"');
            expect(await refusal({ path: 'name', files: [contract()] })).to.deep.include({ status: 404, code: 'component_not_found' });
        });

        it('refuses files over the limits, of types not accepted or not reachable, and storage it cannot read', async () => {
            started = await startDocuments({ documents: { maxFiles: 2, maxTotalBytes: 100000 } });
            expect((await refusal({ path: 'contract', files: [contract(), contract(), contract()] })).status).to.equal(413);
            expect((await refusal({ path: 'contract', files: [upload(Buffer.alloc(200000, 0x41), 'big.txt', 'text/plain')] })).error).to.include('documents.maxTotalBytes');
            await started!.stop();
            started = await startDocuments({ documents: { maxFileBytes: 1000 } });
            expect(await refusal({ path: 'contract', files: [upload(Buffer.alloc(5000, 0x41), 'one.txt', 'text/plain')] })).to.deep.include({ status: 413, code: 'payload_too_large' });
            await started!.stop();
            started = await startDocuments({ documents: { maxFiles: 2, maxTotalBytes: 100000 } });
            expect(await refusal({ path: 'pdfOnly', files: [upload(Buffer.from('notes'), 'n.txt', 'text/plain')] })).to.deep.include({ status: 415, code: 'unsupported_file' });
            expect((await refusal({ path: 'contract', files: [upload(docx([[{ text: 'Hi' }]]), 'a.docx', 'application/msword')] })).error).to.equal('"a.docx" is application/vnd.openxmlformats-officedocument.wordprocessingml.document, which no installed converter brings to the "echo" process.');
            expect((await refusal({ path: 'contract', files: [{ storage: 'dropbox', name: 'x.pdf', originalName: 'x.pdf', type: 'application/pdf', size: 10 }] })).error).to.equal('"x.pdf" is stored as dropbox, which cannot be read here.');
            // A value naming a file stored elsewhere than its component stores is refused before anything is fetched.
            expect(await refusal({ path: 'contract', files: [{ storage: 's3', bucket: 'other', key: 'private/x.pdf', name: 'x.pdf', originalName: 'x.pdf', type: 'application/pdf', size: 10 }] })).to.deep.include({
                status: 422, code: 'file_unreadable', error: 'The file "x.pdf" cannot be read: it says it is stored in "s3", but its component stores to "base64".'
            });
            const disguised = upload(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(40)]), 'report.pdf', 'application/pdf');
            expect((await refusal({ path: 'contract', files: [disguised] })).error).to.include('is named .pdf');
        });

        it('chooses an engine that reads what the route produced, or refuses', async () => {
            started = await startDocuments();
            const res = await refusal({ path: 'textEngine', files: [contract()] });
            expect(res).to.deep.include({ status: 503, code: 'no_engine' });
            expect(res.error).to.equal('no enabled engine can read pdf documents');
            // Text files are fine for the text-only engine.
            const text = await process({ path: 'textEngine', files: [upload(Buffer.from('Notes'), 'n.txt', 'text/plain')] });
            expect(text.status).to.equal(200);
            expect(text.body.result.meta.engine).to.equal('stub-agent');
        });

        it('refuses a caller who cannot create or update submissions of the form', async () => {
            started = await startDocuments();
            const res = await refusal({ path: 'contract', files: [contract()] }, {});
            expect([401, 403]).to.include(res.status);
        });

        it('refuses with 403 when Agentic Formflow is not licensed', async () => {
            started = await startDocuments({ license: 'unlicensed-test' });
            const res = await refusal({ path: 'contract', files: [contract()] });
            expect(res).to.deep.include({ status: 403, code: 'license_required' });
        });
    });

    it('fails after conversion when the documents exceed maxPages, naming the limit', async () => {
        started = await startDocuments({ documents: { maxPages: 1 } });
        const res = await process({ path: 'contract', files: [contract()] });
        expect(res.status).to.equal(413);
        expect(res.body.error).to.include('documents.maxPages');
    });

    it('keeps document text out of errors and logs', async () => {
        started = await startDocuments();
        const lines: string[] = [];
        const original = { log: console.log, warn: console.warn, error: console.error };
        console.log = console.warn = console.error = (...args: any[]) => { lines.push(args.join(' ')); };
        let res: any;
        try {
            res = await process({ path: 'failing', files: [upload(Buffer.from('SECRET-DOCUMENT-TEXT'), 's.txt', 'text/plain')] });
        }
        finally {
            Object.assign(console, original);
        }
        expect(res.status).to.equal(422);
        expect(res.body.error).to.equal('The process failed for a reason that is safe to show.');
        expect(lines.join('\n')).to.not.include('SECRET-DOCUMENT-TEXT');
    });
});
