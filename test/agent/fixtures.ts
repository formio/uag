import { MockProjectInterface } from '../tools/mock';
import { UAGFormInterface } from '../../src/UAGFormInterface';

/**
 * A trimmed FNOL claim form: an input description, a triage container of
 * decision fields for the `triage` task, a value field, and a page shown only
 * when triage says someone was injured.
 */
export const claimForm = () => ({
    _id: 'claimFormId',
    title: 'Claim',
    name: 'claim',
    path: 'claim',
    tags: ['uag'],
    components: [
        {
            type: 'textarea', key: 'lossDescription', label: 'Tell us what happened', input: true,
            properties: { uag: 'triage', uagField: 'input' }
        },
        {
            type: 'container', key: 'triage', label: 'Triage', input: true, properties: { uag: 'triage' },
            components: [
                {
                    type: 'content', key: 'triageCriteria', input: false,
                    html: '<p>Classify the loss from the description.</p>',
                    properties: { uag: 'triage', uagField: 'criteria' }
                },
                {
                    type: 'radio', key: 'claimType', label: 'Claim type', input: true,
                    values: [
                        { label: 'Auto: collision', value: 'autoCollision' },
                        { label: 'Auto: glass only', value: 'autoGlass' },
                        { label: 'Theft', value: 'theft' }
                    ],
                    properties: { uagThreshold: '0.85', uagConfidenceField: 'triage.claimTypeConfidence' }
                },
                {
                    type: 'radio', key: 'severity', label: 'Severity', input: true,
                    values: [
                        { label: 'Minor', value: 'minor' },
                        { label: 'Moderate', value: 'moderate' },
                        { label: 'Severe', value: 'severe' }
                    ],
                    properties: {
                        uagScale: 'true',
                        uagOptionDescriptions: JSON.stringify({
                            minor: 'Cosmetic damage only and nobody hurt.',
                            moderate: 'Repairable damage, or a minor injury that needed no hospital visit.',
                            severe: 'The vehicle or property is a total loss, or someone needed hospital care.'
                        })
                    }
                },
                { type: 'checkbox', key: 'injuryInvolved', label: 'Injury involved', input: true },
                {
                    type: 'selectboxes', key: 'damage', label: 'Damage', input: true,
                    values: [{ label: 'Vehicle', value: 'vehicle' }, { label: 'Property', value: 'property' }]
                },
                { type: 'datetime', key: 'lossDate', label: 'Loss date', input: true },
                { type: 'hidden', key: 'claimTypeConfidence', input: true }
            ]
        },
        {
            type: 'textfield', key: 'injuredName', label: 'Injured person', input: true,
            properties: { uag: 'triage' },
            conditional: { show: true, conjunction: 'all', conditions: [{ component: 'triage.injuryInvolved', operator: 'isEqual', value: true }] }
        },
        { type: 'textfield', key: 'notes', label: 'Notes', input: true }
    ]
});

export const inspectorResource = (count = 3) => ({
    _id: 'inspectorResourceId',
    title: 'Inspector',
    name: 'inspector',
    path: 'inspector',
    type: 'resource',
    tags: ['uag'],
    components: [{ type: 'textfield', key: 'name', label: 'Name', input: true }],
    submissions: Array.from({ length: count }, (_, i) => ({ _id: `insp${i}`, data: { name: i === 0 ? 'Alpha Inspector' : `Inspector ${i}` } }))
});

export const inspectionForm = (newRecord = false) => ({
    _id: 'inspectionFormId',
    title: 'Inspection',
    name: 'inspection',
    path: 'inspection',
    tags: ['uag'],
    components: [
        { type: 'textarea', key: 'text', label: 'What happened', input: true, properties: { uag: 'intake', uagField: 'input' } },
        {
            type: 'select', key: 'inspector', label: 'Inspector', input: true, dataSrc: 'resource',
            data: { resource: 'inspectorResourceId' }, valueProperty: '_id', template: '<span>{{ item.data.name }}</span>',
            searchField: 'data.name__regex',
            properties: { uag: 'intake', ...(newRecord ? { uagNewRecord: 'true' } : {}) }
        }
    ]
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config({ quiet: true });

/**
 * The UAG license the Agentic Formflow tests run under. Formflow needs a license
 * (or a project on Form.io's hosted service) wherever the project runs, so these
 * tests need one: UAG_TEST_LICENSE, or E2E_UAG_LICENSE, from the environment or
 * the root .env. Any license serves the fixtures' localhost project.
 */
export const TEST_LICENSE = process.env.UAG_TEST_LICENSE || process.env.E2E_UAG_LICENSE || '';

/** Skip a test that runs Agentic Formflow when there is no test license. */
export function requireTestLicense(context: Mocha.Context): void {
    if (!TEST_LICENSE) {
        console.log('      Skipping: set UAG_TEST_LICENSE to run the Agentic Formflow tests.');
        context.skip();
    }
}

export class AgentTestProject extends MockProjectInterface {
    public agentConfig: any = {};
    /** Form definition `_id` → form key, since the parsed form does not keep `_id`. */
    public formIds: Record<string, string> = {};
    /** Licensed with TEST_LICENSE unless `agentConfig` sets its own `license`. */
    get config(): any { return { license: TEST_LICENSE, ...this.agentConfig }; }
    async getFormById(id: string) {
        return this.forms[this.formIds[id]] || null;
    }
}

/** Build a project whose forms have had their components (and so their tasks) parsed. */
export function makeProject(forms: Record<string, any>): AgentTestProject {
    const submissions: Record<string, any[]> = {};
    for (const [key, def] of Object.entries(forms)) {
        submissions[key] = def.submissions || [];
    }
    // Read the ids first: constructing the form interfaces strips `_id` from the definitions.
    const ids = Object.entries(forms).filter(([, def]) => def._id).map(([key, def]) => [def._id, key]);
    // A local project, licensed with TEST_LICENSE (see AgentTestProject).
    const project = new AgentTestProject(forms, submissions, 'http://localhost:3001');
    project.formIds = Object.fromEntries(ids);
    for (const form of Object.values(project.forms) as UAGFormInterface[]) {
        form.uagFields = {};
        form.setForm(form.form);
    }
    return project;
}

export const auth: any = {
    user: { _id: 'user1' },
    formPermissions: () => ({ create: true, read: true, update: true, delete: false })
};
