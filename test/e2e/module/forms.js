/**
 * Forms the Agent API suites add to the e2e project, beyond the FNOL claim form.
 *
 * - `incident`: a support-request triage form with one field of each decision
 *   shape the UAG compiles (resource match, select boxes, multi-select, a
 *   described scale, a yes/no), open values, a closed-set field routed to the
 *   agent engine, a field inside a data grid, and a context field.
 * - `routing`: a minimal form for engine routing, fallback and streaming.
 */

const access = (roles) => ['create_own', 'create_all', 'read_own', 'read_all', 'update_own', 'update_all', 'delete_own', 'delete_all']
    .map((type) => ({ type, roles: type.endsWith('_all') ? roles : [] }));

const values = (pairs) => pairs.map(([label, value]) => ({ label, value }));

const incident = {
    title: 'Support Incident',
    name: 'incident',
    path: 'incident',
    type: 'form',
    display: 'form',
    tags: ['uag'],
    access: [{ type: 'read_all', roles: ['administrator', 'authenticated', 'anonymous', 'employee', 'manager'] }],
    submissionAccess: access(['administrator', 'employee']),
    components: [
        {
            type: 'textarea', key: 'report', label: 'What happened?', input: true,
            validate: { required: true },
            properties: { uag: 'support', uagField: 'input' }
        },
        {
            type: 'textfield', key: 'accountTier', label: 'Account tier', input: true
        },
        {
            type: 'textfield', key: 'internalNotes', label: 'Internal notes', input: true
        },
        {
            type: 'content', key: 'supportCriteria', input: false,
            html: '<p>Triage the support request: who it is from, how they reached us, what it affects and how severe it is.</p>',
            properties: { uag: 'support', uagField: 'criteria', uagContext: 'accountTier' }
        },
        {
            type: 'select', key: 'customer', label: 'Customer', input: true,
            dataSrc: 'resource',
            data: { resource: 'customer' },
            valueProperty: 'data.email',
            template: '<span>{{ item.data.firstName }} {{ item.data.lastName }}</span>',
            properties: { uag: 'support' }
        },
        {
            type: 'selectboxes', key: 'channels', label: 'Contact channels', input: true,
            values: values([['Email', 'email'], ['Phone', 'phone'], ['Chat', 'chat']]),
            properties: { uag: 'support' }
        },
        {
            type: 'select', key: 'products', label: 'Affected products', input: true, multiple: true,
            dataSrc: 'values',
            data: { values: values([['Billing', 'billing'], ['Login', 'login'], ['Reports', 'reports']]) },
            properties: { uag: 'support' }
        },
        {
            type: 'radio', key: 'severity', label: 'Severity', input: true,
            values: values([['Low', 'low'], ['Medium', 'medium'], ['High', 'high'], ['Critical', 'critical']]),
            properties: {
                uag: 'support',
                uagScale: 'true',
                uagOptionDescriptions: JSON.stringify({
                    low: 'A cosmetic problem; nothing is blocked.',
                    medium: 'Something is slow or awkward, and a workaround exists.',
                    high: 'One person or team cannot do their work.',
                    critical: 'An outage or data loss affecting many people.'
                })
            }
        },
        {
            type: 'checkbox', key: 'followUp', label: 'Follow up required', input: true,
            properties: { uag: 'support' }
        },
        {
            type: 'radio', key: 'queue', label: 'Queue', input: true,
            values: values([['Billing', 'billingTeam'], ['Login', 'identityTeam']]),
            // Routed to the agent engine, so it comes back as an uncalibrated suggestion.
            properties: { uag: 'support', uagEngine: 'agent' }
        },
        {
            type: 'textfield', key: 'summary', label: 'Summary', input: true,
            properties: { uag: 'support' }
        },
        {
            type: 'textfield', key: 'callbackNumber', label: 'Callback number', input: true,
            properties: { uag: 'support' }
        },
        {
            type: 'datagrid', key: 'affected', label: 'Affected users', input: true,
            components: [
                { type: 'textfield', key: 'user', label: 'User', input: true, properties: { uag: 'support' } }
            ]
        },
        { type: 'button', key: 'submit', label: 'Submit', input: true, action: 'submit' }
    ]
};

const routing = {
    title: 'Routing',
    name: 'routing',
    path: 'routing',
    type: 'form',
    display: 'form',
    tags: ['uag'],
    access: [{ type: 'read_all', roles: ['administrator', 'authenticated', 'anonymous'] }],
    submissionAccess: access(['administrator']),
    components: [
        {
            type: 'textarea', key: 'notes', label: 'Notes', input: true,
            properties: { uag: 'route', uagField: 'input' }
        },
        {
            type: 'radio', key: 'kind', label: 'Kind', input: true,
            values: values([['Theft', 'theft'], ['Property damage', 'propertyDamage']]),
            properties: { uag: 'route' }
        },
        {
            type: 'radio', key: 'kindFallback', label: 'Kind (fallback)', input: true,
            values: values([['Theft', 'theft'], ['Property damage', 'propertyDamage']]),
            // A decision engine that is down, then any agent engine.
            properties: { uag: 'route', uagEngine: 'e2e-down,agent' }
        },
        {
            type: 'textfield', key: 'location', label: 'Location', input: true,
            properties: { uag: 'route' }
        },
        {
            type: 'textfield', key: 'reference', label: 'Case reference', input: true,
            // An agent engine that is down, then one with a small rate limit.
            properties: { uag: 'route', uagEngine: 'e2e-down-agent,e2e-run-agent' }
        },
        { type: 'button', key: 'submit', label: 'Submit', input: true, action: 'submit' }
    ]
};

module.exports = { incident, routing };
