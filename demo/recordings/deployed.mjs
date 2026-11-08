/**
 * The demo on a Form.io Enterprise deployment that is already running, such as
 * a local https://form.test, in place of the throwaway stack enterprise.mjs
 * starts: for the recordings that show the portal, and for checking the demo on
 * a real deployment.
 *
 * Set in the root .env:
 *
 *   FORMIO_TEST_URL                  the deployment, with its portal (https://form.test)
 *   FORMIO_TEST_EMAIL                a portal account that may create projects and stages
 *   FORMIO_TEST_PASSWORD             its password
 *   FORMIO_TEST_UAG_LICENSE          a license with the UAG that allows the deployment's subdomains (`*.form.test`)
 *   FORMIO_TEST_UAG_LICENSE_REMOTE   true when that license is an offline one
 *   FORMIO_TEST_PROJECT              the project's name (uag-demo-recordings)
 *
 * A start creates the project from module/project.json, owned by that account,
 * runs the UAG in Docker on it (built from this tree, with JEV and Claude
 * inside it), serves the site built for both, and connects a portal stage to
 * the UAG; stop() deletes the project and its stages. A project of that name
 * the account owns, left by a run that did not finish, is deleted first.
 *
 * The UAG container reaches the deployment over plain HTTP, by the address this
 * machine resolves its host to, so it needs no certificate authority of the
 * deployment's (see uagReach); this process and the browser use HTTPS, trusting
 * the certificate authorities of the operating system.
 */
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { IMAGE, buildLocalImage, exampleStack, repoRoot, waitUntil } from '../../test/e2e/helpers/exampleStack.mjs';
import { serveSite } from '../scripts/serve.mjs';
import { demoTemplate } from '../scripts/setup.mjs';
import { SITE, UAG, connectUagStage, originsOf } from './enterprise.mjs';

export const DEFAULT_PROJECT = 'uag-demo-recordings';
export const PROJECT_TITLE = 'UAG Demo';

/** The deployment's settings, from `settings` (the root .env). */
export function deployedSettings(settings = process.env) {
    return {
        url: (settings.FORMIO_TEST_URL || '').replace(/\/+$/, ''),
        email: settings.FORMIO_TEST_EMAIL || '',
        password: settings.FORMIO_TEST_PASSWORD || '',
        uagLicense: settings.FORMIO_TEST_UAG_LICENSE || '',
        uagLicenseRemote: settings.FORMIO_TEST_UAG_LICENSE_REMOTE || '',
        project: settings.FORMIO_TEST_PROJECT || DEFAULT_PROJECT,
    };
}

export function deployedMissing(settings = process.env) {
    const named = { FORMIO_TEST_URL: 'url', FORMIO_TEST_EMAIL: 'email', FORMIO_TEST_PASSWORD: 'password', FORMIO_TEST_UAG_LICENSE: 'uagLicense' };
    const deployed = deployedSettings(settings);
    return [
        ...Object.entries(named).filter(([, key]) => !deployed[key]).map(([name]) => name),
        ...['CLAUDE_API_KEY', 'TYPESAFE_API_KEY'].filter((name) => !settings[name]),
    ];
}

/**
 * How the UAG container reaches the project: over HTTP, at the project's
 * subdomain of the deployment's host (a license for `*.form.test` allows
 * `uag-demo.form.test`, not `form.test`), by its ID (the deployment answers a
 * subdomain's root with the portal), with that name mapped to the address this
 * machine resolves the host to. `{ projectUrl, extraHost }`.
 */
export async function uagReach(url, { name, id }) {
    const host = new URL(url).hostname;
    const { address } = await lookup(host, { family: 4 });
    return { projectUrl: `http://${name}.${host}/project/${id}`, extraHost: `${name}.${host}:${address}` };
}

let systemCas = false;
/** Trust the operating system's certificate authorities too, as the browser does. */
function trustSystemCas() {
    if (systemCas) return;
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
    systemCas = true;
}

