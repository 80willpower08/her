FROM node:22-alpine AS base
RUN apk add --no-cache wget openssl
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

FROM base AS deps
COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --no-frozen-lockfile

FROM deps AS dev
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
WORKDIR /app/apps/api
RUN pnpm exec prisma generate
EXPOSE 3001
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm dev"]
