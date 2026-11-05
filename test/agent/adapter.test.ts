import { expect } from 'chai';
import z from 'zod';
import { formflowTool } from '../../src/agent/tools';
import { claimForm, makeProject } from './fixtures';
import type { ToolInfo } from '../../src/tools/utils';

/**
 * The UAG's side of the boundary with Agentic Formflow: its MCP tools as
 * Formflow tools, and its forms as Formflow forms.
 */
describe('Formflow adapters', () => {
    describe('formflowTool', () => {
        const calls: any[] = [];
        const project: any = { name: 'the project' };
        const tool: ToolInfo = {
            name: 'set_value',
            title: 'Set a value',
            description: 'Sets a value.',
            annotations: { readOnlyHint: false },
            inputSchema: { path: z.string(), value: z.number() },
            execute: async (args: any, extra: any) => {
                calls.push({ args, extra });
                return { content: [{ type: 'text', text: 'ok' }] };
            }
        } as any;

        it('describes the tool in JSON schema', () => {
            const adapted = formflowTool(tool, project);
            expect(adapted.name).to.equal('set_value');
            expect(adapted.description).to.equal('Sets a value.');
            expect(adapted.inputSchema).to.not.have.property('$schema');
            expect(adapted.inputSchema.properties).to.have.keys(['path', 'value']);
        });

        it('validates arguments with the tool\'s own schema, dropping unknown ones', () => {
            const adapted = formflowTool(tool, project);
            expect(adapted.parse({ path: 'a', value: 1, extra: true })).to.deep.equal({ ok: true, value: { path: 'a', value: 1 } });
            const bad: any = adapted.parse({ path: 'a', value: 'one' });
            expect(bad.ok).to.equal(false);
            expect(bad.error).to.be.a('string');
        });

        it('is read-only only when annotated read-only', () => {
            expect(formflowTool(tool, project).readOnly).to.equal(false);
            expect(formflowTool({ ...tool, annotations: { readOnlyHint: true } } as any, project).readOnly).to.equal(true);
            expect(formflowTool({ ...tool, annotations: undefined } as any, project).readOnly).to.equal(false);
        });

        it('runs the tool with the caller as its auth info, and the project', async () => {
            const auth: any = { user: { _id: 'u1' } };
            await formflowTool(tool, project).execute({ path: 'a', value: 1 }, auth);
            const last = calls[calls.length - 1];
            expect(last.args).to.deep.equal({ path: 'a', value: 1 });
            expect(last.extra.authInfo).to.equal(auth);
            expect(last.extra.project).to.equal(project);
        });

        it('falls back to the title, then the name, for the description', () => {
            expect(formflowTool({ ...tool, description: undefined } as any, project).description).to.equal('Set a value');
            expect(formflowTool({ ...tool, description: undefined, title: undefined } as any, project).description).to.equal('set_value');
        });
    });

    describe('UAGFormInterface as a Formflow form', () => {
        it('names the form, lists its tasks, and labels values in form order', () => {
            const project = makeProject({ claim: claimForm() });
            const form: any = project.forms.claim;
            expect(form.formflowName).to.equal('claim');
            expect(Object.keys(form.formflowTasks())).to.deep.equal(['triage']);
            expect(form.formflowTasks()).to.equal(form.uagFields);
            expect(form.formflowTasks().triage.task).to.equal('triage');
            const lines = form.formflowLabeledData({ lossDescription: 'Hail', notes: 'Second call', triage: { claimType: 'theft' } });
            expect(lines).to.deep.include({ path: 'lossDescription', label: 'Tell us what happened' });
            expect(lines).to.deep.include({ path: 'notes', label: 'Notes' });
            expect(lines.map((line: any) => line.path).indexOf('lossDescription')).to.be.lessThan(lines.map((line: any) => line.path).indexOf('notes'));
            expect(lines.every((line: any) => Object.keys(line).length === 2)).to.equal(true);
        });
    });
});
