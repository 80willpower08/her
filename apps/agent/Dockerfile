FROM node:22-alpine
RUN apk add --no-cache bash git ripgrep
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

# Install Claude Code globally so `claude` is on PATH for spawn().
RUN npm install -g @anthropic-ai/claude-code

COPY pnpm-workspace.yaml package.json .npmrc ./
COPY apps/agent/package.json ./apps/agent/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --no-frozen-lockfile

COPY apps/agent ./apps/agent
COPY packages/shared ./packages/shared

# CLAUDE.md and .claude/ live at /app/agent-workspace so the agent CLI
# treats it as the project root for skills + settings discovery.
RUN mkdir -p /app/agent-workspace
RUN cp /app/apps/agent/CLAUDE.md /app/agent-workspace/CLAUDE.md
RUN cp -r /app/apps/agent/.claude /app/agent-workspace/.claude

WORKDIR /app/apps/agent
CMD ["pnpm", "dev"]
