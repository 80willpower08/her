FROM node:22-bookworm-slim

# Runtime deps. Bookworm-slim (glibc) instead of Alpine (musl) — Claude Code's
# Ink-based TUI has been observed to hang silently on Alpine inside docker
# exec, even with proper TTY. Matches the working home-incident-manager
# image base. Cost: ~80MB larger; worth it for reliability.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# Persistent HOME on a single volume mount at /data. Claude reads its auth
# state from $HOME/.claude/.credentials.json + $HOME/.claude.json, so this
# one mount covers both files cleanly across container recreates. Pattern
# borrowed from the working home-incident-manager image.
ENV HOME=/data/home
RUN mkdir -p /data/home/.claude

WORKDIR /app/apps/agent
CMD ["sh", "-c", "mkdir -p $HOME/.claude && pnpm dev"]
