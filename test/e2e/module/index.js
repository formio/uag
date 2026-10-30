/**
 * UAG module configuration used by the end-to-end test suite. Provides the
 * test project template (uag-tagged customer resource with required and
 * conditional fields, plus a college application form configured for the
 * agent_provide workflow, the FNOL wizard's claim form, and the Agent API
 * suites' incident and routing forms), and the scripted engine types those
 * suites enable with UAG_ENGINES.
 *
 * `E2E_UAG_CONFIG` (JSON) adds configuration for one suite's stack, such as
 * `routing` and `agentApi`.
 *
 * `E2E_TEMPLATE=demo` installs the demo site's own project instead
 * (demo/module/project.json).
 */
const template = require('./template.json');
const { incident, routing } = require('./forms');
const { engineTypes } = require('./engines');

// The demo site's claim form and its actions, so the Agent API suite exercises
// the same form the Agentic Formflow demo ships.
const fnol = require('../../../demo/module/project.json');
template.forms = { ...template.forms, claim: fnol.forms.claim, incident, routing };
const save = (form) => ({ ...fnol.actions['claim:save'], form });
template.actions = {
    ...template.actions,
    'claim:save': fnol.actions['claim:save'],
    'claim:triage': fnol.actions['claim:triage'],
    'incident:save': save('incident'),
    'routing:save': save('routing'),
};

// Signed-in users (the stock "authenticated" role) may work on applications but
// not claims, so the Agent API suites can check a user's own permissions apply.
for (const permission of template.forms.application.submissionAccess) {
    if (['create_all', 'read_all', 'update_all'].includes(permission.type)) {
        permission.roles = [...permission.roles, 'authenticated'];
    }
}

// `E2E_RUN_TASK=<form>:<task>,...` runs each named task after a submission to its
// form is saved through the UAG, as an "Agent: Run task" action does.
for (const pair of (process.env.E2E_RUN_TASK || '').split(',').filter(Boolean)) {
    const [form, task] = pair.split(':');
    template.actions[`${form}:agent`] = {
        title: `Agent: Run task (${task})`, name: 'agentRunTask', form, priority: 20,
        handler: ['before', 'after'], method: ['create'],
        settings: { task, answer: 'task', when: 'after' },
    };
}

/** The demo site's project. */
function demo() {
    return JSON.parse(JSON.stringify(require('../../../demo/module/project.json')));
}

const templates = { demo };

const extra = process.env.E2E_UAG_CONFIG ? JSON.parse(process.env.E2E_UAG_CONFIG) : {};

module.exports = {
    config: {
        template: templates[process.env.E2E_TEMPLATE]?.() || template,
        loginForm: '',
        responseTemplates: {},
        toolOverrides: {},
        tools: [],
        engineTypes,
        ...extra
    },
    actions: {}
};
