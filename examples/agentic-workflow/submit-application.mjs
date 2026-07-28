#!/usr/bin/env node
/**
 * Submits an example college application and follows the agentic workflow until
 * it settles.
 *
 * Usage: ./submit-application.mjs [weak|average|strong]
 *
 *   weak     — should be declined by the admissions agent
 *   average  — should be accepted with no scholarship
 *   strong   — should be accepted with a scholarship, which then triggers the
 *              second (finance) agent to pick an award level
 *
 * No dependencies — plain Node.js.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '.env');

const SERVER = process.env.SERVER || 'http://localhost:3000/agentic-workflow';
const PROFILE = process.argv[2] || 'average';

/** The six scores the admissions agent fills in. */
const SCORE_FIELDS = [
    'academicsScore', 'testingScore', 'extracurricularScore',
    'leadershipScore', 'serviceScore', 'essaysScore',
];

/** Statuses that mean the workflow is finished. */
const SETTLED = ['declined', 'accepted', 'scholarshipGranted'];

/**
 * Applicant profiles calibrated to land in each band of the rubric that is
 * embedded in the form's criteria component.
 */
const PROFILES = {
    weak: {
        firstName: 'Dylan',
        lastName: 'Barrett',
        email: 'dylan.barrett@example.com',
        dateOfBirth: '2008-09-02',
        phone: '(512) 555-0163',
        address: '884 Rundberg Court, Austin, TX 78753',
        highSchool: 'North Ridge High School',
        gpa: 2.1,
        testType: 'sat',
        testScore: 880,
        extracurriculars: 'None.',
        leadership: '',
        service: '',
        essay: 'I want to go to college because my parents said I have to pick somewhere. I think it will probably be fine.',
    },
    average: {
        firstName: 'Priya',
        lastName: 'Raman',
        email: 'priya.raman@example.com',
        dateOfBirth: '2008-04-19',
        phone: '(512) 555-0148',
        address: '2117 Larkspur Lane, Austin, TX 78704',
        highSchool: 'Travis Heights High School',
        gpa: 3.35,
        testType: 'sat',
        testScore: 1240,
        extracurriculars: 'Varsity soccer for three years, layout editor for the school newspaper, member of Spanish club.',
        leadership: 'Soccer team co-captain senior year. Ran warmups and helped onboard freshman players.',
        service: 'Roughly 40 hours over two years at the Austin Community Food Bank, sorting donations on weekends.',
        essay: 'A folding table in a food bank warehouse taught me more than I expected about steady work. Nothing about it was dramatic. We opened boxes, checked expiration dates, and stacked pallets, and the line of families outside was the same length whether or not I had shown up. What I learned is that I am good at showing up. Soccer taught me the same lesson from another angle: I was never the fastest player on the field, but I was the one my coach trusted to run warmups when he was late, because he knew I would be there. I want to study public health because it sits where those two habits meet, in unglamorous repeated effort that adds up to something a community can feel.',
    },
    strong: {
        firstName: 'Amara',
        lastName: 'Okonkwo',
        email: 'amara.okonkwo@example.com',
        dateOfBirth: '2008-01-27',
        phone: '(512) 555-0111',
        address: '5401 Bull Creek Road, Austin, TX 78756',
        highSchool: 'Westlake Academy',
        gpa: 4.0,
        testType: 'sat',
        testScore: 1590,
        extracurriculars: 'Founded and led a student research group that published two papers on municipal water quality with a professor at the state university. First chair violin in the regional youth symphony for three years. Captain of the state champion policy debate team.',
        leadership: 'Founded the water quality research group in sophomore year and grew it to fourteen students across three schools, securing lab access and a small grant. Elected student body president senior year, where I rewrote the club funding process so smaller clubs could compete for money.',
        service: 'Built and still maintain a free tutoring program that pairs high school students with elementary students in Title I schools. Over 400 volunteer hours across four years, and the program now runs in five schools.',
        essay: 'The first water sample I collected was a mistake. I filled the bottle from the middle of the creek, capped it, and drove it forty minutes to the lab, where I learned that the sampling protocol I had skimmed required a sterile technique I had ignored entirely. The result was meaningless. I remember sitting in the parking lot genuinely embarrassed, and then genuinely curious, because the protocol existed for reasons I had not bothered to understand. That is the pattern I keep returning to: my first instinct is usually wrong in an interesting way. Over the next two years our group collected 1,400 samples along eleven miles of creek, and we found something the city had not been tracking, which was a seasonal spike in bacterial counts downstream of a stormwater outflow. Getting that finding taken seriously taught me more than the chemistry did. I had to learn to write for an audience of engineers who had no reason to trust a sixteen year old, to present without overclaiming, and to accept revisions that made the paper duller and more accurate. I want to study environmental engineering because the work sits exactly at that intersection of careful measurement and public argument. Neither one is enough by itself. A number nobody trusts changes nothing, and a story with no number behind it should not change anything.',
    },
};

function fail(message) {
    console.error(message);
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The project API key created by setup.mjs. */
function projectKey() {
    if (process.env.PROJECT_KEY) {
        return process.env.PROJECT_KEY;
    }
    if (existsSync(envPath)) {
        const match = readFileSync(envPath, 'utf8').match(/^PROJECT_KEY=(.+)$/m);
        if (match) {
            return match[1].trim();
        }
    }
    return fail('No PROJECT_KEY found. Run ./setup.mjs first.');
}

/** Prints one line of workflow state, plus scores and rationales once present. */
function report(data) {
    const value = (key) => data[key] ?? '-';
    console.log(
        `  status=${String(value('status')).padEnd(22)}` +
        `decision=${String(value('decision')).padEnd(24)}` +
        `overall=${String(value('overallScore')).padEnd(5)}` +
        `award=${value('awardLevel')}`
    );
    if (SCORE_FIELDS.every((field) => data[field] !== undefined)) {
        console.log('  scores: ' + SCORE_FIELDS.map((f) => `${f.replace('Score', '')}=${data[f]}`).join(' '));
    }
    for (const [field, label] of [['agentRationale', 'admissions'], ['financeRationale', 'finance']]) {
        if (data[field]) {
            console.log(`  ${label} rationale: ${data[field]}`);
        }
    }
}

const key = projectKey();
const profile = PROFILES[PROFILE];
if (!profile) {
    fail(`usage: ./submit-application.mjs [${Object.keys(PROFILES).join('|')}]`);
}

console.log(`Submitting the '${PROFILE}' application to ${SERVER} ...`);
const created = await fetch(`${SERVER}/application/submission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-token': key },
    body: JSON.stringify({ data: { ...profile, status: 'submitted' } }),
});
if (!created.ok) {
    fail(`Submitting failed (${created.status}): ${await created.text()}`);
}
const { _id: submissionId } = await created.json();

console.log(`Created submission ${submissionId}. Waiting for the agents (this usually takes 15-60s).\n`);

for (let attempt = 1; attempt <= 24; attempt++) {
    await sleep(5000);
    const response = await fetch(`${SERVER}/application/submission/${submissionId}`, {
        headers: { 'x-token': key },
    });
    if (!response.ok) {
        fail(`Reading the submission failed (${response.status}).`);
    }
    const { data } = await response.json();
    report(data);
    if (SETTLED.includes(data.status)) {
        break;
    }
    console.log(`  ... still working (attempt ${attempt})`);
}

console.log(`
Done. Full submission:
  curl -s ${SERVER}/application/submission/${submissionId} -H "x-token: $PROJECT_KEY"
`);