/** Calls to the deployment, as a portal account. */
export async function deploymentClient({ url, email, password }) {
    trustSystemCas();
    async function call(method, pathname, { token, body } = {}) {
        const response = await fetch(`${url}${pathname}`, {
            method,
            headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { 'x-jwt-token': token }) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(120000),
        });
        const text = await response.text();
        let json = text;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            // Not JSON.
        }
        return { status: response.status, ok: response.ok, token: response.headers.get('x-jwt-token'), body: json };
    }
    const signedIn = await call('POST', '/formio/user/login', { body: { data: { email, password } } });
    if (!signedIn.ok || !signedIn.token) throw new Error(`Signing in to ${url} as ${email} failed (${signedIn.status}). Check FORMIO_TEST_EMAIL and FORMIO_TEST_PASSWORD.`);
    const token = signedIn.token;
    const user = signedIn.body;
    const api = (method, pathname, body) => call(method, pathname, { token, body });
    return {
        url,
        user,
        call,
        api,
        /** The account's projects (stages included). */
        async projects() {
            const listed = await api('GET', '/project?limit=1000');
            if (!listed.ok || !Array.isArray(listed.body)) throw new Error(`Listing the projects of ${url} failed (${listed.status}).`);
            return listed.body;
        },
        /** Deletes a project the account owns, and its stages. */
        async deleteProject(id) {
            for (const stage of (await this.projects()).filter((candidate) => candidate.project === id)) {
                await api('DELETE', `/project/${stage._id}`);
            }
            const deleted = await api('DELETE', `/project/${id}`);
            if (!deleted.ok && deleted.status !== 404) throw new Error(`Deleting project ${id} failed (${deleted.status}): ${JSON.stringify(deleted.body)}`);
        },
    };
}

/**
 * Creates the demo's project on the deployment, owned by the signed-in account,
 * with `projectKey` as an API key. A project of that name the account owns is
 * deleted first; one another account owns stops the start.
 */
export async function createDemoProject(client, { name, title = PROJECT_TITLE, projectKey }) {
    const projects = await client.projects();
    for (const existing of projects.filter((candidate) => candidate.name === name && !candidate.project)) {
        if (existing.owner !== client.user._id) throw new Error(`${client.url} has a project named ${name} that ${client.user.data?.email || 'this account'} does not own; set FORMIO_TEST_PROJECT to another name.`);
        console.log(`Deleting ${name}, left by an earlier run ...`);
        await client.deleteProject(existing._id);
    }
    const sameTitle = projects.filter((candidate) => candidate.title === title && candidate.name !== name && !candidate.project);
    if (sameTitle.length) throw new Error(`${client.url} already has a project titled "${title}" (${sameTitle.map((p) => p.name).join(', ')}), which the portal would confuse with the demo's.`);
    const created = await client.api('POST', '/project', { title, name, template: demoTemplate() });
    if (!created.ok) throw new Error(`Creating project ${name} failed (${created.status}): ${JSON.stringify(created.body)}`);
    const project = created.body;
    const current = (await client.api('GET', `/project/${project._id}`)).body;
    const settings = current?.settings || {};
    const keyed = await client.api('PUT', `/project/${project._id}`, { settings: { ...settings, keys: [...(settings.keys || []), { name: 'uag-demo', key: projectKey }] } });
    if (!keyed.ok) throw new Error(`Adding the API key to ${name} failed (${keyed.status}): ${JSON.stringify(keyed.body)}`);
    return project;
}

/**
 * Starts the demo on the deployment. `site` and `uag` are where the site and the
 * UAG are published on this machine; `project` is the Compose project name.
 * Resolves to the same shape as startEnterpriseDemo.
 */
