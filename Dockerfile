FROM node:20-alpine
COPY src/ /app/src/
COPY module/ /app/module/
COPY index.ts /app/
COPY package.json /app/
COPY tsconfig.json /app/
WORKDIR /app
RUN apk update && \
    apk upgrade && \
    apk add make && \
    apk add python3 && \
    apk add g++ && \
    apk add git
RUN yarn
RUN yarn build
RUN apk del git g++ make python3
ENTRYPOINT [ "yarn", "start" ]
