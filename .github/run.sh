#!/usr/bin/env bash
# Scripted steps of the publish workflow: run.sh <step> [args...]
# Secrets (tokens, keys) come in through the environment, not arguments.
# DRY_RUN=true makes publish and deploy dry runs where supported.
set -euo pipefail

# Published in dependency order: the SDK, the engines, the engine server,
# @formio/uag-js, then the root package.
PACKAGES=(packages/engine-sdk engines/jev engines/claude engines/openai engines/grok engines/gemini packages/engine-server packages/uag-js .)

# release: work out what a push is. A branch is only built and tested, its
# images tagged <branch>-<short sha> and <branch>; a tag must match
# package.json. Writes kind, version, channel and targets to $GITHUB_OUTPUT.
release() {
  local version actual kind channel targets
  if [ "${GITHUB_REF_TYPE:-}" != tag ]; then
    # A Docker tag allows only [A-Za-z0-9_.-] and cannot start with . or -.
    channel=$(printf '%s' "$GITHUB_REF_NAME" | tr -c 'A-Za-z0-9_.-' '-' | sed 's/^[.-]*//' | cut -c1-100)
    printf '%s\n' kind=branch "version=$channel-${GITHUB_SHA::7}" "channel=$channel" >> "$GITHUB_OUTPUT"
    return 0
  fi
  version=${GITHUB_REF_NAME#v}
  actual=$(jq -r .version package.json)
  if [ "$version" != "$actual" ]; then
    echo "::error::Tag $GITHUB_REF_NAME does not match package.json ($actual). Run 'yarn release:version $version', commit, and move the tag."
    exit 1
  fi
  if [[ $version == *-* ]]; then
    kind=pre; channel=${version#*-}; channel=${channel%%.*}
    targets='[{"prefix":"test","region":"us-east-1"}]'
  else
    kind=release; channel=latest
    targets='[{"prefix":"test","region":"us-east-1"},{"prefix":"prod","region":"us-west-1"}]'
  fi
  printf '%s\n' "kind=$kind" "version=$version" "channel=$channel" "targets=$targets" >> "$GITHUB_OUTPUT"
}

# publish_packages <kind> <channel>: publish each package npm does not have yet,
# so a rerun is safe. A prerelease goes to the private registry
# ($PRIVATE_NPM_REGISTRY, token in $PRIVATE_NPM_TOKEN) and skips the root
# prepublishOnly, whose release check looks for the SDK on npmjs.
publish_packages() {
  local kind="$1" channel="$2" dir spec
  local args=(--access public --tag "$channel") view=(--silent)
  if [ "${DRY_RUN:-}" = true ]; then args+=(--dry-run); fi
  if [ "$kind" = pre ]; then
    args+=(--registry "$PRIVATE_NPM_REGISTRY" --ignore-scripts)
    view+=(--registry "$PRIVATE_NPM_REGISTRY")
    npm config set "//${PRIVATE_NPM_REGISTRY#*//}/:_authToken" "$PRIVATE_NPM_TOKEN"
  fi
  for dir in "${PACKAGES[@]}"; do
    spec=$(jq -r '.name + "@" + .version' "$dir/package.json")
    if npm view "$spec" version "${view[@]}" >/dev/null 2>&1; then
      echo "$spec is already published."
      continue
    fi
    (cd "$dir" && npm publish "${args[@]}")
  done
}

# wait_for_packages: npm takes a few minutes to show a new version.
wait_for_packages() {
  local dir spec
  for dir in "${PACKAGES[@]}"; do
    spec=$(jq -r '.name + "@" + .version' "$dir/package.json")
    for _ in $(seq 60); do
      if npm view "$spec" version >/dev/null 2>&1; then continue 2; fi
      sleep 10
    done
    echo "::error::$spec did not appear on npm within 10 minutes."
    exit 1
  done
}

# copy_to_dockerhub <registry> <version> <channel>: copy the tested ECR
# manifests to Docker Hub. The demo images are not published.
copy_to_dockerhub() {
  local registry="$1" version="$2" channel="$3" image
  for image in uag uag-engines; do
    docker buildx imagetools create \
      --tag "formio/$image:$version" --tag "formio/$image:$channel" \
      "$registry/formio/$image:$version"
  done
}

# publish_mcp <version>: publish to the MCP registry; key in $MCP_PRIVATE_KEY.
publish_mcp() {
  local version="$1"
  jq --arg v "$version" '.version = $v | .packages[0].version = $v' server.json > server.tmp
  mv server.tmp server.json
  mcp-publisher login dns --domain form.io --private-key "$MCP_PRIVATE_KEY"
  mcp-publisher publish
}

# deploy <registry> <version> <prefix> <region>: point the demo workloads at
# the new images.
deploy() {
  local registry="$1" version="$2" prefix="$3" region="$4"
  local namespace=demo-uag cluster=deploy-01 dry=()
  aws eks update-kubeconfig --name "$cluster" --region "$region"
  if [ "${DRY_RUN:-}" = true ]; then dry=(--dry-run=server); fi
  kubectl -n "$namespace" set image "deployment/$prefix-demo-uag-gw" "uag=$registry/uag:$version" "${dry[@]}"
  # kubectl -n "$namespace" set image "deployment/$prefix-demo-uag-demo" "*=$registry/uag-demo:$version" "${dry[@]}"
  # kubectl -n "$namespace" set image "cronjob/$prefix-demo-uag-maint" "*=$registry/uag-demo-maint:$version" "${dry[@]}"
  if [ "${DRY_RUN:-}" != true ]; then
    kubectl -n "$namespace" rollout status "deployment/$prefix-demo-uag-gw" --timeout=10m
    # kubectl -n "$namespace" rollout status "deployment/$prefix-demo-uag-demo" --timeout=10m
  fi
}

step="${1:?usage: run.sh <step> [args...]}"
shift
"$step" "$@"
