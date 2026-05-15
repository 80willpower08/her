# Architecture — Personal Time-Keeper

**Status:** Draft 1
**Last updated:** 2026-05-05
**Successor to:** `archive-v1-task-companion/` (creature/DNA gamified to-do)

---

## 1. Goals & non-goals

### Goals
- **AI agent acts with end goals in mind.** Categories → Goals → Tasks → Subtasks, with prerequisites. The agent treats the goal hierarchy as the source of truth for "what matters."
- **Multi-source awareness.** Ingest from Google Calendar, two Outlook work accounts, Google Drive (scoped folders), Gmail. Optionally texts (see §5 caveat).
- **Real-time push notifications and reminders.** Mobile + desktop, with quiet hours and per-category controls.
- **Mobile + desktop, offline-tolerant.** PWA covers both. Brief offline windows are normal; sync resumes when online.
- **User stays in charge.** Every agent action is bounded by user-defined policies. The user can block, override, annotate, and discuss in real time without the agent silently routing around them.
- **Container-deployable on TrueNAS Scale Fangtooth** as a custom app.

### Non-goals (for v1)
- Multi-tenant SaaS. This is a single-user product (you), with a schema that doesn't preclude multi-user later.
- Replicating Notion/Todoist UX. Intuitive **for you** > generic familiarity.
- Building our own LLM. We use Claude API, with a swap layer for local models later.

---

## 2. Resolved facts & remaining questions

### Resolved (2026-05-05)

| Topic | Answer |
|---|---|
| **The 4 accounts** | 1 personal Gmail (= Calendar + Drive + Sheets/Docs, single Google grant), 1 personal Outlook, 2 work Outlook |
| **Outlook tenancy** | 3 separate Outlook contexts. Personal is consumer (live.com / outlook.com). The two work accounts are separate enterprise tenants, each its own Entra ID. |
| **One work Outlook is locked down** | Likely Conditional Access / blocked third-party OAuth apps. ICS-subscribe fallback designed in §5.2. |
| **Phone** | Android. Web Push reliable; SMS ingestion feasible via Tasker/MacroDroid → webhook. |
| **Cloudflare Tunnel** | User has tunnel infra on a dedicated routing server. We just register a DNS entry; no `cloudflared` container in our stack. |

### Still open

| # | Question | Why it matters | Blocks |
|---|---|---|---|
| Q5 | TrueNAS hardware: GPU or 32GB+ RAM available for an optional local-model container? | Decides whether we can run a local LLM fallback (Haiku-tier triage) to reduce Claude spend. | Phase 8 |
| Q6 | Email/calendar bodies — encrypted at rest at the column level, or trust full-disk encryption on the NAS? | Column-level adds complexity but limits blast radius if the DB ever leaks. | Phase 0 (schema) |
| Q7 | SMS ingestion priority — must-have, nice-to-have, skip? | Drives whether Phase 8 builds the Android forwarder. | Phase 8 |
| Q8 | For the locked-down work Outlook: can you publish your calendar as ICS in Outlook Web (Settings → Calendar → Shared calendars → Publish)? Many tenants block this too. | If ICS publish is blocked, that account is effectively read-only via manual export, or skipped. | Phase 5 |

Q6 has a sensible default (disk-level only for v1, revisit if the threat model changes) — we'll proceed with that unless you want column-level now. Q5, Q7, Q8 can be answered later; they don't block Phases 0–4.

---

## 3. Service topology

Six containers on TrueNAS, all behind a reverse proxy:

```
┌─────────────────────────────────────────────────────────────┐
│  Reverse proxy (Caddy or Traefik)  ── public TLS + auth     │
└─────────────────────────────────────────────────────────────┘
       │
       ├── api          (Fastify + Prisma; REST + WebSocket)
       ├── web          (PWA bundle; Vite-built static + SW)
       ├── worker       (BullMQ consumers: ingestion, push dispatch)
       ├── agent        (long-lived process; Claude API calls + tool exec)
       ├── postgres     (single DB; pgcrypto extension)
       └── redis        (BullMQ queue + ephemeral pub/sub)
```

**Why split `api` from `agent` from `worker`:**
- Crash isolation. Agent loop crashing should not take down the API serving the UI.
- Resource isolation. Agent is bursty (long Claude calls); ingestion is steady; API needs predictable latency.
- Permission isolation. The agent runs with a more-restricted DB role than the API.

