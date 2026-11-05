import { expect } from 'chai';
import { UAGFormInterface } from '../../src/UAGFormInterface';
import { submissionUpdate } from '../../src/tools/submissionUpdate';
import { makeProject } from '../agent/fixtures';

const notes = {
    title: 'Notes', type: 'form', name: 'notes', path: 'notes', tags: ['uag'],
    components: [
        { type: 'textarea', key: 'body', label: 'Body', input: true, editor: 'ckeditor' },
        { type: 'textarea', key: 'plain', label: 'Plain', input: true },
        { type: 'datagrid', key: 'rows', label: 'Rows', input: true, components: [{ type: 'textarea', key: 'note', label: 'Note', input: true, editor: 'quill' }] }
    ]
};
const unsafe = '<p onclick="steal()">Hi <script>steal()</script><a href="javascript:steal()">x</a></p>';

/** Rich text an MCP client writes is reduced to the markup its editor keeps, as an engine's is. */
describe('Rich text written through MCP tools', () => {
    it('collect_field_data, confirm_form_submission and submit_completed_form: convertToSubmission sanitizes rich text fields only', () => {
        const form = new UAGFormInterface(makeProject({}), JSON.parse(JSON.stringify(notes)));
        const { data } = form.convertToSubmission({ body: unsafe, plain: unsafe, 'rows[0].note': unsafe }) as any;
        expect(data.body).to.equal('<p>Hi <a>x</a></p>');
        expect(data.rows[0].note).to.equal('<p>Hi <a>x</a></p>');
        expect(data.plain).to.equal(unsafe);
    });

    it('submission_update sanitizes the rich text it writes, and reports the value written', async () => {
        const project: any = makeProject({});
        const form = new UAGFormInterface(project, JSON.parse(JSON.stringify(notes)));
        let saved: any;
        (form as any).loadSubmission = async () => ({ _id: 's1', data: { body: '', plain: '' } });
        (form as any).submit = async (submission: any) => { saved = submission; return { ...submission, created: 'c', modified: 'm' }; };
        project.getForm = async () => form;
        const responses: any[] = [];
        project.mcpResponse = (_template: any, data: any, isError?: boolean) => { responses.push({ data, isError }); return {}; };
        const tool = await submissionUpdate(project);
        await tool.execute({ form_name: 'notes', submission_id: 's1', updates: [{ data_path: 'body', new_value: unsafe }, { data_path: 'plain', new_value: unsafe }] } as any, {} as any);
        expect(saved.data.body).to.equal('<p>Hi <a>x</a></p>');
        expect(saved.data.plain).to.equal(unsafe);
        expect(responses[0].data.updateSummary[0].new_value).to.equal('<p>Hi <a>x</a></p>');
    });
});
