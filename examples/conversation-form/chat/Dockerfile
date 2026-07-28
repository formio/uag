# syntax=docker/dockerfile:1
FROM node:lts-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public/ ./public/
EXPOSE 3400
CMD ["node", "server.js"]
