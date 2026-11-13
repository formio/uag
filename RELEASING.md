# Releasing

Every package in this repository is released together, at one version: `@formio/uag`, the engine SDK, the engines, the engine server, `@formio/uag-js` and the demo. A pushed version tag (`v2.0.0-rc.1` or `2.0.0-rc.1`) runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which tests, builds and publishes them. The tag can be on any branch: tag a pull request's branch to publish a release candidate for testing before it is merged.

## Steps

1. Put the release's notes at the top of `CHANGELOG.md`, under `## Unreleased` (or the current prerelease's heading, such as `## 2.0.0-rc.1`, while a version is in release candidates).
2. On the branch to release from, with no uncommitted changes:

   ```bash
   LICENSE_KEY= yarn release 2.0.0-rc.2           # prepare, commit and tag; prints the push command
   LICENSE_KEY= yarn release 2.0.0-rc.2 --push    # and push the branch and the tag, which starts CI
   ```

   `LICENSE_KEY=` keeps a `LICENSE_KEY` in the root `.env` out of the tests: some of them load that file, and the tests of unlicensed behavior fail when it sets a license. An empty variable in the environment wins over `.env`.

   It sets the version on every package (`yarn release:version`), names the changelog's newest entry for it, updates the lockfile, builds, runs the tests (`--skip-tests` skips them) and the release check, commits `Update versions.` and tags `v2.0.0-rc.2`. It refuses uncommitted changes, a tag that already exists, and a changelog whose newest entry is a released version (its notes are never renamed: add the new ones under `## Unreleased`). If a step fails, nothing is committed, and `git checkout -- .` undoes the version changes.

The release check (`scripts/check-release.mjs`) refuses a package out of step with the root version, a dependency range that does not accept it, a dependency on a local folder, a package that is not MIT, a model provider SDK or engine package among `@formio/uag`'s dependencies, an engine whose provider SDK is not pinned to an exact version, a stale `lib/`, and a version the changelog does not describe. `yarn release` and CI both run it with `--before-publish`, which skips only its check that the packages of this repository that `@formio/uag` depends on (the engine SDK, `@formio/uag-sdk`) are on npm at a version its range accepts: they are not published yet when it runs. CI publishes them first, and `@formio/uag`'s `prepublishOnly` runs the full check before it goes out.

## Repository settings

[`publish.yml`](.github/workflows/publish.yml) runs in the `production` environment, so each of these can be set on that environment or on the repository:

| Name | Kind | Used by |
|---|---|---|
| `E2E_HOSTED_PROJECT_URL`, `E2E_FORMIO_LICENSE_REMOTE` | variables | The Getting Started gate (below). |
| `E2E_HOSTED_PROJECT_KEY`, `E2E_FORMIO_LICENSE`, `CLAUDE_API_KEY`, `TYPESAFE_API_KEY` | secrets | The Getting Started gate (below). |
| `DOCKERHUB_USERNAME` | variable | Docker Hub sign-in, to push `formio/uag` and `formio/uag-engines`. |
| `DOCKERHUB_TOKEN` | secret | Docker Hub sign-in: an access token of that account. |
| `MCP_PRIVATE_KEY` | secret | Signing in to the MCP Registry as `form.io` (DNS authentication), to publish `server.json` for a release. |

npm needs no token: CI publishes through npm's Trusted Publishing (see [A new package](#a-new-package)), which needs the job's `id-token: write` permission and no `NODE_AUTH_TOKEN`.

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
| `formio/uag` | `:2.0.0` and `:latest` | `:2.0.0-rc.2` and `:rc` |
| `formio/uag-engines` | `:2.0.0` and `:latest` | `:2.0.0-rc.2` and `:rc` |
| MCP Registry (`server.json`) | published | skipped |

A failed run can be rerun ("Re-run failed jobs"): a package npm already has at the version is skipped, as is the `formio/uag-engines` image when Docker Hub has it; the `formio/uag` image is built and pushed again. An image build that runs longer than 30 minutes fails instead of hanging: the arm64 half is built under QEMU, which can crash and hang.


## A new package

npm publishes from CI through Trusted Publishing, which is set up per package, on a package that exists. Publish a new package's first version from your machine, before tagging, and do not publish `@formio/uag` itself this way (CI must, or every step after it is skipped):

```bash
cd packages/engine-sdk && npm publish --access public --tag rc
```

Then, on npmjs.com, the package's **Settings**, **Trusted Publisher**: GitHub Actions, organization `formio`, repository `uag`, workflow `publish.yml`, environment `production`.
