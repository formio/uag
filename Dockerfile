# syntax=docker/dockerfile:1
# formio/uag: the UAG with every official engine (jev, claude, openai, grok,
# gemini). Each engine is its own npm package with its own provider SDK;
# UAG_ENGINES decides which run, and none does until it is named. For an image
# with fewer engines, see "Building a smaller image" in the README.

# Build stage
# Node 24, not node:lts: Node 25 and later images ship without corepack,
# which installs the Yarn version package.json names.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/engine-sdk/package.json packages/engine-sdk/
COPY packages/engine-server/package.json packages/engine-server/
COPY packages/uag-js/package.json packages/uag-js/
COPY engines/jev/package.json engines/jev/
COPY engines/claude/package.json engines/claude/
COPY engines/openai/package.json engines/openai/
COPY engines/grok/package.json engines/grok/
COPY engines/gemini/package.json engines/gemini/
# Not released (MAI is in preview): only its manifest, which the lockfile lists.
COPY engines/mai/package.json engines/mai/
# The demo site is a workspace too; its manifest is in the lockfile.
COPY demo/package.json demo/
RUN apk upgrade --no-cache && apk add --no-cache make python3 g++ git && corepack enable && yarn install --immutable
COPY src/ ./src/
COPY module/ ./module/
COPY bin/ ./bin/
COPY packages/engine-sdk/ ./packages/engine-sdk/
COPY engines/ ./engines/
COPY index.js tsconfig.json ./
RUN yarn run build
# Production dependencies only: the UAG and the official engines. The engine
# server is a separate image (formio/uag-engines), so it is left out.
RUN yarn workspaces focus --production @formio/uag @formio/uag-jev @formio/uag-claude @formio/uag-openai \
      @formio/uag-grok @formio/uag-gemini

# Production stage
FROM node:24-alpine
RUN apk upgrade --no-cache && npm install -g npm@latest
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/module ./module
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/index.js ./
# The engine packages, which node_modules links to.
COPY --from=builder /app/packages/engine-sdk ./packages/engine-sdk
COPY --from=builder /app/engines ./engines
# The UAG listens only once its project, engines and database are ready, and
# /status needs no credential, so a 200 means it is serving.
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "--no-node-snapshot", "index.js"]
