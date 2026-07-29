import { assert } from 'chai';
import { UAGServer } from '../src/index';

describe('UAGServer.router', () => {
  // Running the image with no PROJECT — or with an unreachable one — used to
  // crash with "Cannot read properties of undefined (reading 'uagRouter')",
  // which says nothing about what the operator got wrong.
  it('reports missing project configuration instead of a TypeError', async () => {
    const server = new UAGServer();
    // No project could be loaded, which is the state a misconfigured container
    // is in by the time router() runs.
    (server as unknown as { projectRouter?: { projects: Record<string, unknown> } }).projectRouter =
      { projects: {} };

    let message = '';
    try {
      await server.router();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    assert.notInclude(
      message,
      'uagRouter',
      'should not surface the internal TypeError to the operator'
    );
    assert.match(
      message,
      /PROJECT/,
      'should name the environment variable that needs to be set'
    );
  });
});
