# syntax=docker/dockerfile:1
# formio/uag-engines: the official engines (jev, claude, openai, grok, gemini)
# behind the remote engine protocol. Build from the repository root:
#
#   docker build -f packages/engine-server/Dockerfile -t formio/uag-engines .
#
# More engine packages can be installed in a derived image, or mounted and
# listed in UAG_ENGINE_PATH.
FROM node:lts-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/engine-sdk/package.json packages/engine-sdk/
COPY packages/engine-server/package.json packages/engine-server/
COPY engines/jev/package.json engines/jev/
COPY engines/claude/package.json engines/claude/
COPY engines/openai/package.json engines/openai/
COPY engines/grok/package.json engines/grok/
COPY engines/gemini/package.json engines/gemini/
# Not released (MAI is in preview): only its manifest, which the lockfile lists.
COPY engines/mai/package.json engines/mai/
# The demo site is a workspace too; its manifest is in the lockfile.
COPY demo/package.json demo/
# Only the engine server and the official engines, with their production
# dependencies: none of the UAG's own packages are installed.
RUN apk upgrade --no-cache && corepack enable && \
    yarn workspaces focus --production \
      @formio/uag-engines @formio/uag-jev @formio/uag-claude @formio/uag-openai \
      @formio/uag-grok @formio/uag-gemini
COPY packages/engine-sdk/ packages/engine-sdk/
COPY packages/engine-server/ packages/engine-server/
COPY engines/jev/ engines/jev/
COPY engines/claude/ engines/claude/
COPY engines/openai/ engines/openai/
COPY engines/grok/ engines/grok/
COPY engines/gemini/ engines/gemini/

FROM node:lts-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY --from=builder /app ./
ENV NODE_ENV=production PORT=3300
USER node
EXPOSE 3300
# The health check sends the key too: every route requires it.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3300)+'/health',{headers:{authorization:'Bearer '+process.env.UAG_ENGINE_SERVER_KEY}}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "packages/engine-server/bin/uag-engines.js"]
