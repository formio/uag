/**
 * UAG module configuration used by the end-to-end test suite. Provides the
 * test project template (uag-tagged customer resource with required and
 * conditional fields, plus a college application form configured for the
 * agent_provide_data workflow, the FNOL wizard's claim form, and the Agent API
 * suites' incident and routing forms), and the scripted engine types those
 * suites enable with UAG_ENGINES.
 *
 * `E2E_UAG_CONFIG` (JSON) adds configuration for one suite's stack, such as
 * `routing` and `agentApi`.
 *
 * `E2E_TEMPLATE=demo` installs the demo site's own project instead
 * (demo/module/project.json), with each webhook action pointed at the test's
 * relay (`E2E_WEBHOOK_RELAY/<action key>`), which sends it on as Enterprise
 * Form.io would (see helpers/webhookRelay.mjs).
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
    'claim:agentDecide': fnol.actions['claim:agentDecide'],
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

/** The demo site's project, with its webhooks sent to the test's relay. */
function demo() {
    const project = JSON.parse(JSON.stringify(require('../../../demo/module/project.json')));
    for (const [key, action] of Object.entries(project.actions)) {
        if (action.name === 'webhook') {
            action.settings = { ...action.settings, url: `${process.env.E2E_WEBHOOK_RELAY}/${encodeURIComponent(key)}` };
        }
    }
    return project;
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
