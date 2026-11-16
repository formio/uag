/**
 * Writes the feature examples' forms and actions into the demo project's
 * template (demo/module/project.json), so the project the live examples load
 * from has exactly the forms their pages show.
 *
 *   yarn demo:examples:sync          write the template
 *   yarn demo:examples:sync --check  fail, naming each example, if it is out of date
 *
 * Each example's form goes in as `example<Name>` (path `example-<slug>`), with
 * a Save Submission action and the example's own action (action.json), if any.
 * Guests may create their own submissions; a workflow example's guests may also
 * read and update their own, which its after-save task needs to save its answers
 * and the page needs to read them back. Forms and actions of examples that no
 * longer exist are removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formKeyOf, loadExamples } from '../lib/examples.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const TEMPLATE = path.join(ROOT, 'module/project.json');
const PREFIX = /^example[A-Z]/;

const ACCESS = [{ type: 'read_all', roles: ['administrator', 'authenticated', 'anonymous', 'guest'] }];

function submissionAccess(workflow) {
    const own = ['authenticated', 'guest'];
    return [
        { type: 'create_own', roles: own },
        { type: 'create_all', roles: ['administrator'] },
        { type: 'read_own', roles: workflow ? own : [] },
        { type: 'read_all', roles: ['administrator'] },
        { type: 'update_own', roles: workflow ? own : [] },
        { type: 'update_all', roles: ['administrator'] },
        { type: 'delete_own', roles: [] },
        { type: 'delete_all', roles: ['administrator'] },
    ];
}

/** The template's form and actions for one example. */
export function templateEntries(example) {
    const key = formKeyOf(example.slug);
    const form = structuredClone({ ...example.form, access: ACCESS, submissionAccess: submissionAccess(example.mode === 'workflow') });
    const actions = { [`${key}:save`]: { title: 'Save Submission', name: 'save', form: key, priority: 10, method: ['create', 'update'], handler: ['before'] } };
    if (example.action) actions[`${key}:${example.action.settings?.task || 'action'}`] = structuredClone({ ...example.action, form: key });
    return { key, form, actions };
}

/** The template with every example's form and actions, and no others named like them. */
export function syncTemplate(template, examples) {
    const next = structuredClone(template);
    for (const key of Object.keys(next.forms)) if (PREFIX.test(key)) delete next.forms[key];
    for (const key of Object.keys(next.actions)) if (PREFIX.test(next.actions[key].form || '')) delete next.actions[key];
    for (const example of examples) {
        const { key, form, actions } = templateEntries(example);
        next.forms[key] = form;
        Object.assign(next.actions, actions);
    }
    return next;
}

/** The examples whose form or actions differ from the template's. */
export function outOfStep(template, examples) {
    const synced = syncTemplate(template, examples);
    const stale = examples.filter((example) => {
        const { key, actions } = templateEntries(example);
        return JSON.stringify(template.forms[key]) !== JSON.stringify(synced.forms[key])
            || Object.keys(actions).some((name) => JSON.stringify(template.actions[name]) !== JSON.stringify(synced.actions[name]));
    }).map((example) => example.folder);
    const removed = Object.keys(template.forms).filter((key) => PREFIX.test(key) && !synced.forms[key]);
    return [...stale, ...removed.map((key) => `${key} (no longer an example)`)];
}

/** The template as the repository keeps it: two-space JSON, non-ASCII escaped. */
export function serialize(template) {
    return `${JSON.stringify(template, null, 2).replace(/[\u007f-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const examples = loadExamples(path.join(ROOT, 'content/examples'));
    const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
    if (process.argv.includes('--check')) {
        const stale = outOfStep(template, examples);
        if (stale.length) {
            console.error(`[demo:examples:sync] The template is out of date for: ${stale.join(', ')}. Run yarn demo:examples:sync.`);
            process.exit(1);
        }
        console.log('[demo:examples:sync] The template matches the examples.');
    }
    else {
        fs.writeFileSync(TEMPLATE, serialize(syncTemplate(template, examples)));
        console.log(`[demo:examples:sync] Wrote ${examples.length} example forms into module/project.json.`);
    }
}