**Why a worker AND an agent:**
- Worker = deterministic, scheduled, no-LLM jobs (poll calendar, send a push, refresh OAuth tokens).
- Agent = LLM-driven decisions. Worker enqueues "agent-needed" jobs to a separate queue the agent consumes.

⚠️ **DECISION D1:** Picking **Fastify** over Express. Faster, schema-validation built in, better TypeScript story. Old project used Express; we're starting clean so this is a free upgrade.

⚠️ **DECISION D2:** **Caddy** as reverse proxy. Auto-HTTPS, simpler config than Traefik for a single-app deploy.

---

## 4. Data model

Trimmed Prisma + new domain tables. Names indicative; full schema written when we cut code.

### 4.1 Kept from v1 (cleaned)
- `User`, `UserSettings` — strip widget/creature fields; keep notification & AI prefs.
- `Task`, `TaskHistory`, `TaskPrerequisite` — keep as-is.
- `Goal`, `Milestone`, `GoalTask`, `GoalRelationship`, `GoalCategory` — keep as-is.
- `CategoryXP` — repurpose as **time-spent / progress per category** (drop "XP" framing). Same shape, new meaning.
- `AIContext` — replaced by `AgentRun` + `Conversation` (below).

### 4.2 Dropped
- `Creature`, `GrowthEvent`, `CreatureStage` enum — gone.
- `Consequence` — gone (was creature-tied).
- XP fields on Task (`xpValue`, `streakCount` for XP) — keep `streakCount` if you want recurring-task streaks visible, but no XP math.

### 4.3 New tables

| Table | Purpose |
|---|---|
| `ExternalAccount` | OAuth-connected provider account (Google / Microsoft). One row per (user, provider, account_email). Stores access/refresh tokens encrypted. |
| `CalendarEvent` | Normalized event from any calendar source. References `ExternalAccount`. Source ID kept for re-sync. |
| `EmailMessage` | Optional ingested email summary + metadata (NOT full body unless flagged important). |
| `DriveDocument` | Pointer to a watched Drive doc + last-known summary. |
| `IngestionRun` | Audit log: which source, when, items pulled, errors. |
| `Agent` | Configurable agent profile (name, role, tools, policies). Multi-agent support from day one. |
| `AgentRun` | Single agent invocation: input context, tools called, decision, outcome, cost (tokens). |
| `Conversation` | Threads attached to tasks/events/emails. Messages: user notes, user questions, agent replies, agent actions. |
| `Policy` | User-defined constraint rules (block lists, auto-approval thresholds, quiet hours). |
| `Notification` | Outbound notification record (channel, payload, sent/ack status). |
| `Device` | Registered push subscriptions (Web Push endpoints, optional FCM/APNs later). |

### 4.4 Provenance & context-pollution mitigation

Every fact the agent uses is tied to a **source record** (`CalendarEvent.id`, `EmailMessage.id`, `Conversation.message.id`, `Task.id`). When the agent makes a decision, the `AgentRun` row stores the exact set of source records used. This gives:
- Audit trail ("why did you reschedule this?")
- Reproducibility (re-run with the same inputs)
- Bias control (we can see if the agent over-weights one source)

No agent ever gets a freeform "everything from the last week" context dump. **Context is curated per call, structured, with token budgets enforced at the agent layer.** See §6.

---

## 5. External integrations

| Source | API | OAuth scope (minimum) | Webhook/poll | Notes |
|---|---|---|---|---|
| Google (Calendar + Drive + Gmail + Sheets/Docs) | Calendar API v3, Drive API v3, Gmail API | `calendar.events`, `drive.readonly` (folder-scoped), `gmail.readonly` + label filter | Watch channels for Calendar; Drive Changes API; Gmail watch via Pub/Sub | **One** OAuth grant covers all of these for the personal Gmail account. |
| Personal Outlook | Microsoft Graph (consumer endpoint) | `Calendars.ReadWrite`, `Mail.Read` | Subscriptions (webhook) | App registration: "Personal Microsoft accounts" audience. |
| Work Outlook A (open tenant) | Microsoft Graph | `Calendars.ReadWrite`, `Mail.Read` | Subscriptions | Multi-tenant app registration, user-grants own consent. |
| Work Outlook B (locked-down tenant) | **ICS fallback** (probably) | — | Poll public ICS URL every 15 min | See §5.2. |
| SMS (Android) | Tasker/MacroDroid → webhook | — | Push to `/api/ingest/sms` | Phase 8. |