export async function startDeployedDemo({ site = SITE, uag = UAG, project = 'uag-recordings-deployed', connectStage = true, settings = process.env } = {}) {
    const deployed = deployedSettings(settings);
    const missing = deployedMissing(settings);
    if (missing.length) throw new Error(`Set ${missing.join(', ')} in the root .env.`);
    const secret = () => randomBytes(24).toString('hex');
    const projectKey = secret();
    const portalSecret = secret();
    const client = await deploymentClient(deployed);

    const out = await fs.mkdtemp(path.join(os.tmpdir(), `${project}-site-`));
    let stack = null;
    let served = null;
    let created = null;
    const stop = async () => {
        if (served) await served.close();
        if (stack) await stack.down();
        if (created) await client.deleteProject(created._id).catch((error) => console.error(error.message));
        await fs.rm(out, { recursive: true, force: true });
    };
    try {
        created = await createDemoProject(client, { name: deployed.project, projectKey });
        console.log(`Created project ${deployed.project} on ${deployed.url}.`);
        const reach = await uagReach(deployed.url, { name: deployed.project, id: created._id });
        stack = await exampleStack({
            project,
            dir: path.join(repoRoot, 'demo'),
            env: {
                FORMIO_PROJECT_URL: reach.projectUrl,
                PROJECT_KEY: projectKey,
                UAG_JWT_SECRET: secret(),
                TYPESAFE_API_KEY: settings.TYPESAFE_API_KEY,
                CLAUDE_API_KEY: settings.CLAUDE_API_KEY,
                ...(settings.CLAUDE_MODEL && { CLAUDE_MODEL: settings.CLAUDE_MODEL }),
                // The site, and the portal, which calls the UAG to connect a stage to it.
                DEMO_SITE_ORIGIN: `${originsOf(site)},${new URL(deployed.url).origin.replace(/^https:/, 'http:')}`,
                UAG_IMAGE: IMAGE,
                UAG_LICENSE: deployed.uagLicense,
                UAG_LICENSE_REMOTE: deployed.uagLicenseRemote,
                PORTAL_SECRET: portalSecret,
            },
            override: [
                'services:',
                '  formio-uag:',
                '    build: !reset null',
                '    pull_policy: never',
                '    ports: !override',
                `      - "127.0.0.1:${new URL(uag).port}:3200"`,
                '    extra_hosts:',
                `      - "${reach.extraHost}"`,
                '    environment:',
                '      LICENSE_KEY: ${UAG_LICENSE}',
                '      LICENSE_REMOTE: ${UAG_LICENSE_REMOTE}',
                '      PORTAL_SECRET: ${PORTAL_SECRET}',
                '',
            ].join('\n'),
        });
        await buildLocalImage();
        await stack.compose('up', '-d');
        await waitUntil(async () => {
            const response = await fetch(`${uag}/${deployed.project}/service-request`, { headers: { 'x-token': projectKey } });
            const body = response.ok ? await response.json() : null;
            if (body?.name !== 'serviceRequest') throw new Error(`form: ${JSON.stringify(body)}`);
        }, { timeoutMs: 300000, describe: async () => stack.logs('formio-uag') });
        served = await serveSite({
            port: new URL(site).port,
            env: {
                DEMO_PUBLIC_URL: site,
                DEMO_OUT: out,
                FORMIO_PROJECT_URL: `${deployed.url}/${deployed.project}`,
                DEMO_UAG_URL: uag,
                DEMO_UAG_PROJECT_PATH: `/${deployed.project}`,
            },
        });
    }
    catch (error) {
        await stop();
        throw error;
    }
    const env = {
        site,
        // The portal over HTTP: from an HTTPS page it refuses to connect a stage to
        // an HTTP environment, which the UAG on this machine is.
        portal: deployed.url.replace(/^https:/, 'http:'),
        uag,
        portalSecret,
        projectKey,
        projectId: created._id,
        projectName: deployed.project,
        projectTitle: PROJECT_TITLE,
        email: deployed.email,
        password: deployed.password,
        client,
        stack,
        generated: [],
        stop,
    };
    if (!connectStage) return env;
    try {
        env.uagStage = await connectUagStage(env, { project: PROJECT_TITLE, name: `${deployed.project}-uag` });
    }
    catch (error) {
        await stop();
        throw error;
    }
    return env;
}
