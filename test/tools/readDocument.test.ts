import { expect } from 'chai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { requireTestLicense } from '../agent/fixtures';
import { start, Started } from '../characterization/harness';
import { pdf, upload } from '../helpers/documents';

/** read_document: the text of an uploaded file, through the converters, with the caller's identity. */
describe('read_document', function () {
    this.timeout(30000);
    before(function () { requireTestLicense(this); });

    const contracts = {
        title: 'Contracts', type: 'form', name: 'contracts', path: 'contracts', tags: ['uag'],
        components: [
            { type: 'file', key: 'attachment', label: 'Attachment', input: true, storage: 'base64', multiple: true },
            {
                type: 'uagdocument', key: 'contract', label: 'Contract', input: true, tree: true, uag: { plugin: 'extract' },
                components: [{ type: 'file', key: 'files', input: true, storage: 'base64' }, { type: 'hidden', key: 'result', input: true }]
            },
            { type: 'textfield', key: 'name', label: 'Name', input: true },
            { type: 'panel', key: 'section', title: 'Section', input: false, components: [{ type: 'file', key: 'scan', label: 'Scan', input: true, storage: 'base64' }] }
        ],
        access: [{ type: 'read_all', roles: ['anonymous'] }],
        submissionAccess: [{ type: 'read_all', roles: ['anonymous'] }]
    };

    let started: Started | undefined;
    afterEach(async () => { await started?.stop(); started = undefined; });

    async function call(args: Record<string, any>) {
        const project: any = started!.server.uagProject;
        const server = await project.buildMcpServer();
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'test', version: '1.0.0' });
        await client.connect(clientSide);
        try {
            const result: any = await client.callTool({ name: 'read_document', arguments: args });
            return { isError: !!result.isError, body: JSON.parse(result.content[0].text) };
        }
        finally {
            await client.close();
        }
    }

    it('is a built-in, read-only tool', async () => {
        started = await start({ forms: { contracts } });
        const tools = await (started.server.uagProject as any).formflowTools();
        expect(tools.find((tool: any) => tool.name === 'read_document').readOnly).to.equal(true);
    });

    it('reads a file component\'s file and an AI Document\'s file as text, with their pages', async () => {
        started = await start({ forms: { contracts } });
        const saved = started.formio.submissions['sub1'] = {
            _id: 'sub1', form: started.formio.formIds.contracts,
            data: {
                attachment: [upload(Buffer.from('First note'), 'a.txt', 'text/plain'), upload(Buffer.from('Second note'), 'b.txt', 'text/plain')],
                contract: { files: [upload(pdf([['Section 1. The parties agree.'], ['Section 2. Payment.']]), 'contract.pdf', 'application/pdf')], result: {} },
                scan: [upload(Buffer.from('In a panel'), 'scan.txt', 'text/plain')]
            }
        };
        expect(saved).to.exist;
        expect(await call({ form_name: 'contracts', submission_id: 'sub1', data_path: 'contract' })).to.deep.equal({
            isError: false,
            body: { file_name: 'contract.pdf', type: 'application/pdf', pages: 2, text: 'Section 1. The parties agree.\n\nSection 2. Payment.' }
        });
        expect((await call({ form_name: 'contracts', submission_id: 'sub1', data_path: 'attachment' })).body).to.deep.equal({ file_name: 'a.txt', type: 'text/plain', pages: null, text: 'First note' });
        expect((await call({ form_name: 'contracts', submission_id: 'sub1', data_path: 'attachment[1]' })).body.text).to.equal('Second note');
        expect((await call({ form_name: 'contracts', submission_id: 'sub1', data_path: 'scan' })).body.text).to.equal('In a panel');
    });

    it('answers an error for a path that holds no file, and for a file no converter reads', async () => {
        started = await start({ forms: { contracts } });
        started.formio.submissions['sub2'] = { _id: 'sub2', form: started.formio.formIds.contracts, data: { name: 'Ada', attachment: [upload(Buffer.from([0, 1, 2, 3]), 'blob.bin', 'application/octet-stream')] } };
        const notAFile = await call({ form_name: 'contracts', submission_id: 'sub2', data_path: 'name' });
        expect(notAFile.isError).to.equal(true);
        expect(notAFile.body.error).to.include('No uploaded file at "name"');
        const unreadable = await call({ form_name: 'contracts', submission_id: 'sub2', data_path: 'attachment' });
        expect(unreadable.isError).to.equal(true);
        expect(unreadable.body.error).to.include('cannot be read as text');
    });
});
