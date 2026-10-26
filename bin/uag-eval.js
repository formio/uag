#!/usr/bin/env node
/**
 * uag-eval: measure decision accuracy against automation on labeled examples.
 *
 *   uag-eval --form claim.json --examples claim-examples.json [--task triage]
 *            [--engine jev] [--json report.json]
 *
 * --form      A Form.io form definition (JSON export).
 * --task      The task to evaluate (default: the form's first). `--persona` is the old name.
 * --examples  A JSON array of { "id", "data": { ... }, "expected": { "<path>": <value or null> } }.
 *             null means "the input does not say", which expects the field to stay empty.
 * --engine    The decision engine to evaluate: an instance named in UAG_ENGINES, or an
 *             entry in its syntax (`jev`, `next:jev`). Default: the first in UAG_ENGINES.
 * --json      Also write the full report as JSON.
 * --project   The project URL the evaluation runs for (default: none). A real engine
 *             needs a UAG_LICENSE with the "uag" feature for this URL; the stub
 *             engines need neither.
 *
 * The engine is loaded as the UAG loads it, so the same UAG_ENGINES and
 * UAG_ENGINE_* variables give the same instance, with the same model. Its type
 * may be built in, or an installed engine package. Resource-backed selects need
 * a live project and are skipped.
 */
require('dotenv/config');
const { readFileSync, writeFileSync } = require('fs');
const { parseInstances } = require('@formio/uag-sdk');
const { ProjectInterface, UAGProjectInterface, UAGFormInterface, loadUAGEngines } = require('../lib');
const { FormflowService, formatReport, resolveTaskName } = require('../lib/formflow');

/**
 * The instance to evaluate: the one UAG_ENGINES names `name`, so a deployed
 * instance is evaluated with its own settings, or else `name` as an entry.
 */
function engineEntry(name, env) {
    const deployed = parseInstances(env.UAG_ENGINES);
    if (!name) return deployed[0];
    return deployed.find((instance) => instance.name === name) || parseInstances(name)[0];
}

function args(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
    }
    return out;
}

async function main() {
    const opts = args(process.argv.slice(2));
    if (!opts.form || !opts.examples) {
        console.error('Usage: uag-eval --form <form.json> --examples <examples.json> [--task <name>] [--engine <name>] [--json <out.json>] [--project <url>]');
        process.exit(2);
    }
    const task = resolveTaskName(opts, 'uag-eval');
    const formDef = JSON.parse(readFileSync(opts.form, 'utf8'));
    const examples = JSON.parse(readFileSync(opts.examples, 'utf8'));
    const entry = engineEntry(opts.engine, process.env);
    if (!entry) {
        console.error('Name the decision engine with --engine or UAG_ENGINES.');
        process.exit(2);
    }

    const registry = await loadUAGEngines({ engines: [entry] }, process.env);
    const engine = registry.decision[0];
    if (!engine) {
        console.error(`"${registry.all[0].name}" is not a decision engine.`);
        process.exit(2);
    }

    // The license the evaluation may use, read as a running UAG reads it.
    await ProjectInterface.connect({ config: { license: String(process.env.UAG_LICENSE || '') } });
    // Build the form offline. Outside a running server the project would create
    // the base form class, so the UAG form interface is constructed directly.
    const project = new UAGProjectInterface(opts.project || 'http://offline.invalid');
    const name = formDef.name || formDef.path || 'form';
    formDef.tags = [...new Set([...(formDef.tags || []), 'uag'])];
    // The constructor sets the form, which derives its UAG registration and tasks.
    const form = new UAGFormInterface(project, formDef);
    project.forms[name] = form;

    const report = await new FormflowService(project).evaluate(form, task, examples, engine, {}, (done, total) => {
        process.stderr.write(`\r${done}/${total} example(s)`);
    });
    process.stderr.write('\n');
    console.log(formatReport(report));
    if (opts.json) {
        writeFileSync(opts.json, JSON.stringify(report, null, 2));
        console.log(`Report written to ${opts.json}`);
    }
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
