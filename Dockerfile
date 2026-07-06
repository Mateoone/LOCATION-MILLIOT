# Image Cloud Run : build Vite puis service statique via express (server.mjs).
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