### 5.1 Google — single OAuth grant for everything personal

Because your personal Gmail is also the Drive/Sheets/Docs/Calendar account, we register **one** Google OAuth app and request all needed scopes in one consent screen. This means Google's verification process applies if we ever publish — but in personal "Testing mode" with you whitelisted, no verification needed.

Drive scope is narrowed using the **Drive Picker** at connect time: you pick specific folders, we store their IDs, and we only ever read those. Avoids "this app wants access to all your Drive files" anxiety.

### 5.2 Locked-down work Outlook — strategy

You called this out: "1 outlook account may be a bit harder to access as they are typically a bit more locked down." This is real. Enterprise tenants commonly block:
- **Third-party OAuth apps** (Conditional Access policy: only managed apps can call Graph)
- **Mail.Read for non-managed clients** (DLP policy)
- **Token issuance from non-compliant devices** (your TrueNAS server isn't enrolled in Intune)

A practical fallback ladder, try in order:

1. **Try the OAuth path first.** Some "locked-down" tenants still allow `Calendars.Read` for personal use. Cost is 5 minutes — register the app, click consent, see if the tenant rejects you.
2. **Outlook Web ICS publish.** In OWA → Settings → Calendar → Shared calendars → Publish a calendar → choose "Can view all details" → copy the **ICS URL**. We poll that URL every 15 min. **Read-only**, calendar only, no email, no two-way write — but it works under most policies. **Q8** asks whether your tenant allows this.
3. **Manual ICS export.** Periodic export to a Drive folder we already watch. Brittle, but works under any policy.
4. **Skip that account.** Live with not seeing it in the unified view.

Recommendation: build OAuth path generically; for the locked tenant, add an `ExternalAccount.kind = 'ICS_URL'` variant so the same `CalendarEvent` table is fed by either OAuth ingestion or an ICS poller. Same downstream code regardless of source.

⚠️ **DECISION D8:** Support both `ExternalAccount.kind = 'OAUTH'` and `ExternalAccount.kind = 'ICS_URL'` from Phase 5. Same `CalendarEvent` schema; different ingestion path.

### 5.3 SMS on Android

You're on Android, so SMS is feasible without third-party services. **Tasker** ($3.99) or **MacroDroid** (free) can match incoming SMS by sender/keyword and POST to a webhook. We expose `POST /api/ingest/sms` (token-authed) and the agent can triage like any other inbound source.

This is Phase 8. Not blocking earlier work.

### 5.4 OAuth flow (general)

- Each provider connection is a row in `ExternalAccount` (`kind=OAUTH`).
- Server-side OAuth — no tokens in the browser ever. Refresh tokens encrypted at rest using a key from `.env`.
- The PWA calls `/api/accounts/connect/:provider` → 302 to provider → callback → tokens stored → user returned to app.
- Connection status visible in app settings: green/yellow/red per account, with "last successful poll" timestamp.

⚠️ **DECISION D3 (revised):** Google OAuth in **Testing mode** with you whitelisted — no app verification needed for single-user. Microsoft Graph: register a **multi-tenant app** so the same app reg can grant against your personal Outlook AND each work tenant separately.

### 5.2 OAuth flow

- Each provider connection is a row in `ExternalAccount`.
- We use **server-side OAuth** (no tokens in the browser ever). Refresh tokens encrypted at rest with a key from `.env` (env-injected, not in DB).
- The PWA calls `/api/accounts/connect/:provider` → 302 to provider → callback → tokens stored → user returned to app.
- Connection status visible in app settings: green/yellow/red per account.

⚠️ **DECISION D3:** Google requires **app verification** for sensitive scopes (Gmail). For a personal-use single-user app, **publish as "internal" via Google Workspace** (if you have one) or stay in **"Testing" mode** with your account whitelisted. Verification is paperwork-heavy and we don't need it. This means: if you don't have Workspace, you'll add yourself as a test user manually in the Google Cloud Console.

---

## 6. Agent system

This is the section that earns the project. Designed around your three explicit asks: **control**, **shifting priorities**, **no context pollution**.

### 6.1 Agent topology — one orchestrator + specialists

```
                    ┌──────────────────┐
                    │   Orchestrator   │  ← the "time-keeper"
                    │   (Claude Opus)  │     reads structured summaries only
                    └────────┬─────────┘
                             │ delegates
        ┌──────────┬─────────┼─────────┬──────────┐
        ▼          ▼         ▼         ▼          ▼
    ┌───────┐  ┌───────┐ ┌───────┐ ┌────────┐ ┌────────┐
    │ Email │  │Calendar│ │ Task  │ │ Drive  │ │  Chat  │
    │Triage │  │Conflict│ │ Prio  │ │Summary │ │  with  │
    │       │  │Resolver│ │       │ │        │ │  user  │
    └───────┘  └───────┘ └───────┘ └────────┘ └────────┘
    Sonnet      Sonnet    Sonnet    Haiku      Opus
```

**Why specialists:**
- **Context isolation.** Email Triage sees raw email. Orchestrator never does — it sees Triage's structured output only. Email content cannot pollute high-level prioritization decisions.
- **Cost.** Cheap models (Haiku) handle bulk summarization; Opus only does the planning that needs reasoning.
- **Independent failure.** A flaky email summary doesn't break the scheduler.

Each specialist has:
- A fixed **role description** (system prompt).
- A **tool whitelist** (what DB operations it can do).
- A **context budget** (max tokens it can pull in per call; enforced server-side, not by the prompt).
- A **personality/policy bundle** the user edits in the app.

### 6.2 Three execution modes per action

For every kind of action an agent can take, the user picks the mode:

| Mode | Behavior |
|---|---|
| **AUTO** | Agent executes immediately. Logged. Notification optional. |
| **REVIEW** | Agent stages the action; user gets a push with [Approve] / [Modify] / [Deny] buttons. |
| **ASK** | Agent must open a conversation thread and get explicit confirmation before acting. |

Defaults (editable):
- Summarize email → AUTO
- Reschedule own calendar event → REVIEW
- Decline a meeting → ASK
- Reply to email → ASK (always)
- Create task → AUTO
- Delete task → REVIEW
- Reorder priorities → AUTO with notification

### 6.3 Policy / Block primitives

Stored in `Policy` table. Each policy is a constraint the agent layer evaluates before letting any action through. Examples in plain English (with how they translate):

| User says | Policy |
|---|---|
| "Don't reschedule any work calendar event without asking" | scope: action=reschedule, source=outlook-work-* → mode=ASK |
| "Never let any agent touch tasks tagged 'sensitive'" | scope: tag=sensitive → mode=ASK, all actions |
| "No notifications between 11pm and 6am unless P1" | scope: time=23:00-06:00, priority<P1 → suppress |
| "Triage agent can't read emails from `boss@company.com`" | scope: agent=triage, sender match → exclude |
| "Don't act on anything from Outlook account B during PTO 5/15-5/22" | scope: source=outlook-b, daterange → suppress agent actions |

These are first-class data, not prompt strings. The agent runtime checks them; the LLM doesn't have to "remember" them.

⚠️ **DECISION D4:** Policy DSL stays in DB (structured), with a "describe in English" UI that converts to JSON. We do **not** rely on the LLM to obey rules expressed in its system prompt — those leak. We enforce in code at the action gateway.

### 6.4 Real-time annotation & discussion

Every primary entity (Task, Goal, CalendarEvent, ingested EmailSummary, AgentRun decision) has a **Conversation** thread.

Three message kinds:
- **Note** — user thinking aloud. Agent reads as background context only; never triggers a response.
- **Question** — agent must reply. Triggers an `AgentRun`.
- **Instruction** — user telling the agent how to handle this. Stored as a soft constraint scoped to that entity.

UI surfaces:
- Tap a task → see its thread → comment.
- Push notification → tap → opens the relevant thread.
- Floating "talk to time-keeper" button → opens a top-level conversation routed to the Orchestrator.

### 6.5 Shifting priorities mid-day

When new info comes in (urgent email, calendar invite, slipped task), the **Prioritization** specialist runs. Output is a re-ranked task list with diffs:

```
↑ "Finish Q2 report"   (was #5, now #1)   — boss email arrived, deadline today
↓ "Read Drive doc"     (was #1, now #6)   — no urgency signals
+ "Call dentist back"  (new)              — voicemail summary from Gmail
```

User sees this as a notification with the diff. Modes:
- AUTO mode: list reorders, you see what changed.
- REVIEW mode: diff stays staged until you approve (default for reorderings that change top 3).

### 6.6 Context-pollution defenses (concrete)

| Risk | Defense |
|---|---|
| Old conversations bleed into new decisions | Per-`AgentRun` context is rebuilt from DB each call. No "long-running chat history" by default. |
| Agent over-anchors on whichever source it read first | Specialists only see one source kind. Orchestrator gets structured summaries with explicit weights. |
| Stale facts dominate fresh ones | Every fact has a `recordedAt`. The context builder favors recency unless user pinned it. |
| Notes the user wrote as venting get treated as instructions | Message kind (`Note` vs `Instruction`) is a hard distinction in code, not vibes. |
| User sees one bad decision and loses trust | Every `AgentRun` shows: inputs used, prompt, model, decision, cost. Clickable from the app. |

---

## 7. Notifications

- **Web Push (VAPID)** for the PWA. Works on Android, desktop Chrome/Edge/Firefox, and iOS 16.4+ (installed PWAs only).
- Each device registers its push endpoint → `Device` table.
- The `worker` dispatches notifications via Web Push protocol; failures retried with backoff.
- Optional fallback channel: **ntfy.sh** (self-hosted on TrueNAS for free; great mobile app). Useful when iOS PWA push is unreliable.
- **Quiet hours** and **per-category mute** enforced at dispatch time, sourced from `Policy`.

⚠️ **DECISION D5:** Self-host **ntfy** as a 7th container. Cheap, removes dependency on Web Push working perfectly on iOS, gives you a great mobile app you'll actually trust. Web Push remains primary; ntfy is the always-works fallback.

---

## 8. Offline & sync

PWA strategy:
- **IndexedDB** mirrors a slice of the user's data (tasks, today+tomorrow events, recent notifications, conversation threads).
- **Service Worker** intercepts API calls when offline → queues mutations.
- **Sync queue** drains on reconnect; conflicts resolved via **last-write-wins** with a `version` column on each entity. Rare for personal data; LWW is enough.
- Agent decisions are **never made offline.** If the user takes an offline action that needs the agent, it's queued and dispatched when online. UI shows "queued" state.

⚠️ **DECISION D6:** Last-write-wins, not CRDTs. Personal-use single-user app — concurrent edits are vanishingly rare. CRDTs are overkill.

---

## 9. UX principles

These are anti-goals as much as goals — surfacing them so we say no to features that violate them.

1. **Glanceable.** A single screen answers "what's next, what's late, what's the agent thinking." No drilling required for the 80% case.
2. **Block before you do.** Every agent action surface has an inline "block this kind of thing" affordance, not buried in settings. Frictionless control.
3. **Notes ≠ instructions.** Two different input affordances. You should never accidentally instruct the agent by venting in a comment.
4. **Provenance always one tap away.** "Why did you do that?" → tap the agent decision → see inputs.
5. **Quiet by default.** Notifications only for things the user marked as worth being interrupted for. Everything else stacks in the app.
6. **Touch the agent or don't.** Modes for engagement: full conversation, approve/deny prompts, or fully silent automation. User flips per-category.

---

## 10. TrueNAS deploy

You've shipped two custom apps already, so just notes:
- Single Compose file → custom app via TrueNAS Apps catalog.
- Persistent volumes: `postgres-data`, `redis-data`, `agent-state` (for agent's working files), `web-static`.
- Required env vars: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_OAUTH_CLIENT_*`, `MS_OAUTH_CLIENT_*`, `VAPID_KEYS`, `ENCRYPTION_KEY` (for OAuth tokens at rest), `JWT_SECRET`.
- **Reverse proxy:** No `cloudflared` container in our stack. You have a dedicated routing server with a Cloudflare Tunnel already; we just add a hostname entry pointing at the TrueNAS IP + port for the `web` and `api` containers. Internal-only Caddy still useful for routing `web`/`api`/`ntfy` behind a single internal hostname.

⚠️ **DECISION D7 (revised):** Reuse existing Cloudflare Tunnel infrastructure. We expose internal HTTP via Caddy on the TrueNAS box; the tunnel server takes care of public TLS and Cloudflare Access policies (which can also gate the app behind your Cloudflare auth — a free extra layer).

---

## 11. Phased build plan

Each phase is shippable on its own — you can stop at any phase and have a useful tool.

### Phase 0 — Skeleton (1-2 days)
- Repo structure, Compose file with all 7 containers (no app logic yet).
- Postgres + Prisma schema for kept tables only.
- Hello-world API + PWA serving with auth (single-user JWT).
- Reverse proxy in front, runs locally.

### Phase 1 — Tasks/goals (2-3 days)
- Port the v1 task/goal/category/prerequisite logic, cleaned.
- New PWA UI: list view, today view, goal hierarchy view. **Skip the graph view entirely** for v1 — it was the bug magnet.
- Conversations on tasks (notes only, no agent yet).

### Phase 2 — First external source (2-3 days)
- Google Calendar OAuth + ingestion + display in a unified timeline.
- This is the **vertical-slice validation**: we exercise OAuth, ingestion, sync, and offline display end to end with the easiest provider.

### Phase 3 — Push (1-2 days)
- Web Push + VAPID + `Device` registration.
- ntfy fallback container.
- Quiet hours / mute policies.

### Phase 4 — First agent (3-4 days)
- Claude API integration.
- Single Orchestrator agent, no specialists yet.
- Action modes (AUTO/REVIEW/ASK).
- Policy enforcement at action gateway.
- Conversation thread on a task → agent responds.
- One workflow: "given today's events + tasks, propose a daily plan."

### Phase 5 — Specialists & remaining sources (1 week)
- Outlook ×2, Drive, Gmail integrations.
- Email Triage, Calendar Conflict, Prioritization specialists.
- Provenance UI (click any decision → see inputs).

### Phase 6 — Mobile install + offline polish (2-3 days)
- PWA manifest, service worker, IndexedDB mirror, sync queue.
- Test on actual phone.

### Phase 7 — TrueNAS deploy + Cloudflare Tunnel (1 day)
- Deploy the same Compose to NAS.
- Switch DNS / tunnel.

### Phase 8+ — As needed
- Local-model swap layer (depends on Q5).
- Texts integration (depends on Q4/Q7).
- More specialist agents.
- Advanced visualizations (revisit graph view if you miss it).

---

## 12. Decisions register

| ID | Decision | Status |
|---|---|---|
| D1 | Fastify over Express | ✅ Adopted |
| D2 | Caddy over Traefik | ✅ Adopted |
| D3 | Google OAuth in Testing mode w/ self as test user | ✅ Adopted (revisit if multi-user later) |
| D4 | Policy DSL in DB, enforced in code, not in LLM prompts | ✅ Adopted |
| D5 | Self-host ntfy as fallback push | ✅ Adopted |
| D6 | Last-write-wins for offline sync | ✅ Adopted |
| D7 | Reuse existing Cloudflare Tunnel infra (no `cloudflared` container) | ✅ Adopted |
| D8 | `ExternalAccount` supports both `OAUTH` and `ICS_URL` ingestion paths | ✅ Adopted |

## 13. Questions register

| ID | Question | Status | Blocks phase |
|---|---|---|---|
| Q1 | What is the 4th calendar? | ✅ Resolved: 1 Gmail + 1 personal Outlook + 2 work Outlook | — |
| Q2 | Outlook accounts — same tenant or different? | ✅ Resolved: 3 separate contexts, multi-tenant app reg | — |
| Q3 | Google Calendar account == Drive/Gmail account? | ✅ Resolved: yes, single Google grant | — |
| Q4 | iPhone or Android? | ✅ Resolved: Android | — |
| Q5 | TrueNAS GPU/RAM for local model? | 🟡 Open | Phase 8 |
| Q6 | At-rest column encryption needed beyond disk encryption? | 🟡 Open (default: disk-only for v1) | Phase 0 schema (low-risk default) |
| Q7 | SMS ingestion — must-have, nice-to-have, skip? | 🟡 Open | Phase 8 |
| Q8 | Locked-down work Outlook — does the tenant allow ICS publish? | 🟡 Open | Phase 5 |
