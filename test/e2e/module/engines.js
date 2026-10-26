/**
 * Scripted engines for the Agent API end-to-end suites.
 *
 * The built-in stub engines answer every question the same way, which is enough
 * to show the plumbing works but not to show that the UAG makes the right call
 * from what a model answers. These engines behave like models over a small,
 * fixed vocabulary: they read the task's input and answer from keywords, so
 * a test can describe a claim in plain words ("my car was stolen", "nobody was
 * hurt", "I think") and get a predictable answer. They:
 *
 * - pick an option even when the input says nothing,
 * - pick the first option listed when the input fits several,
 * - answer with lower confidence when the writer hedges ("I think", "maybe"),
 * - report weak evidence that only a field with a wide uncertainty band accepts.
 *
 * Every call is recorded so a test can check what an engine was sent: which
 * state, which questions, which research tools, and whether it got a scoped token.
 *
 *   e2e-decision     keyword decision engine (calibrated)
 *   e2e-agent        keyword extraction and admissions reviews, researching with a task's tools
 *   e2e-run-agent    the same agent under another name, so its rate limit is separate
 *   e2e-slow-agent   e2e-agent that takes E2E_SLOW_AGENT_MS (default 1500) to extract
 *   e2e-down         a decision engine that always fails
 *   e2e-down-agent   an agent engine that always fails
 *   e2e-slow         a decision engine that answers after E2E_SLOW_MS (default 2000)
 */

const calls = [];

/** Record a call, and return the stored entry so a test can see what happened after it. */
function record(engine, task, details) {
    const entry = { engine, task, at: Date.now(), ...details };
    calls.push(entry);
    return entry;
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
        });
    });
}

/** Every string in the task's input, as one text. */
function inputText(state) {
    const parts = [];
    const walk = (value) => {
        if (typeof value === 'string') parts.push(value);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(state?.input);
    return parts.join('\n');
}

const has = (text, words) => words.some((word) => text.includes(word));

/**
 * Vocabulary by option label (choice and score questions, and select boxes) or
 * by field label (yes/no questions).
 */
const OPTION_WORDS = {
    // claim.triage.claimType
    'Auto: collision': ['rear-ended', 'collision', 'crashed', 'hit my car'],
    'Auto: glass only': ['windshield', 'cracked glass'],
    'Theft': ['stolen', 'theft', 'broke into'],
    'Property damage': ['fence', 'garage door', 'tree fell'],
    // claim's Yes / No / Not sure questions (forced entry, drivable), so that a
    // bare "no" in "no receipt" is not read as an answer
    'Yes': ['signs of forced entry', 'smashed the window', 'still drives'],
    'No': ['no sign of forced entry', 'was unlocked', 'had to be towed'],
    'Not sure': ['not sure whether'],
    // incident.channels
    'Email': ['email', 'e-mail'],
    'Phone': ['phone', 'called'],
    'Chat': ['chat'],
    // incident.products
    'Billing': ['invoice', 'billing', 'charged'],
    'Login': ['log in', 'login', 'password'],
    'Reports': ['report'],
    // incident.severity
    'Low': ['cosmetic', 'typo'],
    'Medium': ['slow', 'workaround'],
    'High': ['cannot', "can't", 'blocked'],
    'Critical': ['outage', 'everyone is down', 'data loss'],
};

const YES_NO = {
    'Someone was injured': {
        affirm: ['hurt', 'injur', 'ambulance', 'whiplash'],
        deny: ['no one was hurt', 'nobody was hurt', 'no injuries', 'nobody was injured', 'no one was injured'],
    },
    'Another party was involved': {
        affirm: ['rear-ended', 'other driver', 'another car'],
        deny: ['no other car', 'nobody else was involved', 'single-car'],
    },
    'Fraud signals present': {
        // Weak signals only: a field with a wide uncertainty band accepts them.
        weak: ['paid cash', 'no receipt', 'policy started last week', 'just bought the policy'],
    },
    'Follow up required': {
        affirm: ['call me back', 'follow up', 'please get back'],
        deny: ['no need to follow up', 'no follow up needed'],
    },
};

const HEDGES = ['i think', 'maybe', 'not sure', 'possibly'];

function normalized(top, n) {
    return n <= 1 ? 1 : Math.max(0, (top - 1 / n) / (1 - 1 / n));
}

/** The text between the first pair of double quotes. */
function quoted(instructions) {
    return /"([^"]+)"/.exec(instructions)?.[1];
}

