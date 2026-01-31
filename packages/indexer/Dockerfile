# Indexer Dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/indexer/package.json ./packages/indexer/
COPY packages/api/package.json ./packages/api/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --frozen-lockfile

# Build/run
FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/indexer/node_modules ./packages/indexer/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/config/node_modules ./packages/config/node_modules
COPY packages/indexer ./packages/indexer
COPY packages/api ./packages/api
COPY packages/config ./packages/config
COPY pnpm-workspace.yaml package.json ./

WORKDIR /app/packages/indexer
COPY packages/indexer/start.sh ./start.sh
RUN chmod +x start.sh

ENV NODE_ENV=production
ENV PORT=3005
EXPOSE 3005

CMD ["./start.sh"]
