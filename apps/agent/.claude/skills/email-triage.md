---
name: email-triage
description: Triage recent inbound items — auto-ingested emails and manually-shared messages. Surface what matters, propose follow-up tasks for actionable items, link to upcoming events when the email is meeting context, and silently note the rest. Pending shares are user-flagged signals — treat them as high priority.
---

# Email triage

Your job for this invocation: read `recentMessages` in the input context and propose concrete actions for each item that warrants attention. The user surfaced these messages — either by sharing them manually (`source: SHARED`, often `triageStatus: PENDING`) or by letting them flow in via Gmail/Outlook ingestion. Both signals matter. Pending shares matter most because the user explicitly chose them.

## Output

You record actions via MCP tools, not free-form text. End every run with `record_run_summary`.

## Triggers

For each entry in `recentMessages`, decide one of:

| Signal | Action |
|---|---|
| Pending share, clearly actionable ("can you review", "approve", "send by Friday") | `propose_create_task` with title from the email subject; if it references a meeting on `upcomingEvents`, set `linkedCalendarEventId` |
| Pending share, informational only (FYI, status update) | `propose_post_note` on a related task or goal if obvious; otherwise skip |
| Ingested email about an upcoming event (calendar invite, agenda, prep request) | `propose_link_task_to_event` if a related task already exists; otherwise `propose_create_task` linked to the event |
| Important-flagged or starred ingested email with action language | `propose_create_task` |
| Newsletter / automated / promotional content | Skip (no action) |
| Already triaged (`triageStatus` not in `NONE`/`PENDING`) | Skip — the user already decided |

## Provenance is mandatory

Every action's `rationale` must reference:
- The message subject or sender (e.g., "From bob@example.com: 'Need approval on Q3 budget'")
- The `accountLabel` if present (e.g., "Work — PDS account")
- Why this action and not another

Do **not** use POST_NOTE as a catch-all. If the email implies a task, propose CREATE_TASK. Pending shares the user surfaced are an explicit signal that they want this in their plan — convert them.

## Hard rules

- Every action requires `agentRunId` (given in the prompt).
- Never invent message IDs, account IDs, or category IDs — only use values from the input.
- For CREATE_TASK from a shared item, include the message's `sourceUrl` (when present) in the task description so the user can jump back to the source. Format: `Source: <url>`.
- If a pending share has no clear action and no obvious goal/task to attach to, propose POST_NOTE on the highest-weight active goal with a one-line summary, or just record it in observations. The user won't lose it — it stays as `triageStatus: PENDING` until they triage in the UI.
- Don't propose duplicates. If you've already proposed a task for a message, move on.

## Tone

Same as prioritization: direct, signal-first, no preamble. The user will see your rationale on every proposal — make it count.

## Example

Input contains:

```
recentMessages: [
  { id: m1, source: "SHARED", triageStatus: "PENDING", subject: "Re: vendor renewal — need sign-off by EOW",
    fromAddress: "vendor@x.com", accountLabel: "Work — PDS", sourceUrl: "https://outlook.../msg/abc" },
  { id: m2, source: "GMAIL", triageStatus: "NONE", subject: "Your weekly Substack digest", isImportant: false },
  { id: m3, source: "SHARED", triageStatus: "PENDING", subject: "Prep doc for tomorrow's PDS x Quantum sync",
    accountLabel: "Work — PDS", sourceUrl: "https://outlook.../msg/def" }
]
upcomingEvents: [
  { id: e1, title: "PDS x Quantum weekly sync", startsAt: "2026-05-13T14:00" }
]
```

Right answer (2 actions, skip the newsletter):

- `propose_create_task` for m1: title "Sign off vendor renewal", weight 7, due EOW, body referencing source URL. Rationale: "Pending share from Work — PDS, vendor@x.com, explicit deadline 'by EOW'. User flagged this for triage."
- `propose_create_task` for m3, with `linkedCalendarEventId: e1`. Rationale: "Pending share names 'PDS x Quantum sync' which matches upcoming event e1. Linking so the prep stays attached to the meeting."
- m2 (newsletter) — skip silently.

Two concrete actions, zero churn. Don't over-propose.
