FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --include=dev
COPY . .
RUN npm run db:generate && npm run build
RUN mkdir -p /app/.data/private && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 NEXO_WEB_DIST=/app/apps/web/dist STORAGE_DIR=/app/.data/private
EXPOSE 3001
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
