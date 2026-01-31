FROM node:24-alpine
COPY index.js /app/
COPY auth.js /app/
COPY commands/ /app/commands
COPY package.json /app/
WORKDIR /app
RUN apk update && \
    apk upgrade && \
    apk add make && \
    apk add python3 && \
    apk add g++ && \
    apk add git
RUN yarn
RUN apk del git g++ make python3
ENTRYPOINT [ "node", "index.js" ]