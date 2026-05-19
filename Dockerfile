FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY superstars.json ./
COPY bin ./bin
COPY lib ./lib
COPY sql ./sql

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "./bin/server.mjs"]
