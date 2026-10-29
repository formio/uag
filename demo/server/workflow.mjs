/**
 * Agentic workflow: a college application that agents review with no human
 * involved.
 *
 * The visitor submits an application. That is all this code does: it saves the
 * submission through the UAG and reads it back. Everything after that is form
 * configuration. An "Agent: Run task" action on the form runs the admissions
 * task after the save: an engine scores the application against the rubric in
 * the form's criteria component, and the UAG saves the result as an update.
 * When the admissions task puts an applicant on the scholarship track, that
 * update runs the second action, and the finance task picks an award. The
 * agents' fields are `uagAuthoritative`, so nothing sent from the browser can
 * set them.
 *
 *   GET  /api/workflow/form                the application form
 *   GET  /api/workflow/applicants          the sample applicants
 *   POST /api/workflow/applications        submit an application
 *   GET  /api/workflow/applications/:id    one of this visitor's applications, as the agents have left it
 */
import { PROFILES, SCORE_FIELDS, settled } from '../module/applicants.mjs';

const FORM = 'application';
// The applicant's fields; the rest of the form belongs to the agents.
const APPLICANT_FIELDS = [
    'firstName', 'lastName', 'email', 'dateOfBirth', 'phone', 'address',
    'highSchool', 'gpa', 'testType', 'testScore', 'extracurriculars', 'leadership', 'service', 'essay',
];
const RESULT_FIELDS = ['status', 'decision', 'awardLevel', ...SCORE_FIELDS, 'overallScore', 'agentRationale', 'financeRationale'];

function pick(data, keys) {
    return Object.fromEntries(keys.filter((key) => data?.[key] !== undefined).map((key) => [key, data[key]]));
}

export function workflowRoutes(router, { config, formio, uag, sessions, flow, guard }) {
    router.get('/api/workflow/form', async (req, res) => {
        const response = await formio.form(FORM);
        res.status(response.status).json(response.body);
    });

    router.get('/api/workflow/applicants', (req, res) => {
        res.json(PROFILES);
    });

    /** Refuse, before anything is charged, an application the demo would not send to the agents. */
    function validate(req, res, next) {
        // Only the applicant's own fields: the agents' fields cannot be pre-filled from the browser.
        const data = pick(req.body?.data, APPLICANT_FIELDS);
        if (typeof data.firstName !== 'string' || !data.firstName || typeof data.essay !== 'string' || !data.essay) {
            res.status(400).json({ error: 'An application needs at least a first name and an essay.' });
            return;
        }
        for (const [key, value] of Object.entries(data)) {
            if (value !== null && typeof value === 'object') {
                res.status(400).json({ error: `"${key}" must be a single value.` });
                return;
            }
            if (typeof value === 'string' && value.length > config.maxInputLength) {
                res.status(400).json({ error: `"${key}" is too long for this demo.` });
                return;
            }
        }
        req.application = data;
        next();
    }

    router.post('/api/workflow/applications', validate, guard.protect('submit', config.budget.costs.application), async (req, res) => {
        let response;
        try {
            // The visitor's request id goes with the agents' runs, so the flow viewer shows them.
            response = await uag.submit(await formio.pathOf(FORM), req.application, { requestId: sessions.requestId(req.session) });
        }
        catch {
            res.status(502).json({ error: 'The application could not be saved. Please try again.' });
            return;
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body._id) {
            res.status(response.status >= 400 ? response.status : 502).json({ error: body?.message || 'The application was not accepted.', details: body?.details });
            return;
        }
        flow.own(req.session, body._id, FORM);
        res.status(201).json({ id: body._id });
    });

    // The visitor's page polls its application. Form.io is asked at most once a
    // second for each, however often it is polled.
    const reads = new Map();
    function readApplication(id) {
        const now = Date.now();
        const cached = reads.get(id);
        if (cached && cached.expires > now) return cached.response;
        for (const [key, read] of reads) {
            if (read.expires <= now) reads.delete(key);
        }
        const response = formio.submission(FORM, id);
        reads.set(id, { response, expires: now + 1000 });
        return response;
    }

    router.get('/api/workflow/applications/:id', async (req, res) => {
        if (!req.session.submissions.has(req.params.id)) {
            res.status(404).json({ error: 'No such application in this session.' });
            return;
        }
        const response = await readApplication(req.params.id);
        if (!response.ok) {
            res.status(response.status).json({ error: 'The application could not be read.' });
            return;
        }
        const data = response.body.data || {};
        res.json({ id: req.params.id, settled: settled(data), result: pick(data, RESULT_FIELDS), modified: response.body.modified });
    });
}
