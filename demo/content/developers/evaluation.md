---
title: Evaluation
description: Choose decision thresholds with uag-eval, by measuring automation and accuracy on your own labeled examples.
section: Operate
order: 30
---

A decision field is filled automatically only when the engine's confidence clears the field's threshold. Set the threshold low and more fields are decided without a person, with more mistakes; set it high and fewer mistakes get through, but more fields wait for a person. The defaults (`uagThreshold` 0.5, `uagUncertainBand` 0.2–0.8) are a starting point, not a measurement. `uag-eval` measures the trade-off on your own forms, with your own examples, before you rely on it.

## What uag-eval does

1. Loads the decision engine exactly as the UAG does, from `UAG_ENGINES` and its `UAG_ENGINE_*` settings, so the instance you evaluate is the one you deploy, with the same model.
2. Builds the form from a JSON export, offline. It never contacts the Form.io project.
3. For each example, asks the engine the task's decision questions once.
4. Scores every decision field at a range of thresholds (choice and score fields) or uncertain bands (yes/no fields and select boxes): how many examples would have been decided automatically, and how many of those were right. The engine is not called again for each setting.
5. Prints one table per field, and optionally writes the full report as JSON.

```pipeline
examples.json + form.json -> uag-eval -> one engine call per example* -> answers scored at each threshold and band -> per-field table: automated, accuracy, deferred
```

## License

`uag-eval` is part of Agentic Formflow. Evaluating a real engine needs a `LICENSE_KEY` that includes the UAG and allows the project URL you pass as `--project`. Because the run is offline, a local project URL does not stand in for the license. The stub engines (`stub-decision`) need neither, which is useful for trying the command and its file formats.

## Run it

In the Docker image, which includes the official engines:

```bash
docker run --rm -v "$PWD:/work" -w /work -e TYPESAFE_API_KEY -e LICENSE_KEY --entrypoint node formio/uag \
  --no-node-snapshot /app/bin/uag-eval.js --form claim.json --examples claim-examples.json --task triage --engine jev \
  --project https://forms.example.com/claims --json report.json
```

With the npm package, install the engine's package next to it:

```bash
npm install @formio/uag @formio/uag-jev
NODE_OPTIONS=--no-node-snapshot npx uag-eval --form claim.json --examples claim-examples.json \
  --task triage --engine jev --project https://forms.example.com/claims --json report.json
```

From a checkout of the UAG repository: `yarn install && yarn build`, then `node --no-node-snapshot bin/uag-eval.js` with the same arguments.

`uag-eval` reads a `.env` file in the working directory, like the `uag` command.

## Flags

