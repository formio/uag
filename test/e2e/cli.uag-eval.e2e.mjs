import { expect } from 'chai';
import { execFile } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const cli = path.join(repoRoot, 'bin/uag-eval.js');

function run(args, env = {}) {
    return new Promise((resolve) => {
        execFile(process.execPath, ['--no-node-snapshot', cli, ...args], {
            cwd: repoRoot,
            env: { ...process.env, UAG_ENGINES: '', ...env },
        }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    });
}

/**
 * The uag-eval command, as someone tuning thresholds runs it: a form export and
 * a file of labeled examples in, a per-field report of automation and accuracy
 * out. Runs against the stub decision engine (no Form.io, no credentials), whose
 * answers are fixed, so the expected scores are known.
 */
describe('uag-eval command', function () {
    this.timeout(60000);

    let dir;

    before(function () {
        dir = mkdtempSync(path.join(os.tmpdir(), 'uag-eval-'));
        const fnol = JSON.parse(readFileSync(path.join(repoRoot, 'demo/module/project.json'), 'utf8'));
        writeFileSync(path.join(dir, 'claim.json'), JSON.stringify(fnol.forms.claim));
        // The stub picks the alphabetically first option ("Auto: collision") and affirms every yes/no.
        writeFileSync(path.join(dir, 'examples.json'), JSON.stringify([
            { id: 'rear-end', data: { lossDescription: 'I was rear-ended and hurt my neck.' }, expected: { 'triage.claimType': 'autoCollision', 'triage.injuryInvolved': true } },
            { id: 'theft', data: { lossDescription: 'My car was stolen. Nobody was hurt.' }, expected: { 'triage.claimType': 'theft', 'triage.injuryInvolved': false } },
        ]));
    });

    after(function () {
        rmSync(dir, { recursive: true, force: true });
    });

    it('reports automation and accuracy per field, and writes the JSON report', async function () {
        const report = path.join(dir, 'report.json');
        const { code, stdout } = await run(['--form', path.join(dir, 'claim.json'), '--examples', path.join(dir, 'examples.json'), '--task', 'triage', '--engine', 'stub-decision', '--json', report]);
        expect(code).to.equal(0);
        expect(stdout).to.include('Decision evaluation: form "claim", task "triage", stub-decision (stub-decision-1), 2 example(s)');
        expect(stdout).to.include('Claim type (triage.claimType, choice), 2 example(s)');

        const json = JSON.parse(readFileSync(report, 'utf8'));
        const claimType = json.fields.find((f) => f.path === 'triage.claimType');
        // Both examples are decided automatically; one of the two is right.
        expect(claimType.grid['0.5']).to.include({ automated: 2, correct: 1, accuracy: 0.5, deferred: 0 });
        const injury = json.fields.find((f) => f.path === 'triage.injuryInvolved');
        expect(injury.shape).to.equal('noul');
        // Only fields with expected values are evaluated.
        expect(json.fields.map((f) => f.path)).to.have.members(['triage.claimType', 'triage.injuryInvolved']);
    });

    it('refuses the 1.x --persona flag, saying it is now --task', async function () {
        const { code, stderr } = await run(['--form', path.join(dir, 'claim.json'), '--examples', path.join(dir, 'examples.json'), '--persona', 'triage', '--engine', 'stub-decision']);
        expect(code).to.equal(2);
        expect(stderr).to.include('--persona was renamed --task');
    });

    it('explains how to call it when arguments are missing', async function () {
        const { code, stderr } = await run([]);
        expect(code).to.equal(2);
        expect(stderr).to.include('Usage: uag-eval --form');
    });

    it('asks for an engine when none is named', async function () {
        const { code, stderr } = await run(['--form', path.join(dir, 'claim.json'), '--examples', path.join(dir, 'examples.json')]);
        expect(code).to.equal(2);
        expect(stderr).to.include('Name the decision engine');
    });

    it('names an engine it does not know, and the packages it looked for', async function () {
        const { code, stderr } = await run(['--form', path.join(dir, 'claim.json'), '--examples', path.join(dir, 'examples.json'), '--engine', 'nope']);
        expect(code).to.equal(1);
        expect(stderr).to.include('No engine type "nope" is installed').and.include('"@formio/uag-nope"');
    });

    it('evaluates an instance as the deployment configures it', async function () {
        const args = ['--form', path.join(dir, 'claim.json'), '--examples', path.join(dir, 'examples.json'), '--task', 'triage'];
        const env = { UAG_ENGINES: 'stub-agent,triage-check:stub-decision' };
        const named = await run([...args, '--engine', 'triage-check'], env);
        expect(named.code, named.stderr).to.equal(0);
        expect(named.stdout).to.include('task "triage", triage-check (stub-decision-1)');
        const entry = await run([...args, '--engine', 'other:stub-decision'], env);
        expect(entry.stdout).to.include('task "triage", other (stub-decision-1)');
        const first = await run(args, { UAG_ENGINES: 'triage-check:stub-decision,stub-agent' });
        expect(first.stdout).to.include('task "triage", triage-check (stub-decision-1)');
        const agent = await run([...args, '--engine', 'stub-agent'], env);
        expect(agent.code).to.equal(2);
        expect(agent.stderr).to.include('"stub-agent" is not a decision engine');
    });
});
