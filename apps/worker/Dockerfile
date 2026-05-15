FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --no-frozen-lockfile

COPY apps/worker ./apps/worker
COPY packages/shared ./packages/shared
WORKDIR /app/apps/worker
CMD ["pnpm", "dev"]
