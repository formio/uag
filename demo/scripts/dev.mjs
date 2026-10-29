#!/usr/bin/env node
/**
 * Runs the demo site locally: Form.io Open Source and MongoDB
 * in Docker, the UAG from this checkout's lib/ (run `yarn build` first), the
 * engine server with the scripted e2e engines, the flow proxy, and the site, as
 * the e2e suites run it (test/e2e/helpers/demoStack.mjs).
 *
 *   yarn demo:dev                       # http://127.0.0.1:3420
 *
 * The scripted engines answer the workflow and the claims wizard from keywords,
 * instantly and for free. Those two demos are Agentic Formflow, so they need a
 * license that includes the UAG, LICENSE_KEY (or E2E_UAG_LICENSE); without it
 * the examples say a license is needed to run them locally, as they would
 * against any Open Source server. The chat (conversation forms, the UAG's
 * agent/chat) needs no license, and is answered by the scripted agent engine,
 * which reads `Label: value` pairs.
 * Pages and docs are re-read on every request (DEMO_RELOAD), so edits show on
 * reload. Ctrl+C stops everything and removes the containers.
 */
import 'dotenv/config';

// The UAG inherits LICENSE_KEY. The e2e helpers pass E2E_UAG_LICENSE, read when
// they load, as UAG_LICENSE; a UAG_LICENSE set here (deprecated) still works.
process.env.E2E_UAG_LICENSE ||= process.env.UAG_LICENSE || '';
const licensed = process.env.LICENSE_KEY || process.env.E2E_UAG_LICENSE;
const { startDemoStack, SITE_URL } = await import('../../test/e2e/helpers/demoStack.mjs');

const siteEnv = { DEMO_RELOAD: '1' };

console.log('Starting Form.io, the UAG, the engine server, the flow proxy and the site (about a minute) ...');
const stack = await startDemoStack({ siteEnv });
console.log(`\nThe demo site is running at ${SITE_URL}`);
console.log('The chat is answered by the scripted agent engine: try "Full Name: Ada Lovelace; Category: Billing".');
console.log(licensed ? 'The workflow and formflow demos run under your license.' : 'Set LICENSE_KEY to run the workflow and formflow demos locally (Agentic Formflow needs a license that includes the UAG).');
console.log('Press Ctrl+C to stop.\n');

let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping ...');
    await stack.stop().catch((err) => console.error(err.message));
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Keep running until stopped.
setInterval(() => {}, 1 << 30);
