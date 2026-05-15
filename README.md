# her

Personal AI life-keeper. A self-hosted Claude-Code-powered agent that reads
your calendars, emails, sheets, and other apps, then helps you keep track of
goals, tasks, projects, and the rhythm of your days.

Runs as a Docker stack on TrueNAS, reached via a Cloudflare Tunnel as a PWA
on desktop and mobile.

## What it does

| Surface | What's there |
|---|---|
| **Today** | Daily focus — calendar events for today + tasks due, with an agent-curated "what to focus on" card on top |
| **Plan** | Tree-organized planning surface — Today's tasks · All tasks · Goals · Projects (long-running narratives) · Categories |
| **Chat** | Multi-thread agent conversations. Anchored to a task / goal / project / event / message / category, or free-form. Pending agent proposals inline. |
| **Inbox** | Triage for ingested emails + manually-shared messages |
| **Dashboard** | KPI hero strip · goal-progress bars · category bubble chart + sparklines · 53-week streak grid · rhythm histograms (time-of-day, day-of-week) · agent approval rate by action kind · daily 1-5 energy rating · finance snapshot · auto-generated growth feed. About-me observations + patterns embedded as collapsibles. |

Plus:

- **Memory layer** — agent records durable observations about you (facts, preferences, commitments, patterns, insights, concerns) and respects them on every future run
- **Calendar sources, sheet sources, data sources** — register Google Sheets and arbitrary HTTP feeds from other self-hosted apps as read-only inputs the agent can reason over
- **Projects** — long-running narrative initiatives (claims, cases, searches) with markdown bodies the agent reads and updates. Paste-and-process import for bringing in external content; file attachments (PDF, DOCX, image OCR via Claude vision) supported.
- **Multi-account ingestion** — Google Calendar + Microsoft Calendar + Gmail. Cross-calendar dedup via iCalUid.

## Stack

| Container | What it is | Image source |
|---|---|---|
| **api** | Fastify + Prisma + JWT. REST + MCP server. | this repo |
| **web** | Vite + React + Tailwind + shadcn/ui. PWA. | this repo |
| **agent** | BullMQ consumer that shells out to `claude -p` for each agent run | this repo |
| **worker** | Cron/scheduling layer (calendar sync, daily agent run, reminders, sheet/data-source sync) | this repo |
| **postgres** | Persistence | `postgres:16-alpine` |
| **redis** | BullMQ queue | `redis:7-alpine` |
| **caddy** | Reverse proxy (TLS terminated upstream at Cloudflare Tunnel) | `caddy:2-alpine` |
| **ntfy** | Push-notification fallback | `binwiederhier/ntfy:latest` |

Container images for the four service apps are built by GitHub Actions on
every push to `main` and published to GHCR
(`ghcr.io/<owner>/her-{api,agent,worker,web}:latest`). TrueNAS pulls these
via `pull_policy: always`.

## Quick start (local development)

```bash
cp .env.example .env
# edit .env — fill in JWT_SECRET, ADMIN_PASSWORD_HASH, OAuth client IDs, etc.

pnpm install
pnpm hash-password 'your-password'     # paste output into ADMIN_PASSWORD_HASH

pnpm dev                                # docker compose up (foreground)

# open http://localhost:8080
```

The agent container uses your Claude Code subscription auth — run
`claude /login` on the host once before starting the stack so it picks up
the credentials from `~/.claude/`.

## Deployment

See [`DEPLOY.md`](DEPLOY.md) for the TrueNAS deployment flow:

1. Add OAuth redirect URIs to Google Cloud Console + Microsoft Entra
2. Drop [`deploy/truenas-stack.yml`](deploy/truenas-stack.yml) into TrueNAS Apps → Custom App
3. Set up the Cloudflare Tunnel ingress
4. Migrate Postgres + attachments from your dev machine (if applicable)

## Architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the design doc.

## Repo layout

```
.
├── README.md
├── ARCHITECTURE.md
├── DEPLOY.md
├── docker-compose.yml          # local dev
├── deploy/
│   └── truenas-stack.yml       # production
├── Caddyfile
├── .env.example
├── .github/workflows/
│   └── build-and-push.yml      # image builds → GHCR
├── apps/
│   ├── api/                    # Fastify + Prisma + MCP server
│   ├── web/                    # React + Tailwind + shadcn/ui
│   ├── worker/                 # BullMQ scheduling
│   └── agent/                  # claude -p shell + skills
└── packages/
    └── shared/                 # TS types shared between apps
```

## License

Personal project. Not currently published with an open-source license. Use
at your own discretion if you happen to find this useful.
