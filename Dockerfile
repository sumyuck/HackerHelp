FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Curated knowledge base, so `node dist/scripts/ingest-knowledge.js` works inside the container.
COPY knowledge/ ./knowledge/
USER node
EXPOSE 3000
# Run node directly (not via npm) so SIGTERM reaches the process for graceful shutdown.
CMD ["node", "dist/index.js"]