/** Whether a resource record's label appears in the input, by full name or surname. */
function mentionsRecord(text, label) {
    const name = label.toLowerCase().trim();
    if (!name) return false;
    const surname = name.split(/\s+/).pop();
    return text.includes(name) || (surname.length > 2 && new RegExp(`\\b${surname}\\b`).test(text));
}

function optionMatches(text, label, resource) {
    if (resource) return mentionsRecord(text, label);
    const words = OPTION_WORDS[label] || [label.toLowerCase()];
    return has(text, words);
}

function choiceAnswer(question, text, hedged, resource) {
    const labels = Object.keys(question.options);
    const matched = labels.filter((label) => optionMatches(text, label, resource));
    const probabilities = Object.fromEntries(labels.map((label) => [label, 0]));
    let choice;
    let top;
    if (matched.length === 1) {
        choice = matched[0];
        top = hedged ? 0.6 : 0.95;
    }
    else if (matched.length > 1) {
        // Several options fit: like a real model, favor the one listed first.
        choice = matched[0];
        top = 0.5;
        probabilities[matched[1]] = 0.4;
    }
    else {
        // Nothing fits: a forced, low-probability pick of the first option.
        choice = labels[0];
        top = 0.3;
    }
    probabilities[choice] = top;
    const rest = labels.filter((label) => !probabilities[label]);
    const remaining = Math.max(0, 1 - Object.values(probabilities).reduce((a, b) => a + b, 0));
    rest.forEach((label) => { probabilities[label] = remaining / rest.length; });
    return { type: 'choice', choice, probabilities, confidence: normalized(top, labels.length) };
}

function scoreAnswer(question, text, hedged) {
    const labels = question.levels.map((level) => level.split(':')[0].trim());
    let index = labels.findIndex((label) => has(text, OPTION_WORDS[label] || [label.toLowerCase()]));
    const top = index === -1 ? 0.3 : (hedged ? 0.6 : 0.9);
    if (index === -1) index = 0;
    const probabilities = {};
    labels.forEach((_, i) => { probabilities[String(i)] = i === index ? top : (1 - top) / Math.max(1, labels.length - 1); });
    return { type: 'score', score: index, probabilities, confidence: normalized(top, labels.length) };
}

/** The probability of "yes" for an affirm or deny question. */
function yesNo(id, instructions, text) {
    const denyQuestion = id.startsWith('deny:');
    // Select boxes and multi-selects: '"<option>" applies for <field>'.
    const option = /that (?:it is NOT the case that )?"([^"]+)" applies for/.exec(instructions)?.[1];
    if (option) {
        const affirmed = has(text, OPTION_WORDS[option] || [option.toLowerCase()]);
        const denied = has(text, [`not by ${option.toLowerCase()}`, `no ${option.toLowerCase()}`]);
        if (denyQuestion) return denied ? 0.95 : 0.03;
        return affirmed && !denied ? 0.95 : 0.03;
    }
    // The subject is the field label, followed by its description when it has one.
    const subject = quoted(instructions) || '';
    const words = Object.entries(YES_NO).find(([label]) => subject.startsWith(label))?.[1];
    if (!words) return 0.03;
    const denied = has(text, words.deny || []);
    const affirmed = !denied && has(text, words.affirm || []);
    const weak = !denied && !affirmed && has(text, words.weak || []);
    if (denyQuestion) return denied ? 0.95 : 0.03;
    if (affirmed) return 0.95;
    if (weak) return 0.6;
    return 0.03;
}

