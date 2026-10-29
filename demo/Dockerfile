# syntax=docker/dockerfile:1
# formio/uag-demo: the UAG demo site, which can run its flow proxy inside it,
# and the setup job (see docker-compose.yml). Build from the repository root:
#
#   docker build -f demo/Dockerfile -t formio/uag-demo .
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
COPY engines/mai/package.json engines/mai/
COPY demo/package.json demo/
# Only the demo's own dependencies: none of the UAG's packages are installed.
RUN apk upgrade --no-cache && corepack enable && yarn workspaces focus --production @formio/uag-demo
COPY demo/ demo/
COPY packages/uag-js/ packages/uag-js/

FROM node:24-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/demo ./demo
COPY --from=builder /app/packages/uag-js ./packages/uag-js
WORKDIR /app/demo
ENV NODE_ENV=production PORT=8080 RENDERER_DIR=/app/packages/uag-js
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
