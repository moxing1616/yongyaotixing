FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p data && chown node:node data
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 3001
VOLUME ["/app/data"]
CMD ["node", "server/index.mjs"]
