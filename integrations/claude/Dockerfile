# syntax=docker/dockerfile:1
# Build stage
FROM node:lts-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN apk add --no-cache make python3 g++ git && yarn install

# Production stage
FROM node:lts-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY index.js auth.js ./
COPY commands/ ./commands/
ENTRYPOINT ["node", "index.js"]