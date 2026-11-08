import { expect } from 'chai';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * unpdf is an ES module. The UAG is compiled to CommonJS and supports Node 22.0,
 * which cannot require() an ES module (that came in 22.12), so pdf-text must
 * load it with a real import(). This compiles converters.ts as the build does
 * and runs it with require(esm) turned off; tsx, which runs the other tests,
 * would load the ES module either way.
 */
describe('Documents: pdf-text without require(esm)', function () {
    this.timeout(30000);

    it('reads a PDF when Node cannot require() an ES module', () => {
        const root = path.join(__dirname, '..', '..');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uag-esm-'));
        try {
            // Compiled as the build compiles it: CommonJS, with the files it imports.
            execFileSync(path.join(root, 'node_modules', '.bin', 'tsc'), [
                '--ignoreConfig', path.join(root, 'src', 'documents', 'converters.ts'), '--outDir', path.join(dir, 'lib'), '--rootDir', path.join(root, 'src'),
                '--module', 'commonjs', '--target', 'es2020', '--esModuleInterop', '--skipLibCheck', '--types', 'node'
            ], { cwd: root, encoding: 'utf8' });
            // lib/version.js reads the version from ../package.json, as in the published package.
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.0.0' }));
            // Packages resolve from the build, as from an installed UAG (import() never reads NODE_PATH).
            fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
            const script = `
                const { pdfTextConverter } = require(${JSON.stringify(path.join(dir, 'lib', 'documents', 'converters.js'))});
                const { PDFDocument, StandardFonts } = require(${JSON.stringify(path.join(root, 'node_modules', 'pdf-lib'))});
                (async () => {
                    const doc = await PDFDocument.create();
                    doc.addPage().drawText('Hello', { font: await doc.embedFont(StandardFonts.Helvetica) });
                    const out = await pdfTextConverter.convert({ buffer: Buffer.from(await doc.save()), type: 'application/pdf', name: 'a.pdf' }, { signal: new AbortController().signal });
                    process.stdout.write(out.text);
                })().catch((err) => { process.stdout.write('ERR ' + (err.code || err.message)); });`;
            const output = execFileSync(process.execPath, ['--no-experimental-require-module', '-e', script], { cwd: dir, encoding: 'utf8' });
            expect(output).to.equal('Hello');
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
