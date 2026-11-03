import fs from 'fs';
import path from 'path';
import { expect } from 'chai';

/**
 * Pinning (characterization) fixtures.
 *
 * A pinning test records observable behavior at a public boundary as JSON and
 * fails when it changes. Fixtures are written only when UPDATE_FIXTURES=1 is
 * set, so a behavior change always shows up as a fixture diff someone made on
 * purpose. Without the flag, a missing fixture fails the test.
 */
const FIXTURES = path.join(__dirname, 'fixtures');

export function matchesFixture(name: string, actual: any) {
    const file = path.join(FIXTURES, `${name}.json`);
    // Round-trip through JSON so the comparison sees exactly what a client receives.
    const value = JSON.parse(JSON.stringify(actual));
    if (process.env.UPDATE_FIXTURES === '1') {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
        return;
    }
    if (!fs.existsSync(file)) {
        throw new Error(`Missing pinning fixture ${path.relative(process.cwd(), file)}. Run with UPDATE_FIXTURES=1 to record it on purpose.`);
    }
    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(value, `pinning fixture ${name} changed; if this is on purpose, rerun with UPDATE_FIXTURES=1 and note it in CHANGELOG.md`).to.deep.equal(expected);
}

/** Replace package versions, which change with every release, with a placeholder. */
export function withoutVersions(value: any): any {
    return JSON.parse(JSON.stringify(value), (key, item) => (key === 'version' && typeof item === 'string') ? '<version>' : item);
}
