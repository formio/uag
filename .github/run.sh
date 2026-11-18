#!/usr/bin/env bash
# Scripted steps of the publish workflow: run.sh <step> [args...]
# Secrets (tokens, keys) come in through the environment, not arguments.
set -euo pipefail

# The workspace packages, in dependency order: the SDK, the engines (openai
# before the grok and gemini engines built on it), the engine server and
# @formio/uag-js. The root package, @formio/uag, is published after them.
WORKSPACES=(packages/engine-sdk engines/jev engines/claude engines/openai engines/grok engines/gemini packages/engine-server packages/uag-js)

# release: work out what this run is. A run by hand on a branch builds and
# tests it and pushes its images to ECR only, tagged <branch>-<short sha> and
# <branch>. A tag (pushed, or a run by hand on one) must match package.json.
# Writes kind, version, channel and targets to $GITHUB_OUTPUT.
release() {
  local version actual kind channel targets
  if [ "${GITHUB_REF_TYPE:-}" != tag ]; then
    # A Docker tag allows only [A-Za-z0-9_.-] and cannot start with . or -.
    channel=$(printf '%s' "$GITHUB_REF_NAME" | tr -c 'A-Za-z0-9_.-' '-' | sed 's/^[.-]*//' | cut -c1-100)
    printf '%s\n' kind=branch "version=$channel-${GITHUB_SHA::7}" "channel=$channel" 'targets=[]' >> "$GITHUB_OUTPUT"
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

# publish <dir> <channel> [npm args...]: publish one package unless the
# registry already has its version, so a rerun is safe.
publish() {
  local dir="$1" channel="$2" spec
  shift 2
  spec=$(jq -r '.name + "@" + .version' "$dir/package.json")
  if npm view "$spec" version "$@" >/dev/null 2>&1; then
    echo "$spec is already published."
    return 0
  fi
  (cd "$dir" && npm publish --access public --tag "$channel" "$@")
}

# publish_prerelease <channel>: publish every package to the private registry
# ($PRIVATE_NPM_REGISTRY, token in $PRIVATE_NPM_TOKEN). --ignore-scripts skips
# the root prepublishOnly, whose release check looks for the SDK on npmjs.
publish_prerelease() {
  local channel="$1" host dir
  host=${PRIVATE_NPM_REGISTRY#*//}
  npm config set "//${host%/}/:_authToken" "$PRIVATE_NPM_TOKEN"
  for dir in "${WORKSPACES[@]}" .; do
    publish "$dir" "$channel" --registry "$PRIVATE_NPM_REGISTRY" --ignore-scripts
  done
}

# publish_release: publish every package to npmjs through Trusted Publishing.
# @formio/uag goes last, once npm shows the workspace packages: its
# prepublishOnly refuses to publish until the SDK it depends on is there.
publish_release() {
  local dir
  for dir in "${WORKSPACES[@]}"; do publish "$dir" latest; done
  wait_for_packages
  publish . latest
}

# wait_for_packages: npm takes a few minutes to show a new version.
wait_for_packages() {
  local dir spec
  for dir in "${WORKSPACES[@]}"; do
    spec=$(jq -r '.name + "@" + .version' "$dir/package.json")
    for _ in $(seq 60); do
      if npm view "$spec" version >/dev/null 2>&1; then continue 2; fi
      sleep 10
    done
    echo "::error::$spec did not appear on npm within 10 minutes."
    exit 1
  done
}

# copy_to_dockerhub <registry> <version> <channel>: copy the ECR manifests the
# images job pushed to Docker Hub, without rebuilding them.
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
  local namespace=demo-uag cluster=deploy-01
  aws eks update-kubeconfig --name "$cluster" --region "$region"
  kubectl -n "$namespace" set image "deployment/$prefix-demo-uag-gw" "uag=$registry/uag:$version"
  kubectl -n "$namespace" rollout status "deployment/$prefix-demo-uag-gw" --timeout=10m
}

step="${1:?usage: run.sh <step> [args...]}"
shift
"$step" "$@"
