import { expect } from 'chai';
import http from 'http';
import { requireTestLicense } from '../agent/fixtures';
import { ADMIN_KEY, Started } from '../characterization/harness';
import { pdf, upload } from '../helpers/documents';
import { events, resetSeen, seen, startDocuments } from './fixture';

/** The process route: streamed or plain, cancelled by closing the connection. */
describe('Documents: the process route', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    let started: Started | undefined;
    beforeEach(() => resetSeen());
    afterEach(async () => { await started?.stop(); started = undefined; });

    const contract = () => upload(pdf([['Section 1. The parties agree.']]), 'contract.pdf', 'application/pdf');
    const stream = (body: any) => started!.request().post('/contracts/document/process')
        .set({ 'x-admin-key': ADMIN_KEY, Accept: 'text/event-stream' }).send(body);

    /** Post with Node's http client, so the test can close the connection mid-request. */
    function rawPost(body: any, onData: (chunk: string, req: http.ClientRequest) => void): Promise<void> {
        return new Promise((resolve) => {
            const url = new URL('/contracts/document/process', started!.url);
            const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-admin-key': ADMIN_KEY } }, (res) => {
                res.setEncoding('utf8');
                res.on('data', (chunk) => onData(chunk, req));
                res.on('end', resolve);
                res.on('close', resolve);
            });
            req.on('error', () => resolve());
            req.end(JSON.stringify(body));
        });
    }

    it('streams progress events, then one done event with the result, then ends', async () => {
        started = await startDocuments();
        const res = await stream({ path: 'contract', files: [contract()] });
        expect(res.status).to.equal(200);
        expect(res.headers['content-type']).to.include('text/event-stream');
        const sent = events(res.text);
        const names = sent.map((e) => e.event);
        expect(names[names.length - 1]).to.equal('done');
        expect(names.filter((name) => name === 'done')).to.have.length(1);
        expect(names.slice(0, -1).every((name) => name === 'progress')).to.equal(true);
        expect(sent.find((e) => e.data.message === 'Half way')).to.exist;
        const progress = sent.filter((e) => e.event === 'progress').map((e) => e.data.progress);
        expect(progress).to.deep.equal([...progress].sort((a, b) => a - b));
        expect(sent[sent.length - 1].data.result).to.include({ status: 'ok', format: 'markdown' });
    });

    it('streams one failed event, in the Agent API\'s error shape, when processing fails', async () => {
        started = await startDocuments();
        const sent = events((await stream({ path: 'failing', files: [contract()] })).text);
        const last = sent[sent.length - 1];
        expect(last.event).to.equal('failed');
        expect(last.data).to.include({ error: 'The process failed for a reason that is safe to show.', code: 'process_failed' });
        expect(last.data.requestId).to.be.a('string');
        expect(sent.filter((e) => e.event === 'done')).to.have.length(0);
    });

    it('answers plain JSON without text/event-stream', async () => {
        started = await startDocuments();
        const res = await started.request().post('/contracts/document/process').set({ 'x-admin-key': ADMIN_KEY, Accept: 'application/json' }).send({ path: 'contract', files: [contract()] });
        expect(res.status).to.equal(200);
        expect(res.headers['content-type']).to.include('application/json');
        expect(res.body.result.status).to.equal('ok');
    });

    it('answers problems found before processing with their status code, never a stream', async () => {
        started = await startDocuments();
        const res = await stream({ path: 'missingPlugin', files: [contract()] });
        expect(res.status).to.equal(422);
        expect(res.headers['content-type']).to.include('application/json');
        expect(res.body.code).to.equal('document_misconfigured');
    });

    it('writes heartbeat comments while the plugin works', async () => {
        started = await startDocuments({ documents: { heartbeatMs: 20 } });
        let text = '';
        await rawPost({ path: 'slow', files: [contract()] }, (chunk, req) => {
            text += chunk;
            if ((text.match(/: keep-alive/g) || []).length >= 2) req.destroy();
        });
        expect(text).to.include(': keep-alive\n\n');
    });

    it('aborts the plugin\'s signal when the client closes the connection', async () => {
        started = await startDocuments();
        await rawPost({ path: 'slow', files: [contract()] }, (chunk, req) => {
            if (chunk.includes('Half way')) req.destroy();
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(seen.aborted).to.deep.equal([true]);
    });

    it('aborts a running conversion when the client closes the connection', async () => {
        started = await startDocuments();
        const slowFile = upload(Buffer.from('SLOW\nsomething'), 'a.slow', 'application/octet-stream');
        await rawPost({ path: 'contract', files: [slowFile] }, (chunk, req) => {
            if (chunk.includes('Reading a.slow')) setTimeout(() => req.destroy(), 100);
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(seen.converterAborted).to.equal(true);
        expect(seen.contexts).to.have.length(0);
    });

    it('caps concurrent requests per caller', async () => {
        started = await startDocuments({ documents: { perUser: 1 } });
        let second: any;
        await rawPost({ path: 'slow', files: [contract()] }, async (chunk, req) => {
            if (!second && chunk.includes('Half way')) {
                second = await started!.request().post('/contracts/document/process').set({ 'x-admin-key': ADMIN_KEY }).send({ path: 'contract', files: [contract()] });
                req.destroy();
            }
        });
        expect(second.status).to.equal(429);
        expect(second.body.code).to.equal('too_many_requests');
        // Once the first is gone, the caller may process again.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect((await started.request().post('/contracts/document/process').set({ 'x-admin-key': ADMIN_KEY }).send({ path: 'contract', files: [contract()] })).status).to.equal(200);
    });

    it('answers 403 with the license message when Agentic Formflow is not licensed', async () => {
        started = await startDocuments({ license: 'unlicensed-test' });
        const res = await stream({ path: 'contract', files: [contract()] });
        expect(res.status).to.equal(403);
        expect(res.body.code).to.equal('license_required');
        expect(res.body.error).to.include('Agentic Formflow requires a license');
    });
});
