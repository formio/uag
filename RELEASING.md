# Releasing

Every package in this repository is released together, at one version: `@formio/uag`, the engine SDK, the engines, the engine server, `@formio/uag-js` and the demo. A pushed version tag (`v2.0.0-rc.1` or `2.0.0-rc.1`) runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which tests, builds, publishes and deploys them. The tag can be on any branch: tag a pull request's branch to publish a release candidate for testing before it is merged.

## Steps

1. Set the version everywhere, and update the lockfile:

   ```bash
   yarn release:version 2.0.0-rc.2
   yarn install
   ```

2. Rename `CHANGELOG.md`'s newest heading to the version (`## 2.0.0-rc.2`).
3. Build and check:

   ```bash
   yarn build && yarn test && node scripts/check-release.mjs
   ```

   The check refuses a package out of step with the root version, a dependency range that does not accept it, a stale `lib/`, and a version the changelog does not describe. Run before a release's packages are on npm, it also says the engine SDK is not published yet; CI publishes it before the UAG.
4. Commit (`Update versions.`), tag and push:

   ```bash
   git tag v2.0.0-rc.2 && git push origin HEAD v2.0.0-rc.2
   ```

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
