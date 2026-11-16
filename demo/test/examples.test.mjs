import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, formHtml, formKeyOf, formPathOf, loadExamples, readExample } from '../lib/examples.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = path.join(root, 'content/examples');

/** A content folder with one example per entry: `{ folder, meta, body, form, action }`. */
function fixture(entries) {
    const content = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-examples-'));
    fs.mkdirSync(path.join(content, 'developers'));
    fs.writeFileSync(path.join(content, 'developers', 'renderer.md'), '# Renderer\n');
    for (const { folder, meta = {}, body = 'What it does.\n', form, action } of entries) {
        const slug = folder.replace(/^\d+-/, '');
        const dir = path.join(content, 'examples', folder);
        fs.mkdirSync(dir, { recursive: true });
        const front = { title: `Title ${slug}`, summary: 'A summary.', group: 'Fill in forms', mode: 'form', docs: '../../developers/renderer.md', ...meta };
        fs.writeFileSync(path.join(dir, 'example.md'), `---\n${Object.entries(front).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n${body}`);
        fs.writeFileSync(path.join(dir, 'form.json'), JSON.stringify(form || { title: slug, name: formKeyOf(slug), path: formPathOf(slug), type: 'form', tags: ['uag'], components: [] }));
        if (action) fs.writeFileSync(path.join(dir, 'action.json'), JSON.stringify(action));
    }
    return content;
}

describe('Feature examples', function () {
    const made = [];
    const load = (entries) => {
        const content = fixture(entries);
        made.push(content);
        return loadExamples(path.join(content, 'examples'), { contentRoot: content });
    };
    after(function () {
        for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('loading', function () {
        it('orders examples by the number in their folder name, and maps their docs link to the site', function () {
            const examples = load([{ folder: '10-later' }, { folder: '02-sooner' }, { folder: '05-middle' }]);
            expect(examples.map((example) => example.slug)).to.deep.equal(['sooner', 'middle', 'later']);
            expect(examples[0]).to.include({ href: '/examples/sooner', docs: '/developers/renderer', order: 2 });
        });

        it('takes a "Try these" list out of the text as the example\'s samples', function () {
            const [example] = load([{ folder: '01-samples', body: 'Before.\n\n## Try these\n\n- First sample, with a comma.\n- Second sample.\n\nAfter.\n' }]);
            expect(example.samples).to.deep.equal(['First sample, with a comma.', 'Second sample.']);
            expect(example.html).to.include('Before.').and.include('After.').and.not.include('First sample');
        });

        it('refuses an example without a required setting, naming the folder', function () {
            for (const key of ['title', 'summary', 'group', 'mode', 'docs']) {
                expect(() => load([{ folder: '01-missing', meta: { [key]: undefined } }]), key).to.throw(`content/examples/01-missing: front matter needs ${key}`);
            }
        });

        it('refuses an unknown mode or group', function () {
            expect(() => load([{ folder: '01-mode', meta: { mode: 'wizard' } }])).to.throw(/01-mode: mode must be one of form, workflow, chat/);
            expect(() => load([{ folder: '01-group', meta: { group: 'Other' } }])).to.throw(/01-group: group must be one of/);
        });

        it('refuses a form at another path, without the uag tag, or with what the template adds', function () {
            const form = (extra) => ({ title: 't', name: 'exampleX', path: 'example-x', type: 'form', tags: ['uag'], components: [], ...extra });
            expect(() => load([{ folder: '01-x', form: form({ path: 'x' }) }])).to.throw(/path must be example-x/);
            expect(() => load([{ folder: '01-x', form: form({ tags: [] }) }])).to.throw(/tagged uag/);
            expect(() => load([{ folder: '01-x', form: form({ access: [] }) }])).to.throw(/what the template adds: access/);
        });

        it('refuses a workflow example without its action, and a highlight the form does not use', function () {
            expect(() => load([{ folder: '01-x', meta: { mode: 'workflow', group: 'Workflows' } }])).to.throw(/workflow example needs action.json/);
            expect(() => load([{ folder: '01-x', meta: { highlight: 'uagScale' } }])).to.throw(/highlight names uagScale/);
        });

        it('keeps each group together, and the groups in the catalog\'s order', function () {
            expect(() => load([{ folder: '01-a' }, { folder: '02-b', meta: { group: 'Workflows' } }, { folder: '03-c' }])).to.throw(/split by another/);
            expect(() => load([{ folder: '01-a', meta: { group: 'Chat widget', mode: 'chat' } }, { folder: '02-b' }])).to.throw(/groups must come in the order/);
        });

        it('marks every line of the form that holds a highlighted property', function () {
            const form = { title: 't', name: 'exampleX', path: 'example-x', type: 'form', tags: ['uag'], components: [{ type: 'textarea', key: 'd', properties: { uag: 'fill', uagField: 'input' } }] };
            const [example] = load([{ folder: '01-x', form, meta: { highlight: 'uagField' } }]);
            const marked = formHtml(example).split('\n').filter((line) => line.startsWith('<mark>'));
            expect(marked).to.deep.equal(['<mark>        &quot;uagField&quot;: &quot;input&quot;</mark>']);
        });
    });

    describe('the catalog', function () {
        const examples = loadExamples(EXAMPLES);

        it('lists the first batch in its order, the chat widget after the form and workflow examples', function () {
            expect(examples.map((example) => example.title)).to.deep.equal([
                'Fill a form from a description',
                'Streamed results',
                'Choose from a set of options',
                'Confidence and the unsure band',
                'Generate written text',
                'The person\'s own input wins',
                'Run an agent task after a submission',
                'Fields only the agent may set',
                'Chat widget',
                'Validation in the chat widget',
            ]);
            const groups = examples.map((example) => example.group);
            expect(groups.indexOf('Chat widget')).to.be.greaterThan(groups.lastIndexOf('Workflows'));
            expect([...new Set(groups)]).to.deep.equal(GROUPS);
        });

        it('names no industry, no customer story, and no "conversation form"', function () {
            const banned = /\b(?:conversation(?:al)? forms?|insur\w*|claims?|policyholders?|patients?|admissions?|applicants?|leases?|tenants?|loans?|mortgages?|invoices?)\b/i;
            for (const example of examples) {
                const folder = path.join(EXAMPLES, example.folder);
                for (const file of fs.readdirSync(folder)) {
                    const text = fs.readFileSync(path.join(folder, file), 'utf8');
                    expect(banned.exec(text)?.[0], `${example.folder}/${file}`).to.equal(undefined);
                }
            }
        });

        it('reads every example as it is checked in', function () {
            for (const example of examples) expect(readExample(path.join(EXAMPLES, example.folder)).slug).to.equal(example.slug);
        });
    });
});