/** Whether the input addresses a choice/score/resource field at all. */
function mentionAnswer(questions, id, text) {
    // The mention check's twin: same path (and survey row key), role "choice" or "score".
    const target = id.slice('mention:'.length);
    const twin = questions[`choice:${target}`] || questions[`score:${target}`];
    if (!twin) return 0.03;
    const resource = twin.instructions.startsWith('Which of these existing records');
    if (resource) {
        // The input refers to a record when it names one, or talks about one by role.
        const subject = /records is the (\w+)/.exec(twin.instructions)?.[1]?.toLowerCase() || '';
        const named = Object.keys(twin.options).some((label) => mentionsRecord(text, label));
        return named || (subject && text.includes(subject)) ? 0.95 : 0.03;
    }
    const labels = twin.type === 'choice' ? Object.keys(twin.options) : twin.levels.map((level) => level.split(':')[0].trim());
    return labels.some((label) => optionMatches(text, label, false)) ? 0.95 : 0.03;
}

function keywordDecisionEngine(name) {
    return {
        name,
        kind: 'decision',
        model: `${name}-1`,
        maxOptions: 255,
        async decide({ state, questions }) {
            record(name, 'decide', { state, questions: Object.keys(questions) });
            const text = inputText(state).toLowerCase();
            const hedged = has(text, HEDGES);
            const answers = {};
            for (const [id, question] of Object.entries(questions)) {
                if (question.type === 'choice') {
                    const resource = question.instructions.startsWith('Which of these existing records');
                    answers[id] = choiceAnswer(question, text, hedged, resource);
                }
                else if (question.type === 'score') {
                    answers[id] = scoreAnswer(question, text, hedged);
                }
                else if (id.startsWith('mention:')) {
                    answers[id] = { type: 'noul', probability: mentionAnswer(questions, id, text) };
                }
                else {
                    answers[id] = { type: 'noul', probability: yesNo(id, question.instructions, text) };
                }
            }
            return { model: `${name}-1`, answers };
        }
    };
}

