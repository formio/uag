FROM node:24-alpine
COPY src/ /app/src/
COPY module/ /app/module/
COPY index.ts /app/
COPY package.json /app/
COPY tsconfig.json /app/
WORKDIR /app
RUN apk update && apk upgrade
RUN yarn
RUN yarn build
ENTRYPOINT [ "yarn", "start" ]
