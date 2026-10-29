#!/usr/bin/env node
/**
 * Records the demo GIFs. See README.md in this folder for the storyboards.
 *
 *   yarn demo:record                     # conversation, workflow and formflow
 *   yarn demo:record formflow            # one of them
 *
 * Conversation forms record on the e2e Open Source stack; the workflow and
 * formflow recordings show the Enterprise portal, so they record on the demo
 * self-hosted on Form.io Enterprise (enterprise.mjs). Each stack runs real
 * engines (JEV and Claude, from the root .env) and is started and stopped here,
 * unless the RECORD_* variables in README.md name running ones. Writes
 * demo/public/images/demo-<name>.gif.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Director } from './director.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.resolve(here, '../public/images');
const SCENES = ['conversation', 'workflow', 'formflow'];

const names = process.argv.slice(2);
for (const name of names) {
    if (!SCENES.includes(name)) {
        console.error(`Unknown recording "${name}". Choose from: ${SCENES.join(', ')}.`);
        process.exit(1);
    }
}

// Conversation forms run on Form.io Open Source; the other two show the
// Enterprise portal, so they run on the demo's self-hosted Enterprise stack.
const OPEN_SOURCE = ['conversation'];
const selected = names.length ? names : SCENES;

function requireEnv(keys) {
    const missing = keys.filter((key) => !process.env[key]);
    if (missing.length) {
        console.error(`Set ${missing.join(', ')} in the root .env: the recordings use real engines and licenses.`);
        process.exit(1);
    }
}

/** Start (or reuse) the stack a recording runs on: { site, portal, email, password, stop }. */
async function openSource() {
    if (process.env.RECORD_SITE_URL) {
        return { site: process.env.RECORD_SITE_URL, portal: process.env.RECORD_PORTAL_URL || 'http://127.0.0.1:3101', stop: async () => {} };
    }
    requireEnv(['TYPESAFE_API_KEY', 'CLAUDE_API_KEY']);
    const { startDemoStack, SITE_URL } = await import('../../test/e2e/helpers/demoStack.mjs');
    const { FORMIO_URL } = await import('../../test/e2e/helpers/stack.mjs');
    console.log('Starting the Open Source demo stack with JEV and Claude (about a minute) ...');
    const stack = await startDemoStack({
        // Claude answers the chat (the UAG's agent/chat) and fills in values on the engine server.
        realEngines: { decision: 'jev', agent: 'claude' },
    });
    return { site: SITE_URL, portal: FORMIO_URL, stop: () => stack.stop() };
}

async function enterprise() {
    if (process.env.RECORD_ENTERPRISE_SITE_URL) {
        return {
            site: process.env.RECORD_ENTERPRISE_SITE_URL,
            portal: process.env.RECORD_ENTERPRISE_PORTAL_URL,
            email: process.env.RECORD_ENTERPRISE_EMAIL,
            password: process.env.RECORD_ENTERPRISE_PASSWORD,
            uagStage: process.env.RECORD_ENTERPRISE_STAGE,
            stop: async () => {},
        };
    }
    const { startEnterpriseDemo, enterpriseMissing } = await import('./enterprise.mjs');
    requireEnv(enterpriseMissing());
    console.log('Starting the self-hosted Enterprise demo stack (several minutes: it builds the UAG image) ...');
    return startEnterpriseDemo();
}

const browser = await chromium.launch();
let failed = false;
try {
    for (const [group, start] of [[selected.filter((n) => OPEN_SOURCE.includes(n)), openSource], [selected.filter((n) => !OPEN_SOURCE.includes(n)), enterprise]]) {
        if (!group.length) continue;
        const env = await start();
        try {
            for (const name of group) {
                const dir = path.join(os.tmpdir(), 'uag-recordings', name);
                const out = path.join(images, `demo-${name}.gif`);
                console.log(`Recording ${name} ...`);
                const scene = (await import(`./scenes/${name}.mjs`)).default;
                const director = await Director.open(browser, { dir });
                try {
                    await scene(director, env);
                }
                catch (error) {
                    failed = true;
                    await director.page.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
                    console.error(`  ${name} failed: ${error.message}\n  The page at the failure: ${path.join(dir, 'failure.png')}`);
                    continue;
                }
                finally {
                    await director.close();
                }
                const encoded = spawnSync('python3', [path.join(here, 'encode.py'), dir, out], { stdio: 'inherit' });
                if (encoded.status !== 0) failed = true;
            }
        }
        finally {
            await env.stop().catch((error) => console.error(error.message));
        }
    }
}
finally {
    await browser.close();
}
process.exit(failed ? 1 : 0);