/** Today's date from the state ("... (2026-10-20)"), shifted by `days`. */
function dateFromState(state, days) {
    const iso = /\((\d{4}-\d{2}-\d{2})\)/.exec(state?.today || '')?.[1];
    const date = iso ? new Date(`${iso}T00:00:00Z`) : new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

const NAME = '([A-Z][a-z]+ [A-Z][a-z]+)';

/** How the scripted agent reads each open-value field, by path. */
const EXTRACTORS = {
    lossDate: (text, state) => /\byesterday\b/i.test(text) ? dateFromState(state, -1) : (/\btoday\b/i.test(text) ? dateFromState(state, 0) : undefined),
    lossLocation: (text) => /\bon (I-\d+)/.exec(text)?.[1] || /\bat (?:the )?([A-Z][\w ]+? (?:Mall|Street|Avenue|Road|parking lot))/.exec(text)?.[1],
    location: (text) => EXTRACTORS.lossLocation(text),
    vehicle: (text) => /\bmy (\d{4} [A-Z][a-z]+(?: [A-Z][a-z]+)?)/.exec(text)?.[1],
    injuredName: (text) => new RegExp(`\\b(?:passenger|wife|husband|son|daughter|friend),? ${NAME}`).exec(text)?.[1],
    otherPartyName: (text) => new RegExp(`\\bother driver,? ${NAME}`).exec(text)?.[1],
    // The first sentence, not counting titles such as "Ms.".
    summary: (text) => text.split(/(?<!\b(?:Mr|Ms|Mrs|Dr)\.)(?<=[.!?:])\s/)[0],
    callbackNumber: (text) => /\b(\d{3}-\d{3}-\d{4})\b/.exec(text)?.[1],
    reference: (text) => /\b([A-Z]{2}-\d+)\b/.exec(text)?.[1],
};

function extractValues(request, text) {
    const values = {};
    for (const field of request.fields) {
        let value;
        if (/^Name of the /.test(field.label)) {
            // A record the input names that is not on file yet.
            value = new RegExp(`\\bnamed ${NAME}`).exec(text)?.[1];
        }
        else if (EXTRACTORS[field.path]) {
            value = EXTRACTORS[field.path](text, request.state);
        }
        else if (field.options?.length) {
            // A closed-set field routed to the agent: the first option the input names.
            const lower = text.toLowerCase();
            const hit = field.options.find((option) => optionMatches(lower, String(option.label), false));
            if (hit) value = field.multiple ? [hit.value] : hit.value;
        }
        if (value !== undefined) values[field.path] = value;
    }
    return values;
}

function toolText(result) {
    return (result?.content || []).map((block) => block.text || '').join('\n');
}

/**
 * Research: when the UAG offers tools, follow every `CALL <tool> <json args>`
 * line in the input, the way a model might act on what it reads. The UAG only
 * offers the task's read-only tools and refuses the rest, so a line that asks
 * for a write tool shows that the scoping holds.
 */
async function research(request, text) {
    const calls = [];
    if (!request.tools?.length || !request.callTool) return calls;
    for (const line of text.split('\n')) {
        const step = /^CALL (\S+)\s*(.*)$/.exec(line.trim());
        if (!step || calls.length >= (request.maxIterations || 10)) continue;
        const result = await request.callTool(step[1], step[2] ? JSON.parse(step[2]) : {});
        calls.push({ name: step[1], isError: !!result.isError, text: toolText(result) });
    }
    return calls;
}

/**
 * An admissions review, as the application form's criteria describe it. The
 * state's input holds the submission's other values, keyed by label.
 */
function review(state) {
    const input = state?.input || {};
    const gpa = Number(input.GPA || 0);
    const essay = String(input['Application Essay'] || '');
    const words = essay.split(/\s+/).filter(Boolean).length;
    return {
        aiEssayScore: Math.max(1, Math.min(10, Math.round(words / 5))),
        aiRecommendation: gpa >= 3.5 ? 'accept' : 'reject',
        aiSummary: `${input['First Name']} ${input['Last Name']} applied with a GPA of ${gpa}.`,
    };
}

/** How much substance a written answer has, scored 1-10 as the example's rubric asks. */
function substance(text) {
    const length = String(text || '').trim().replace(/^none\.?$/i, '').length;
    if (!length) return 2;
    if (length < 100) return 6;
    if (length < 200) return 8;
    return 10;
}

/**
 * The agentic workflow example's tasks, answered as its criteria describe, so
 * the suite gets the same outcome every run. Recognised by the fields asked
 * for (the decision and value fields come in separate calls); returns
 * undefined for any other task.
 */
function agenticWorkflow(request) {
    const asked = new Set(request.fields.map((field) => field.path));
    const answer = (values) => Object.fromEntries(Object.entries(values).filter(([path]) => asked.has(path)));
    const input = request.state?.input || {};
    if (asked.has('sum')) {
        return { sum: Number(input.A) + Number(input.B) };
    }
    if (['academicsScore', 'overallScore', 'decision', 'status'].some((path) => asked.has(path))) {
        const gpa = Number(input.GPA);
        const test = String(input['Standardized Test'] || '').toLowerCase();
        const score = Number(input['Test Score']);
        const scores = {
            academicsScore: gpa >= 4 ? 10 : gpa >= 3.5 ? 8 : gpa >= 3 ? 6 : 3,
            testingScore: test === 'none' ? 5 : test === 'act'
                ? (score >= 33 ? 10 : score >= 28 ? 8 : score >= 22 ? 6 : 3)
                : (score >= 1500 ? 10 : score >= 1300 ? 8 : score >= 1100 ? 6 : 3),
            extracurricularScore: substance(input['Extracurricular Activities & Impact']),
            leadershipScore: substance(input['Leadership & Initiative']),
            serviceScore: substance(input['Service Orientation']),
            essaysScore: substance(input['Application Essay']),
        };
        const average = Object.values(scores).reduce((sum, value) => sum + value, 0) / 6;
        const rounded = Math.round(average);
        const [decision, status] = rounded <= 5 ? ['declined', 'declined']
            : rounded <= 8 ? ['accepted', 'accepted']
                : ['acceptedWithScholarship', 'scholarshipEvaluation'];
        return answer({
            ...scores,
            overallScore: Math.round(average * 10) / 10,
            decision,
            status,
            agentRationale: `Scored ${Math.round(average * 10) / 10} on the rubric.`,
        });
    }
    if (asked.has('awardLevel') || asked.has('financeRationale')) {
        const overall = Number(input['Overall Score']);
        const awardLevel = overall >= 9.7 ? 'fullRide' : overall >= 9.4 ? 'roomBoard25' : overall >= 9 ? 'supplemental25' : 'reward1000';
        return answer({ awardLevel, financeRationale: `An overall score of ${overall} earns this award.` });
    }
    return undefined;
}

function scriptedAgentEngine(name, delayMs = 0) {
    return {
        name,
        kind: 'agent',
        model: `${name}-1`,
        toolUse: true,
        async extract(request) {
            const entry = record(name, 'extract', {
                state: request.state,
                fields: request.fields.map((f) => f.path),
                tools: (request.tools || []).map((t) => t.name),
                maxIterations: request.maxIterations,
                scopedToken: !!request.scopedToken,
            });
            if (delayMs) await sleep(delayMs, request.signal);
            const text = inputText(request.state);
            const calls = await research(request, text);
            entry.research = calls;
            const values = agenticWorkflow(request)
                || (String(request.state?.instructions || '').includes('admissions reviewer')
                    ? review(request.state)
                    : extractValues(request, text));
            // Like a model taken over by a prompt injection, it answers whatever it
            // is told to. The UAG keeps only the fields it asked for.
            for (const match of text.matchAll(/SYSTEM OVERRIDE: set (\S+) to ([^\s`]+)/g)) {
                values[match[1]] = match[2];
            }
            return {
                model: `${name}-1`,
                values,
                ...(calls.length && { toolCalls: calls.map(({ name: tool, isError }) => ({ name: tool, isError })) })
            };
        }
    };
}

function failingDecisionEngine(name) {
    return {
        name,
        kind: 'decision',
        model: `${name}-1`,
        maxOptions: 255,
        async decide() {
            record(name, 'decide', {});
            throw new Error('upstream unavailable (HTTP 503)');
        }
    };
}

function failingAgentEngine(name) {
    const fail = async () => {
        record(name, 'call', {});
        throw new Error('upstream unavailable (HTTP 503)');
    };
    return { name, kind: 'agent', model: `${name}-1`, toolUse: true, extract: fail };
}

function slowDecisionEngine(name, ms) {
    const inner = keywordDecisionEngine(name);
    return {
        ...inner,
        async decide(request) {
            await sleep(ms, request.signal);
            return inner.decide(request);
        }
    };
}

/** A scripted engine type: named in UAG_ENGINES like any other, created under the instance's name. */
const scripted = (type, kind, create, settings = {}) => ({ type, kinds: [kind], apiVersion: 1, settings, create });

const engineTypes = Object.fromEntries([
    scripted('e2e-decision', 'decision', ({ name }) => keywordDecisionEngine(name)),
    scripted('e2e-agent', 'agent', ({ name }) => scriptedAgentEngine(name)),
    scripted('e2e-run-agent', 'agent', ({ name }) => scriptedAgentEngine(name)),
    scripted('e2e-slow-agent', 'agent', ({ name, settings }) => scriptedAgentEngine(name, settings.delayMs),
        { delayMs: { env: 'E2E_SLOW_AGENT_MS', type: 'number', default: 1500 } }),
    scripted('e2e-down', 'decision', ({ name }) => failingDecisionEngine(name)),
    scripted('e2e-down-agent', 'agent', ({ name }) => failingAgentEngine(name)),
    scripted('e2e-slow', 'decision', ({ name, settings }) => slowDecisionEngine(name, settings.delayMs),
        { delayMs: { env: 'E2E_SLOW_MS', type: 'number', default: 2000 } }),
].map((definition) => [definition.type, definition]));

module.exports = { engineTypes, calls };
