# Releasing

Every package in this repository is released together, at one version: `@formio/uag`, the engine SDK, the engines, the engine server, `@formio/uag-js` and the demo. A pushed version tag (`v2.0.0-rc.1` or `2.0.0-rc.1`) runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which tests, builds, publishes and deploys them. The tag can be on any branch: tag a pull request's branch to publish a release candidate for testing before it is merged.

## Steps

1. Put the release's notes at the top of `CHANGELOG.md`, under `## Unreleased` (or the current prerelease's heading, such as `## 2.0.0-rc.1`, while a version is in release candidates).
2. On the branch to release from, with no uncommitted changes:

   ```bash
   yarn release 2.0.0-rc.2           # prepare, commit and tag; prints the push command
   yarn release 2.0.0-rc.2 --push    # and push the branch and the tag, which starts CI
   ```

   It sets the version on every package (`yarn release:version`), names the changelog's newest entry for it, updates the lockfile, builds, runs the tests (`--skip-tests` skips them) and the release check, commits `Update versions.` and tags `v2.0.0-rc.2`. It refuses uncommitted changes, a tag that already exists, and a changelog whose newest entry is a released version (its notes are never renamed: add the new ones under `## Unreleased`). If a step fails, nothing is committed, and `git checkout -- .` undoes the version changes.

The release check refuses a package out of step with the root version, a dependency range that does not accept it, a stale `lib/`, and a version the changelog does not describe. CI runs it with `--before-publish`, which skips only its check that the engine SDK is on npm: CI publishes the SDK next, and `@formio/uag`'s `prepublishOnly` runs the full check before it goes out.

## The Getting Started gate

Before it publishes anything, the workflow runs the Getting Started page's three guides as documented (`yarn test:getting-started`, `test/e2e/layer3.getting-started.e2e.mjs`) against an image built from the tag, with `E2E_STRICT=true`, so a guide that cannot run fails the release instead of being skipped. It needs these in the `production` environment:

| Name | Kind | Purpose |
|---|---|---|
| `E2E_HOSTED_PROJECT_URL` | variable | A project on Form.io's hosted service with the demo's `claim` form, such as `https://uag.form.io`. |
| `E2E_HOSTED_PROJECT_KEY` | secret | An API key of that project. |
| `E2E_FORMIO_LICENSE` | secret | A Form.io license that includes the UAG and allows `formio.e2e.test`. |
| `E2E_FORMIO_LICENSE_REMOTE` | variable | `true` when that license is an offline license. |
| `CLAUDE_API_KEY`, `TYPESAFE_API_KEY` | secrets | The engines the guides use. |

To check them without releasing, run the workflow by hand: **Actions → Publish UAG → Run workflow**, or `gh workflow run publish.yml --ref <branch>`. A run by hand runs only the guides and publishes nothing. Or run them locally with the same variables in `.env`; without them, the guides that need them are skipped.

## What the workflow publishes

| Where | Release (`2.0.0`) | Prerelease (`2.0.0-rc.2`) |
|---|---|---|
| npm, every public package | dist-tag `latest` | dist-tag `rc` (the word before the first dot) |
| `formio/uag`, `formio/uag-demo` | `:2.0.0` and `:latest` | `:2.0.0-rc.2` and `:rc` |
| `formio/uag-engines` | `:2.0.0` and `:latest` | `:2.0.0-rc.2` and `:rc` |
| MCP Registry (`server.json`) | published | skipped |
| Deployment hook | production | test |

A package or image already published at the version is skipped, so a failed run can be rerun.

## Deployment

The last step asks an environment to deploy the new images: a prerelease goes to test, a release to production. Each is optional; set the environment's hook as repository secrets, and the step does nothing for an environment without one:

| Secret | Purpose |
|---|---|
| `DEPLOY_TEST_HOOK_URL`, `DEPLOY_TEST_HOOK_TOKEN` | The test environment's hook, and its bearer token if it needs one. |
| `DEPLOY_PRODUCTION_HOOK_URL`, `DEPLOY_PRODUCTION_HOOK_TOKEN` | Production's. |

The hook receives a `POST` with JSON:

```json
{
  "environment": "test",
  "version": "2.0.0-rc.1",
  "tag": "v2.0.0-rc.1",
  "commit": "<sha>",
  "images": { "uag": "formio/uag:2.0.0-rc.1", "demo": "formio/uag-demo:2.0.0-rc.1" }
}
```

To deploy, set `UAG_IMAGE` and `DEMO_IMAGE` to those images in the stack's `.env` and run `docker compose pull && docker compose up -d` with [`demo/docker-compose.yml`](demo/docker-compose.yml).

## A new package

npm publishes from CI through Trusted Publishing, which is set up per package, on a package that exists. Publish a new package's first version from your machine, before tagging, and do not publish `@formio/uag` itself this way (CI must, or every step after it is skipped):

```bash
cd packages/engine-sdk && npm publish --access public --tag rc
```

Then, on npmjs.com, the package's **Settings**, **Trusted Publisher**: GitHub Actions, organization `formio`, repository `uag`, workflow `publish.yml`, environment `production`.
