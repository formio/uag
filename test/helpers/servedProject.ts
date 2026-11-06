import { ProjectInterface } from '@formio/appserver';
import { UAGServer } from '../../src';
import { FakeFormio } from './fakeFormio';

/**
 * A project a UAG serves: a stand-in Form.io project at `host` (`localhost`,
 * or `127.0.0.1` for any other host), loaded by a UAG router with no license
 * and no database of its own.
 */
export async function servedProject(host: 'localhost' | '127.0.0.1' = 'localhost') {
    const formio = new FakeFormio({ roles: { anonymous: { title: 'Anonymous', admin: false, default: true } }, forms: {} });
    await formio.start();
    const saved: Record<string, string | undefined> = {};
    for (const name of ['MONGO', 'UAG_DATABASE', 'LICENSE_KEY', 'UAG_LICENSE', 'MCP_OAUTH', 'PROJECT_KEY']) {
        saved[name] = process.env[name];
        delete process.env[name];
    }
    const module = ProjectInterface.module;
    try {
        const server = new UAGServer({ project: formio.endpoint.replace('127.0.0.1', host), ttl: 0, retries: 1, license: '', auth: { adminKey: 'admin-key', secret: 'served-secret' } } as any);
        await server.initialize();
        await server.router();
        const project = server.uagProject!;
        return {
            project,
            async stop() {
                (project as any)?.destroy?.();
                await formio.stop();
            }
        };
    }
    finally {
        ProjectInterface.module = module;
        for (const [name, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}
