import { expect } from 'chai';
import http from 'http';
import express from 'express';
import supertest from 'supertest';
import { ProjectInterface } from '@formio/appserver';
import { defineEngine } from '@formio/uag-sdk';
import { UAGServer } from '../../src';
import { taskRunner } from '../../src/runner';
import { FakeFormio } from '../helpers/fakeFormio';
import { requireTestLicense, TEST_LICENSE } from './fixtures';

http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * Documents as a task's input, through the stateless Agent API: the UAG reads
 * the uploaded file with a module's file reader, the engine gets its content
 * (never the base64 it was stored as), and HTML the engine writes into a rich
 * text field is sanitized before it is returned.
 */
describe('Documents in the Agent API', function () {
    this.timeout(20000);
    before(function () { requireTestLicense(this); });

    const roles = { anonymous: { title: 'Anonymous', admin: false, default: true } };
    const documentForm = {
        title: 'Document', type: 'form', name: 'documentExtract', path: 'documentextract', tags: ['uag'],
        components: [
            { type: 'file', key: 'document', label: 'Source Document', input: true, storage: 'base64', properties: { uag: 'transcriber', uagField: 'input' } },
            { type: 'content', key: 'criteria', input: false, html: '<p>Transcribe the document.</p>', properties: { uag: 'transcriber', uagField: 'criteria' } },
            { type: 'textarea', key: 'extractedContent', label: 'Extracted Content', input: true, editor: 'ckeditor', properties: { uag: 'transcriber', uagAuthoritative: 'true' } }
        ],
        access: [{ type: 'read_all', roles: ['anonymous'] }],
        submissionAccess: []
    };

    const pdfBytes = Buffer.from('%PDF-1.7 Section 1. The parties agree.');
    const upload = [{ storage: 'base64', name: 'contract.pdf', originalName: 'contract.pdf', type: 'application/pdf', size: pdfBytes.length, url: `data:application/pdf;base64,${pdfBytes.toString('base64')}` }];

    /** A PDF reader as a module would provide one: it knows a PDF by its first bytes. */
    const pdfReader = {
        name: 'pdf',
        accepts: (_meta: any, head: Buffer) => head.subarray(0, 4).toString('latin1') === '%PDF',
        read: async (buffer: Buffer) => ({ text: '', html: `<p>${buffer.subarray(9).toString()}</p>` })
    };

    let requests: any[];
    let answer: Record<string, any>;
    const recorder = defineEngine({
        type: 'engine',
        name: 'recorder',
        kinds: ['agent'],
        apiVersion: 1,
        settings: { model: { default: 'recorder-1' } },
        create: ({ name, settings }: any) => ({
            name, kind: 'agent', model: settings.model,
            extract: async (request: any) => {
                requests.push(request);
                return { model: settings.model, values: answer };
            }
        })
    });

    let formio: FakeFormio;
    let server: UAGServer;
    let app: express.Express;
    let current: express.Express | null = null;
    const shared = http.createServer((req, res) => current!(req, res));
    before((done) => { shared.listen(0, '127.0.0.1', done); });
    after((done) => { shared.close(() => done()); });
    const request = () => { current = app; return supertest(shared); };

    async function start(config: any = {}) {
        requests = [];
        answer = { extractedContent: '<h2 onclick="steal()">Agreement</h2><p>The parties agree.</p><script>steal()</script><a href="javascript:steal()">link</a>' };
        formio = new FakeFormio({ roles, forms: { documentExtract: documentForm } });
        await formio.start();
        server = new UAGServer({
            project: formio.endpoint.replace('127.0.0.1', 'localhost'), ttl: 0, retries: 1, license: TEST_LICENSE,
            auth: { adminKey: 'admin-key' },
            engines: [{ name: 'recorder', type: recorder }],
            fileReaders: [pdfReader],
            ...config
        } as any);
        await server.initialize();
        app = express();
        app.use(await server.router());
    }

    async function stop() {
        if (server?.uagProject) await taskRunner(server.uagProject).idle();
        (server?.uagProject as any)?.destroy?.();
        ProjectInterface.module = undefined;
        await formio?.stop();
    }

    afterEach(() => stop());

    it('extracts from an uploaded document: the engine reads its content, never its base64', async () => {
        await start();
        const res = await request().post('/documentextract/agent/extract').set('x-admin-key', 'admin-key').send({ data: { document: upload } });
        expect(res.status, res.text).to.equal(200);
        expect(requests).to.have.length(1);
        const state = requests[0].state;
        expect(state.input['Source Document']).to.deep.equal({ name: 'contract.pdf', type: 'application/pdf', content: '<p>Section 1. The parties agree.</p>', format: 'html' });
        expect(JSON.stringify(requests[0])).to.not.contain(pdfBytes.toString('base64'));
    });

    it('tells the engine the rich text field takes HTML, and sanitizes the HTML it writes', async () => {
        await start();
        const res = await request().post('/documentextract/agent/extract').set('x-admin-key', 'admin-key').send({ data: { document: upload } });
        expect(res.status, res.text).to.equal(200);
        const field = requests[0].fields.find((spec: any) => spec.path === 'extractedContent');
        expect(field.rule).to.contain('The value is HTML for a rich text editor');
        expect(res.body.data.extractedContent).to.equal('<h2>Agreement</h2><p>The parties agree.</p><a>link</a>');
    });

    it('describes a document the task does not read, and takes the body limit from configuration', async () => {
        await start({ agentApi: { bodyLimit: 512 } });
        const big = await request().post('/documentextract/agent/extract').set('x-admin-key', 'admin-key').send({ data: { document: upload }, text: 'x'.repeat(600) });
        expect(big.status, big.text.slice(0, 200)).to.equal(413);
        const res = await request().post('/documentextract/agent/extract').set('x-admin-key', 'admin-key').send({ text: 'The parties agree.' });
        expect(res.status, res.text).to.equal(200);
        expect(requests[0].state.input).to.deep.equal({ Input: 'The parties agree.' });
    });
});
