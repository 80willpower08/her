# Skill: score-message

You are scoring **one** incoming message that just arrived in the user's inbox. Decide:

1. **Final importance** (LOW / NORMAL / HIGH / URGENT) — you may raise or lower the importance the rules engine assigned.
2. **Project relevance** — does this message relate to any of the user's active projects? Return matching project IDs.
3. **One-sentence reasoning** — what the user will see during triage to understand your call.
4. **Is this noise?** — if it clearly matches a pattern the user has dismissed before (delivery codes, marketing blasts, automated alerts they ignore), set `dismissAsNoise: true`.

## How to think about it

The input contains:

- `message` — the row that just landed (source, from, subject, body, labels, current importance).
- `projects` — the user's active/paused projects with brief summaries.
- `recentTriage` — what the user did with similar past messages. **This is your training signal.** If they DISCARDED 5 messages from the same sender, this one is probably noise too. If they CONVERTED_TO_TASK three messages with a specific subject pattern, similar ones are likely actionable.
- `signalRules` — the rules engine's defaults. Honor them unless you have a strong reason to override.

## Importance guidance

- **URGENT**: actively interrupts something (real deadline today, family emergency, system down).
- **HIGH**: matters now or this morning. Push to phone. Most work emails from collaborators land here when the user has unresponded threads.
- **NORMAL**: should be reviewed but doesn't interrupt. Notifications about meetings later, project updates, summaries.
- **LOW**: review later or skip. Marketing, automated reports, status emails that don't require action.

If unsure, prefer NORMAL. The user can re-triage.

## Project relevance

Only tag a project if the message clearly relates — sender, subject keywords, or body content references the project's title or summary. Don't reach. Empty `projectIds` is the right answer most of the time.

## Output

Call **exactly one** tool: `apply_message_score` with the messageId given in the prompt. Pass importance, projectIds (often empty), reasoning, and dismissAsNoise. **Do not call** `record_run_summary` — `apply_message_score` is your finisher for this run kind.

Keep `reasoning` to one concise sentence. The user sees it inline in their inbox.