| Flag | Required | Meaning |
|---|---|---|
| `--form <file>` | yes | A Form.io form definition, as JSON (the form's export, or the form's entry from a project template). |
| `--examples <file>` | yes | The labeled examples. See [The examples file](#the-examples-file). |
| `--task <name>` | no | The task to evaluate. Default: the form's first task. (`--persona`, its 1.x name, is refused.) |
| `--engine <name>` | no | The decision engine: an instance named in `UAG_ENGINES`, evaluated with its own settings, or an entry in the same syntax (`jev`, `next:jev`, `decide:openai`). Default: the first instance in `UAG_ENGINES`. |
| `--json <file>` | no | Also write the full report as JSON. |
| `--project <url>` | no | The project URL the evaluation is for, which the license must allow. Default: none. |

Each flag takes the next argument as its value. Unknown flags are ignored.

| Exit code | When |
|---|---|
| `0` | The report was printed. |
| `1` | Something failed, such as an engine that is not installed (`No engine type "nope" is installed. Looked for "@formio/uag-nope" and "uag-engine-nope". ...`), a missing setting, or a missing license. The message is printed. |
| `2` | Usage: `--form` or `--examples` is missing, no engine is named (`Name the decision engine with --engine or UAG_ENGINES.`), or the engine is not a decision engine (`"stub-agent" is not a decision engine.`). |

### Choosing the engine

```bash
# The deployed instance, with its own settings:
UAG_ENGINES=jev,next:jev UAG_ENGINE_NEXT_MODEL=jev-1.14.0 TYPESAFE_API_KEY=... \
  uag-eval --form claim.json --examples claim-examples.json --engine next

# An instance that is not deployed yet, as an entry:
OPENAI_API_KEY=... UAG_ENGINE_DECIDE_KIND=decision UAG_ENGINE_DECIDE_MODEL=gpt-6-luna \
  uag-eval --form claim.json --examples claim-examples.json --engine decide:openai
```

Run each engine you are considering on the same examples to compare them.

## The form file

Any Form.io form definition with a task. `uag-eval` adds the `uag` tag if the form does not have it, and takes the form's name from `name`, else `path`. The task's criteria, input, `uagContext` and decision field properties are read from the form as the UAG reads them; see [Form properties](/developers/form-properties).

Resource-backed selects need a live project for their options, so they are skipped.

## The examples file

A JSON array. Each example is the submission data the task reads, and the values you expect for the fields you want to measure:

```json
[
  {
    "id": "rear-end",
    "data": { "lossDescription": "I was rear-ended and hurt my neck." },
    "expected": { "triage.claimType": "autoCollision", "triage.injuryInvolved": true }
  },
  {
    "id": "theft",
    "data": { "lossDescription": "My car was stolen. Nobody was hurt." },
    "expected": { "triage.claimType": "theft", "triage.injuryInvolved": false }
  },
  {
    "id": "vague",
    "data": { "lossDescription": "Something happened." },
    "expected": { "triage.claimType": null }
  }
]
```

| Key | Meaning |
|---|---|
| `id` | Optional. A label for the example. |
| `data` | The submission data, including the task's input field. Paths are the form's data paths. |
| `expected` | Field path → the value the field should get, as stored (option values, not labels; `true`/`false` for yes/no). `null` means "the input does not say": the field should stay empty. |

Only fields with an expected value in at least one example are reported, and each field is scored only on the examples that list it. Label real inputs, including the vague, contradictory and off-topic ones your users write: they are what thresholds are for.

## Reading the report

The output of the examples above with the stub decision engine, which always picks the alphabetically first option and affirms every yes/no question:

```text
Decision evaluation: form "claim", task "triage", stub-decision (stub-decision-1), 3 example(s)

Claim type (triage.claimType, choice), 3 example(s)
  setting     automated  accuracy  deferred
  0.3              100%       33%         0
  0.4              100%       33%         0
  0.5              100%       33%         0
  0.6              100%       33%         0
  0.7              100%       33%         0
  0.8              100%       33%         0
  0.9              100%       33%         0

Someone was injured (triage.injuryInvolved, noul), 2 example(s)
  setting     automated  accuracy  deferred
  0.1-0.9            0%      100%         2
  0.2-0.8          100%       50%         0
  0.3-0.7          100%       50%         0
  0.4-0.6          100%       50%         0
```

Each field gets a table. The heading names the field's label, path, shape (`choice`, `score`, `noul`, and so on) and how many examples it was scored on.

| Column | Meaning |
|---|---|
| `setting` | For choice and score fields, a confidence threshold, the value you would set as `uagThreshold`. For yes/no fields and select boxes, an uncertain band, the value you would set as `uagUncertainBand`. |
| `automated` | The share of examples the field would have been decided automatically at that setting. |
| `accuracy` | Of the automatic decisions, the share that matched the expected value. 100% when none were made. |
| `deferred` | Examples that would have been left for a person (uncertain, or missing when a value was expected). |

How a result counts:

- A **confident** answer is automatic; it is correct when it equals the expected value. Select boxes compare by their checked options, and lists regardless of order.
- When the example expects `null` and the field is left empty (`missing`), that is automatic and correct: the engine rightly saw nothing to decide.
- Anything else is deferred.

A confident answer on an example that expects `null`, as for "vague" above, is automatic and wrong.

### Choosing a threshold

Decide what accuracy an automatic decision needs: a wrong claim type that sends a claim to the wrong team costs more than one a reviewer corrects at once. Then pick, for each field, the lowest threshold (or the narrowest band) whose accuracy meets that target, and read its automation rate: that is the share of submissions the field will decide on its own.

Set the result on the field:

| Field | Property |
|---|---|
| Choice or score | `uagThreshold`, such as `0.7` |
| Yes/no, select boxes | `uagUncertainBand`, such as `0.1-0.5` |

Or change the defaults for the project with `agentApi.threshold` and `agentApi.uncertainBand` (see [Engines and routing](/developers/engines#agent-api-defaults)).

Run `uag-eval` again, on the same examples, before you change a threshold, the pinned model version (`TYPESAFE_MODEL`, or the instance's `model`) or the engine. Behavior differs between model versions.

## The JSON report

`--json report.json` writes the full report:

```ts
type EvalReport = {
    form: string;
    task: string;
    engine: string;          // the instance name
    model: string;
    examples: number;
    generatedAt: string;     // ISO 8601
    fields: EvalFieldReport[];
};

type EvalFieldReport = {
    path: string;
    label: string;
    shape: string;           // choice, score, noul, ...
    examples: number;        // examples this field was scored on
    /** By threshold (choice and score fields) or band (yes/no fields and select boxes), as a string key. */
    grid: Record<string, EvalCell>;
};

type EvalCell = {
    automated: number;       // examples decided automatically
    correct: number;         // of those, how many matched
    automationRate: number;  // automated / examples
    accuracy: number;        // correct / automated, or 1 when none were automated
    deferred: number;        // examples left for a person
};
```

The thresholds are `0.3` to `0.9` in steps of `0.1`; the bands are `0.1-0.9`, `0.2-0.8`, `0.3-0.7` and `0.4-0.6`. From the run above:

```json
{
  "form": "claim",
  "task": "triage",
  "engine": "stub-decision",
  "model": "stub-decision-1",
  "examples": 3,
  "generatedAt": "2026-10-23T10:21:50.743Z",
  "fields": [
    {
      "path": "triage.claimType",
      "label": "Claim type",
      "shape": "choice",
      "examples": 3,
      "grid": {
        "0.3": { "automated": 3, "correct": 1, "deferred": 0, "automationRate": 1, "accuracy": 0.3333333333333333 },
        "0.5": { "automated": 3, "correct": 1, "deferred": 0, "automationRate": 1, "accuracy": 0.3333333333333333 },
        "0.9": { "automated": 3, "correct": 1, "deferred": 0, "automationRate": 1, "accuracy": 0.3333333333333333 }
      }
    },
    {
      "path": "triage.injuryInvolved",
      "label": "Someone was injured",
      "shape": "noul",
      "examples": 2,
      "grid": {
        "0.1-0.9": { "automated": 0, "correct": 0, "deferred": 2, "automationRate": 0, "accuracy": 1 },
        "0.2-0.8": { "automated": 2, "correct": 1, "deferred": 0, "automationRate": 1, "accuracy": 0.5 }
      }
    }
  ]
}
```

(The grids are shortened here; the file has every threshold and band.) Keep the JSON with the form's version, so a later run can be compared with it, for example in CI before a model upgrade.

## Next steps

- [Form properties](/developers/form-properties): `uagThreshold`, `uagUncertainBand` and the other decision field properties.
- [Engines and routing](/developers/engines): the decision engines you can evaluate.
- [Agent API](/developers/agent-api): how `confident`, `uncertain` and `missing` reach your application.
