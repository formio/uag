import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The release check @formio/uag runs before it is published, against a small
 * checkout and a stand-in for npm.
 */
describe('The release check', function () {
    this.timeout(20000);
    let dir: string;

    const write = (file: string, content: string, mtime?: Date) => {
        const target = path.join(dir, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
        if (mtime) fs.utimesSync(target, mtime, mtime);
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-release-'));
        write('package.json', JSON.stringify({ name: '@formio/uag', version: '2.0.0', license: 'MIT', workspaces: ['packages/*'], dependencies: { '@formio/uag-sdk': '^2.0.0' } }));
        write('packages/engine-sdk/package.json', JSON.stringify({ name: '@formio/uag-sdk', version: '2.0.0', license: 'MIT' }));
        write('CHANGELOG.md', '# Changelog\n\n## 2.0.0\n\n- Proxy mode.\n\n## 1.14.0\n');
        write('src/index.ts', 'export {};\n', new Date(Date.now() - 60000));
        write('src/templates/agent.md', 'An agent.\n', new Date(Date.now() - 60000));
        write('lib/index.js', '"use strict";\n');
        write('lib/templates/agent.md', 'An agent.\n');
        // npm, as `npm view <name>@<range> version --json` answers.
        write('bin/npm', '#!/bin/sh\nif [ -n "$NPM_404" ]; then echo "npm error code E404" >&2; exit 1; fi\nprintf "%s" "$NPM_VERSIONS"\n');
        fs.chmodSync(path.join(dir, 'bin/npm'), 0o755);
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const check = (env: Record<string, string> = {}) => {
        const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/check-release.mjs')], {
            encoding: 'utf8',
            env: { ...process.env, UAG_RELEASE_ROOT: dir, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, NPM_VERSIONS: '"2.0.0"', ...env }
        });
        return { status: result.status, output: `${result.stdout}${result.stderr}` };
    };

    it('passes a release whose version, dependencies and build are ready', () => {
        const result = check();
        expect(result.status, result.output).to.equal(0);
        expect(result.output).to.contain('release check passed');
    });

    it('refuses a version that is not the changelog\'s newest', () => {
        write('package.json', JSON.stringify({ name: '@formio/uag', version: '1.14.0', license: 'MIT', workspaces: ['packages/*'], dependencies: { '@formio/uag-sdk': '^2.0.0' } }));
        const result = check();
        expect(result.status).to.equal(1);
        expect(result.output).to.contain('is version 1.14.0, but CHANGELOG.md\'s newest entry is 2.0.0');
    });

    it('refuses a dependency from this repository that is not on npm yet', () => {
        for (const env of [{ NPM_404: '1' }, { NPM_VERSIONS: '' }] as Record<string, string>[]) {
            const result = check(env);
            expect(result.status, JSON.stringify(env)).to.equal(1);
            expect(result.output).to.contain('@formio/uag-sdk@^2.0.0 is not published on npm. Publish @formio/uag-sdk first.');
        }
    });

    it('refuses a package of this repository out of step with @formio/uag\'s version', () => {
        write('packages/engine-sdk/package.json', JSON.stringify({ name: '@formio/uag-sdk', version: '2.0.1', license: 'MIT' }));
        const result = check();
        expect(result.status).to.equal(1);
        expect(result.output).to.contain('@formio/uag-sdk is version 2.0.1, not 2.0.0. Run `yarn release:version 2.0.0`.');
    });

    describe('a prerelease', () => {
        const release = (version: string, range: string) => {
            write('package.json', JSON.stringify({ name: '@formio/uag', version, license: 'MIT', workspaces: ['packages/*'], dependencies: { '@formio/uag-sdk': range } }));
            write('packages/engine-sdk/package.json', JSON.stringify({ name: '@formio/uag-sdk', version, license: 'MIT' }));
            write('CHANGELOG.md', `# Changelog\n\n## ${version}\n\n- Proxy mode.\n`);
            return check({ NPM_VERSIONS: `"${version}"` });
        };

        it('passes with a range that names the prerelease', () => {
            const result = release('2.0.0-rc.1', '^2.0.0-rc.1');
            expect(result.status, result.output).to.equal(0);
        });

        it('refuses a release range, which npm never resolves to a prerelease', () => {
            const result = release('2.0.0-rc.1', '^2.0.0');
            expect(result.status).to.equal(1);
            expect(result.output).to.contain('depends on @formio/uag-sdk "^2.0.0", which does not accept 2.0.0-rc.1');
        });

        it('refuses a range for a later prerelease', () => {
            const result = release('2.0.0-rc.1', '^2.0.0-rc.2');
            expect(result.status).to.equal(1);
            expect(result.output).to.contain('which does not accept 2.0.0-rc.1');
        });
    });

    it('sets one version on every package, its dependencies on each other and server.json', () => {
        write('packages/engine-server/package.json', `${JSON.stringify({ name: '@formio/uag-engines', version: '2.0.0', license: 'MIT', dependencies: { '@formio/uag-sdk': '^2.0.0', express: '^5.0.0' } }, null, 2)}\n`);
        write('server.json', JSON.stringify({ name: 'io.form/uag', version: '2.0.0', packages: [{ identifier: '@formio/uag', version: '2.0.0' }] }));
        const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/set-version.mjs'), '2.0.0-rc.2'], {
            encoding: 'utf8',
            env: { ...process.env, UAG_RELEASE_ROOT: dir }
        });
        expect(result.status, result.stderr).to.equal(0);
        const read = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        expect(read('package.json')).to.deep.include({ version: '2.0.0-rc.2', dependencies: { '@formio/uag-sdk': '^2.0.0-rc.2' } });
        expect(read('packages/engine-sdk/package.json').version).to.equal('2.0.0-rc.2');
        expect(read('packages/engine-server/package.json').dependencies).to.deep.equal({ '@formio/uag-sdk': '^2.0.0-rc.2', express: '^5.0.0' });
        expect(read('server.json')).to.deep.include({ version: '2.0.0-rc.2', packages: [{ identifier: '@formio/uag', version: '2.0.0-rc.2' }] });
        // Formatted as npm writes package.json.
        expect(fs.readFileSync(path.join(dir, 'packages/engine-server/package.json'), 'utf8')).to.match(/^\{\n {2}"name"[\s\S]*\}\n$/);
        expect(spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/set-version.mjs'), 'next'], { env: { ...process.env, UAG_RELEASE_ROOT: dir } }).status).to.equal(1);
    });

    it('refuses lib/ built before a change to src/, or missing a file', () => {
        write('src/index.ts', 'export const changed = true;\n', new Date(Date.now() + 60000));
        let result = check();
        expect(result.status).to.equal(1);
        expect(result.output).to.contain('lib/ is not built from the current src/ (src/index.ts)');
        write('lib/index.js', '"use strict";\n', new Date(Date.now() + 120000));
        write('src/runner.ts', 'export {};\n', new Date(Date.now() - 60000));
        result = check();
        expect(result.output).to.contain('(src/runner.ts)');
    });
});
