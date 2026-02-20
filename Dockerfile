# syntax=docker/dockerfile:1
# Build stage
FROM node:lts-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock* ./
RUN apk add --no-cache make python3 g++ git && yarn install
COPY src/ ./src/
COPY module/ ./module/
COPY index.js tsconfig.json ./
RUN yarn run build

# Production stage
FROM node:lts-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/module ./module
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/index.js ./
ENTRYPOINT ["node", "--no-node-snapshot", "index.js"]
