import { expect } from 'chai';
import express from 'express';
import path from 'path';
import vm from 'vm';
import type { AddressInfo } from 'net';
import { uagJsRouter } from '../../src/documents/uagJs';

const fixture = (...parts: string[]) => path.join(__dirname, '..', ...parts);

describe('Documents: module components in the served bundle', () => {
    it('leaves out a component script that does not parse, so the bundle and the other components still load', async () => {
        const app = express();
        app.use(uagJsRouter(() => undefined, () => [
            { module: 'broken', type: 'esmcomp', scriptPath: fixture('documents', 'fixtures', 'esm-component.js') } as any,
            { module: 'sample', type: 'sample', scriptPath: fixture('modules', 'fixtures', 'sample-component.js') } as any
        ]));
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        try {
            const body = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/uag-js/uag.use.js`, { headers: { connection: 'close' } })).text();
            expect(body).to.not.include('export default class Broken');
            expect(body).to.include('The esmcomp component of the broken module is not a browser script');
            expect(body).to.include(require('fs').readFileSync(fixture('modules', 'fixtures', 'sample-component.js'), 'utf8').trim());
            // The whole bundle parses as a classic script.
            expect(() => new vm.Script(body)).to.not.throw();
        }
        finally {
            server.close();
        }
    });
});
