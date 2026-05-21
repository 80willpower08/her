// MCP server exposing tools the agent uses to record proposed actions.
//
// Reachable only on the internal Docker network at http://api:3001/mcp —
// Caddy doesn't forward /mcp publicly, so this is effectively private.
// Single-user, internal-network trust model; no per-request auth.

import type { FastifyPluginAsync } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma.js';
import { recordProposedAction, recordRunSummary } from '../services/agent-actions.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const TOOLS: ToolDef[] = [
  {
    name: 'propose_post_note',
    description:
      'Record a brief note on a task, goal, or calendar event — your observation about why it matters, your concern, or a recommendation. Use messageKind="INSTRUCTION" when the user gives you a steering rule you should respect on future runs (e.g., "no prep needed for X" or "always weight this above Y"). INSTRUCTION notes are read into the agent context on every future run and treated as standing guidance.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'entityType', 'entityId', 'body', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string', description: 'The current agent run ID (passed in your prompt).' },
        entityType: {
          type: 'string',
          enum: ['task', 'goal', 'event'],
          description: 'Which entity the note attaches to. "event" is a calendar event.',
        },
        entityId: { type: 'string', description: 'UUID of the entity from the input context.' },
        body: { type: 'string', description: 'The note text. 1-2 sentences. Concrete, specific.' },
        rationale: { type: 'string', description: 'One-line "why" shown to the user in the review log.' },
        messageKind: {
          type: 'string',
          enum: ['AGENT_REPLY', 'INSTRUCTION', 'NOTE'],
          description:
            'AGENT_REPLY (default) for silent observations. INSTRUCTION for user-given rules to enforce on future runs.',
        },
      },
    },
  },
  {
    name: 'propose_link_task_to_event',
    description:
      "Record a recommendation to pin a task to a calendar event — useful when a task is preparation for a meeting and isn't already linked. Auto-applied; the user can unlink if wrong. Use when task title and event title share clear topical keywords.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'taskId', 'calendarEventId', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        taskId: { type: 'string', description: 'UUID of the task from rankedTasks.' },
        calendarEventId: { type: 'string', description: 'UUID of the event from todayEvents or upcomingEvents.' },
        rationale: { type: 'string', description: 'Why these belong together.' },
      },
    },
  },
  {
    name: 'propose_adjust_weight',
    description:
      "Record a recommendation to change a task's weight (1-10). Stored as a proposal in the user's review queue — the user approves or denies; nothing changes until they do. Use when the task's stated importance (title contains URGENT/CRITICAL/important) doesn't match its current weight, or when a low-weight task sits under a high-weight goal.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'taskId', 'newWeight', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        taskId: { type: 'string', description: 'UUID of the task.' },
        newWeight: { type: 'integer', minimum: 1, maximum: 10, description: 'Proposed new weight 1-10.' },
        rationale: { type: 'string', description: 'Why the change.' },
      },
    },
  },
  {
    name: 'propose_reschedule_task',
    description:
      "Record a recommendation to push a task's due date or scheduled time. Stored as a proposal; the user reviews. Use when a task is 3+ days overdue and has clearly stalled, or when today's calendar makes the original timing unrealistic.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'taskId', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        taskId: { type: 'string' },
        newDueDate: { type: 'string', description: 'ISO 8601 timestamp, or null to clear.' },
        newScheduledFor: { type: 'string', description: 'ISO 8601 timestamp, or null to clear.' },
        rationale: { type: 'string' },
      },
    },
  },
  {
    name: 'propose_create_goal',
    description:
      "Record a recommendation to create a new Goal. Stored as a REVIEW proposal — the user approves or denies. Use when the user states an aspiration in chat (e.g., 'I want to be debt-free in 3 years'), when a recurring theme emerges from the data (multiple debts share a payoff window), or when an upcoming life event implies a new goal (career change, move).",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'title', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        title: { type: 'string', description: 'Goal title — short and outcome-shaped. "Debt-free by 2030".' },
        description: { type: 'string', description: 'Optional longer framing — what success looks like, the why.' },
        weight: { type: 'integer', minimum: 1, maximum: 10, description: '1-10, how important this goal is.' },
        primaryCategoryId: { type: 'string', description: 'Existing category ID this goal lives under.' },
        targetDate: { type: 'string', description: 'ISO 8601 — when the user wants to hit this.' },
        rationale: { type: 'string' },
      },
    },
  },
  {
    name: 'propose_create_task',
    description:
      "Record a recommendation to create a new task. Stored as a proposal; the user reviews. Use when an upcoming calendar event has no associated prep task, or when a goal clearly needs a step that's missing from the user's task list.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'title', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        title: { type: 'string', description: 'Task title. Like "Prep slides for Q3 review".' },
        weight: { type: 'integer', minimum: 1, maximum: 10 },
        categoryId: { type: 'string', description: 'Existing category ID from the input.' },
        dueDate: { type: 'string', description: 'ISO 8601 timestamp.' },
        linkedCalendarEventId: { type: 'string', description: 'Pin to an existing event.' },
        description: { type: 'string' },
        rationale: { type: 'string' },
      },
    },
  },
  {
    name: 'record_run_summary',
    description:
      'Call this once at the end of your run. Records a one-sentence summary and a list of observations the user can review alongside any proposed actions. Always call this last, after any propose_* tools.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'summary', 'observations'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        summary: { type: 'string', description: 'One sentence.' },
        observations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Bullet observations about the day.',
        },
      },
    },
  },
  {
    name: 'propose_create_project',
    description:
      "Record a recommendation to create a new Project — a long-running narrative container (VA claim, custody case, job search, renovation). Use when you discover a major ongoing situation that doesn't fit as a single Goal or Task. Stored as REVIEW.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'title', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        title: { type: 'string', description: 'Short outcome-neutral name. "VA Disability Claim — PTSD".' },
        description: { type: 'string', description: 'One-paragraph summary.' },
        body: { type: 'string', description: 'Initial markdown body — structured history/context.' },
        primaryCategoryId: { type: 'string', description: 'Existing category ID this project lives under.' },
        nextActionAt: { type: 'string', description: 'ISO 8601 — next deadline or milestone.' },
        nextActionNote: { type: 'string' },
        alwaysInContext: { type: 'boolean', description: 'True if the agent should always see this project in context.' },
        rationale: { type: 'string' },
      },
    },
  },
  {
    name: 'update_project_body',
    description:
      "AUTO-applied. Append or replace the markdown body of an existing Project. Use during chat to capture status updates, new developments, decisions. Append-mode adds a dated entry; replace-mode rewrites the full body (use sparingly, e.g., for import cleanup).",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'projectId', 'mode', 'content'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        projectId: { type: 'string' },
        mode: { type: 'string', enum: ['append', 'replace'] },
        content: { type: 'string', description: 'Markdown content. For append, will be prefixed with a "## YYYY-MM-DD" date heading automatically.' },
      },
    },
  },
  {
    name: 'propose_update_project',
    description:
      'Record a recommendation to update Project metadata (title, description, status, category, nextAction, alwaysInContext). Stored as REVIEW. Use sparingly — append/replace body content via update_project_body instead.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'projectId', 'rationale'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        projectId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'COMPLETE', 'ARCHIVED'] },
        primaryCategoryId: { type: 'string' },
        nextActionAt: { type: 'string' },
        nextActionNote: { type: 'string' },
        alwaysInContext: { type: 'boolean' },
        rationale: { type: 'string' },
      },
    },
  },
  {
    name: 'read_project_body',
    description:
      'Fetch the FULL markdown body of a Project. Use when the bodyExcerpt in context indicates truncation (bodyTruncated: true) AND you need the missing content to answer accurately.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'projectId'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        projectId: { type: 'string' },
      },
    },
  },
  {
    name: 'set_today_curation',
    description:
      "Curate the user's Today page. Writes a markdown headline + ordered list of pinned task/event/project IDs that the user sees front-and-center. Use this at the END of a daily PRIORITIZATION run to give the user a clear 'what to focus on today.' Pick 3-7 items max — concise. Each pin needs a one-line `reason` explaining why it's front-and-center today.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'headline', 'pinned'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        headline: {
          type: 'string',
          description: '1-3 sentences of markdown. The "what I\'d focus on today" framing.',
        },
        pinned: {
          type: 'array',
          maxItems: 7,
          items: {
            type: 'object',
            required: ['type', 'id', 'reason'],
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['task', 'event', 'project'] },
              id: { type: 'string' },
              reason: { type: 'string', description: 'Short note — why this is forefront today.' },
            },
          },
        },
      },
    },
  },
  {
    name: 'read_data_source_snapshot',
    description:
      'Fetch the FULL snapshot of a registered DataSource (other-app HTTP feed). Use when context shows dataTruncated: true AND you need more than the excerpt to answer accurately. Read-only; you cannot write to the underlying app.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'dataSourceId'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        dataSourceId: { type: 'string' },
      },
    },
  },
  {
    name: 'record_observation',
    description:
      "Record a durable observation about the user — something that should persist across sessions and inform future runs. Use sparingly and only for things genuinely worth remembering. Six kinds:\n- FACT: stable truth about the user, their work, family, accounts ('Spouse manages family calendar')\n- PATTERN: probabilistic recurring behavior ('Tends to overcommit on Mondays')\n- PREFERENCE: stated rule ('No prep tasks for paused meetings')\n- COMMITMENT: stated aspiration with a target ('Debt-free by 2030')\n- INSIGHT: synthesis the agent derives ('Mental energy drops Friday afternoons')\n- CONCERN: situational warning ('Workload trajectory mirrors prior overload')\nWritten AUTO — no review queue. User browses /about-me to edit/confirm/dispute.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'kind', 'subject', 'body', 'source'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        kind: { type: 'string', enum: ['FACT', 'PATTERN', 'PREFERENCE', 'COMMITMENT', 'INSIGHT', 'CONCERN'] },
        subject: { type: 'string', description: 'Short title — 3-7 words.' },
        body: { type: 'string', description: 'The observation. 1-3 sentences. Concrete.' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Default 1.0. Lower for inferred PATTERN/INSIGHT/CONCERN.' },
        source: { type: 'string', enum: ['user_chat', 'user_directive', 'agent_inferred', 'data_pattern'] },
        chatThreadId: { type: 'string', description: 'Optional — the chat thread that produced this.' },
        relatedCategoryIds: { type: 'array', items: { type: 'string' } },
        relatedGoalIds: { type: 'array', items: { type: 'string' } },
        relatedTaskIds: { type: 'array', items: { type: 'string' } },
        expiresAt: { type: 'string', description: 'ISO 8601 — for situational facts that decay.' },
        enforceLevel: { type: 'string', enum: ['NORMAL', 'BLOCK'], description: 'COMMITMENT only. BLOCK = refuse conflicting requests until resolved.' },
      },
    },
  },
  {
    name: 'supersede_observation',
    description:
      'Replace an existing observation with a revised version. Use when the user explicitly changes their mind, or when new data clearly contradicts a prior pattern/insight. The old observation is preserved with supersededAt set; the new one chains via supersedesId. Always include rationale in the body.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'priorObservationId', 'kind', 'subject', 'body', 'source'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        priorObservationId: { type: 'string' },
        kind: { type: 'string', enum: ['FACT', 'PATTERN', 'PREFERENCE', 'COMMITMENT', 'INSIGHT', 'CONCERN'] },
        subject: { type: 'string' },
        body: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        source: { type: 'string', enum: ['user_chat', 'user_directive', 'agent_inferred', 'data_pattern'] },
        chatThreadId: { type: 'string' },
        relatedCategoryIds: { type: 'array', items: { type: 'string' } },
        relatedGoalIds: { type: 'array', items: { type: 'string' } },
        relatedTaskIds: { type: 'array', items: { type: 'string' } },
        expiresAt: { type: 'string' },
        enforceLevel: { type: 'string', enum: ['NORMAL', 'BLOCK'] },
      },
    },
  },
  {
    name: 'archive_observation',
    description:
      'Soft-delete an observation. Use when the user clearly retracts it ("I don\'t want that anymore") and supersedes doesn\'t fit (i.e., the observation is wrong entirely, not being revised). The row stays in DB but is hidden from agent context and /about-me by default.',
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'observationId'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        observationId: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  },
  {
    name: 'post_chat_reply',
    description:
      "Call this exactly once at the end of a CHAT-kind run. Sends the user-facing reply to the chat thread. Use markdown. Use this INSTEAD of record_run_summary. Any propose_* tools you called still apply.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'chatThreadId', 'body'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        chatThreadId: { type: 'string' },
        body: { type: 'string', description: 'Markdown reply text.' },
      },
    },
  },
  {
    name: 'apply_message_score',
    description:
      "Call this exactly once during a SCORE_MESSAGE-kind run to record your assessment of the incoming message. Updates the message's importance, adds context labels (project tags + a 'reasoning:' label preserving your one-line rationale), and optionally marks it dismissed-as-noise (triageStatus DISCARDED). Use this INSTEAD of record_run_summary for SCORE_MESSAGE runs.",
    inputSchema: {
      type: 'object',
      required: ['agentRunId', 'messageId', 'importance', 'reasoning'],
      additionalProperties: false,
      properties: {
        agentRunId: { type: 'string' },
        messageId: { type: 'string', description: 'The EmailMessage row being scored.' },
        importance: {
          type: 'string',
          enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
          description: 'Final importance after considering project relevance, sender, and prior triage patterns.',
        },
        projectIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Project IDs this message relates to. Empty if none.',
        },
        reasoning: {
          type: 'string',
          description: 'One concise sentence the user will see during triage explaining why you chose this importance.',
        },
        dismissAsNoise: {
          type: 'boolean',
          description: 'If true, sets triageStatus DISCARDED. Use ONLY when the message clearly matches a pattern the user dismisses (delivery codes, marketing blast, etc.).',
        },
      },
    },
  },
];

async function loadRun(agentRunId: string) {
  const run = await prisma.agentRun.findUnique({ where: { id: agentRunId } });
  if (!run) throw new Error(`AgentRun ${agentRunId} not found`);
  return run;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  const agentRunId = String(args.agentRunId ?? '');
  if (!agentRunId) return { ok: false, message: 'agentRunId required' };
  const run = await loadRun(agentRunId);

  switch (name) {
    case 'propose_post_note': {
      const action = await recordProposedAction(run, {
        kind: 'POST_NOTE',
        targetType: String(args.entityType),
        targetId: String(args.entityId),
        rationale: String(args.rationale),
        payload: {
          entityType: String(args.entityType),
          entityId: String(args.entityId),
          body: String(args.body),
          messageKind: args.messageKind ? String(args.messageKind) : undefined,
        },
      });
      return { ok: true, message: `Recorded POST_NOTE (${action.status}).` };
    }
    case 'propose_link_task_to_event': {
      const action = await recordProposedAction(run, {
        kind: 'LINK_TASK_TO_EVENT',
        targetType: 'task',
        targetId: String(args.taskId),
        rationale: String(args.rationale),
        payload: {
          taskId: String(args.taskId),
          calendarEventId: String(args.calendarEventId),
        },
      });
      return { ok: true, message: `Recorded LINK_TASK_TO_EVENT (${action.status}).` };
    }
    case 'propose_adjust_weight': {
      const action = await recordProposedAction(run, {
        kind: 'ADJUST_WEIGHT',
        targetType: 'task',
        targetId: String(args.taskId),
        rationale: String(args.rationale),
        payload: {
          taskId: String(args.taskId),
          newWeight: Number(args.newWeight),
        },
      });
      return { ok: true, message: `Recorded ADJUST_WEIGHT (${action.status}). Pending review.` };
    }
    case 'propose_reschedule_task': {
      const action = await recordProposedAction(run, {
        kind: 'RESCHEDULE_TASK',
        targetType: 'task',
        targetId: String(args.taskId),
        rationale: String(args.rationale),
        payload: {
          taskId: String(args.taskId),
          newDueDate: args.newDueDate ?? undefined,
          newScheduledFor: args.newScheduledFor ?? undefined,
        },
      });
      return { ok: true, message: `Recorded RESCHEDULE_TASK (${action.status}). Pending review.` };
    }
    case 'propose_create_goal': {
      const action = await recordProposedAction(run, {
        kind: 'CREATE_GOAL',
        rationale: String(args.rationale),
        payload: {
          title: String(args.title),
          description: args.description ? String(args.description) : null,
          weight: args.weight,
          primaryCategoryId: args.primaryCategoryId
            ? String(args.primaryCategoryId)
            : null,
          targetDate: args.targetDate ? String(args.targetDate) : null,
        },
      });
      return { ok: true, message: `Recorded CREATE_GOAL (${action.status}). Pending review.` };
    }
    case 'propose_create_task': {
      const action = await recordProposedAction(run, {
        kind: 'CREATE_TASK',
        rationale: String(args.rationale),
        payload: {
          title: String(args.title),
          weight: args.weight,
          categoryId: args.categoryId,
          dueDate: args.dueDate,
          linkedCalendarEventId: args.linkedCalendarEventId,
          description: args.description,
        },
      });
      return { ok: true, message: `Recorded CREATE_TASK (${action.status}). Pending review.` };
    }
    case 'record_run_summary': {
      await recordRunSummary(run, {
        summary: String(args.summary),
        observations: Array.isArray(args.observations)
          ? (args.observations as string[]).map((s) => String(s))
          : [],
      });
      return { ok: true, message: 'Summary recorded.' };
    }
    case 'propose_create_project': {
      const action = await recordProposedAction(run, {
        kind: 'CREATE_PROJECT',
        rationale: String(args.rationale),
        payload: {
          title: String(args.title),
          description: args.description ? String(args.description) : null,
          body: args.body ? String(args.body) : '',
          primaryCategoryId: args.primaryCategoryId ? String(args.primaryCategoryId) : null,
          nextActionAt: args.nextActionAt ? String(args.nextActionAt) : null,
          nextActionNote: args.nextActionNote ? String(args.nextActionNote) : null,
          alwaysInContext: args.alwaysInContext === true,
        },
      });
      return { ok: true, message: `Recorded CREATE_PROJECT (${action.status}). Pending review.` };
    }
    case 'propose_update_project': {
      const projectId = String(args.projectId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: run.userId },
      });
      if (!project) return { ok: false, message: `Project ${projectId} not found` };
      const action = await recordProposedAction(run, {
        kind: 'UPDATE_PROJECT',
        targetType: 'project',
        targetId: projectId,
        rationale: String(args.rationale),
        payload: {
          projectId,
          title: args.title ? String(args.title) : undefined,
          description: args.description ? String(args.description) : undefined,
          status: args.status ? String(args.status) : undefined,
          primaryCategoryId: args.primaryCategoryId ? String(args.primaryCategoryId) : undefined,
          nextActionAt: args.nextActionAt ? String(args.nextActionAt) : undefined,
          nextActionNote: args.nextActionNote ? String(args.nextActionNote) : undefined,
          alwaysInContext:
            typeof args.alwaysInContext === 'boolean' ? args.alwaysInContext : undefined,
        },
      });
      return { ok: true, message: `Recorded UPDATE_PROJECT (${action.status}).` };
    }
    case 'update_project_body': {
      const projectId = String(args.projectId);
      const mode = String(args.mode);
      const content = String(args.content);
      if (mode !== 'append' && mode !== 'replace') {
        return { ok: false, message: 'mode must be "append" or "replace"' };
      }
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: run.userId },
      });
      if (!project) return { ok: false, message: `Project ${projectId} not found` };

      let nextBody: string;
      if (mode === 'replace') {
        nextBody = content;
      } else {
        const datestamp = new Date().toISOString().slice(0, 10);
        const heading = `\n\n## ${datestamp}\n\n`;
        nextBody = (project.body || '').trimEnd() + heading + content.trimStart();
      }

      // If this is the import-mode completion (PAUSED + "processing" sentinel
      // description + replace), flip back to ACTIVE so the UI stops showing
      // the spinner.
      const isImportFinish =
        mode === 'replace' &&
        project.status === 'PAUSED' &&
        (project.description ?? '').toLowerCase().includes('processing');

      await prisma.project.update({
        where: { id: projectId },
        data: {
          body: nextBody,
          updatedAt: new Date(),
          ...(isImportFinish
            ? { status: 'ACTIVE', description: null }
            : {}),
        },
      });
      return {
        ok: true,
        message: `Project body ${mode === 'append' ? 'appended' : 'replaced'} (now ${nextBody.length} chars).${isImportFinish ? ' Import completion detected — status flipped ACTIVE.' : ''}`,
      };
    }
    case 'read_project_body': {
      const projectId = String(args.projectId);
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: run.userId },
        select: { id: true, title: true, body: true },
      });
      if (!project) return { ok: false, message: `Project ${projectId} not found` };
      // Return the body INSIDE the message so the agent can reason on it.
      return {
        ok: true,
        message: `Project "${project.title}" full body (${project.body.length} chars):\n\n${project.body}`,
      };
    }
    case 'set_today_curation': {
      const headline = String(args.headline ?? '').slice(0, 2000);
      const pinned = Array.isArray(args.pinned) ? args.pinned : [];
      // Validate pinned entries point at real entities owned by this user.
      const validated: Array<{ type: string; id: string; reason: string }> = [];
      for (const raw of pinned.slice(0, 7)) {
        const p = raw as Record<string, unknown>;
        const type = String(p.type ?? '');
        const id = String(p.id ?? '');
        const reason = String(p.reason ?? '').slice(0, 300);
        if (!['task', 'event', 'project'].includes(type) || !id) continue;
        // Existence check
        const exists =
          type === 'task'
            ? await prisma.task.findFirst({ where: { id, userId: run.userId }, select: { id: true } })
            : type === 'event'
              ? await prisma.calendarEvent.findFirst({ where: { id, userId: run.userId }, select: { id: true } })
              : await prisma.project.findFirst({ where: { id, userId: run.userId }, select: { id: true } });
        if (!exists) continue;
        validated.push({ type, id, reason });
      }
      await prisma.todayCuration.upsert({
        where: { userId: run.userId },
        update: {
          headline,
          pinned: validated as unknown as object,
          sourceRunId: run.id,
        },
        create: {
          userId: run.userId,
          headline,
          pinned: validated as unknown as object,
          sourceRunId: run.id,
        },
      });
      return { ok: true, message: `Today curation set — ${validated.length} pinned.` };
    }
    case 'read_data_source_snapshot': {
      const id = String(args.dataSourceId);
      const source = await prisma.dataSource.findFirst({
        where: { id, userId: run.userId },
        select: { id: true, label: true, snapshot: true },
      });
      if (!source) return { ok: false, message: `DataSource ${id} not found` };
      const snap = (source.snapshot ?? null) as { data?: unknown } | null;
      if (!snap?.data) {
        return { ok: false, message: `DataSource "${source.label}" has no snapshot yet — try syncing it first.` };
      }
      const serialized =
        typeof snap.data === 'string' ? snap.data : JSON.stringify(snap.data, null, 2);
      return {
        ok: true,
        message: `DataSource "${source.label}" full snapshot (${serialized.length} chars):\n\n${serialized}`,
      };
    }
    case 'record_observation': {
      const allowedKinds = ['FACT', 'PATTERN', 'PREFERENCE', 'COMMITMENT', 'INSIGHT', 'CONCERN'] as const;
      const allowedSources = ['user_chat', 'user_directive', 'agent_inferred', 'data_pattern'] as const;
      const kind = String(args.kind);
      const source = String(args.source);
      if (!allowedKinds.includes(kind as (typeof allowedKinds)[number])) {
        return { ok: false, message: `Invalid kind: ${kind}` };
      }
      if (!allowedSources.includes(source as (typeof allowedSources)[number])) {
        return { ok: false, message: `Invalid source: ${source}` };
      }
      const enforce = args.enforceLevel === 'BLOCK' ? 'BLOCK' : 'NORMAL';
      const obs = await prisma.observation.create({
        data: {
          userId: run.userId,
          kind: kind as (typeof allowedKinds)[number],
          subject: String(args.subject).slice(0, 200),
          body: String(args.body).slice(0, 4000),
          confidence: typeof args.confidence === 'number' ? args.confidence : 1.0,
          source,
          sourceRunId: run.id,
          sourceThreadId: args.chatThreadId ? String(args.chatThreadId) : null,
          relatedCategoryIds: Array.isArray(args.relatedCategoryIds)
            ? (args.relatedCategoryIds as string[]).map(String)
            : [],
          relatedGoalIds: Array.isArray(args.relatedGoalIds)
            ? (args.relatedGoalIds as string[]).map(String)
            : [],
          relatedTaskIds: Array.isArray(args.relatedTaskIds)
            ? (args.relatedTaskIds as string[]).map(String)
            : [],
          expiresAt: args.expiresAt ? new Date(String(args.expiresAt)) : null,
          enforceLevel: enforce,
        },
      });
      return { ok: true, message: `Recorded ${kind} observation (id=${obs.id.slice(0, 8)}).` };
    }
    case 'supersede_observation': {
      const priorId = String(args.priorObservationId);
      const prior = await prisma.observation.findFirst({
        where: { id: priorId, userId: run.userId },
      });
      if (!prior) return { ok: false, message: 'Prior observation not found' };
      if (prior.supersededAt) {
        return { ok: false, message: 'Prior observation already superseded' };
      }
      const allowedKinds = ['FACT', 'PATTERN', 'PREFERENCE', 'COMMITMENT', 'INSIGHT', 'CONCERN'] as const;
      const kind = String(args.kind);
      if (!allowedKinds.includes(kind as (typeof allowedKinds)[number])) {
        return { ok: false, message: `Invalid kind: ${kind}` };
      }
      const enforce = args.enforceLevel === 'BLOCK' ? 'BLOCK' : 'NORMAL';
      const now = new Date();
      // Use a transaction so prior gets marked superseded only if new one inserts.
      const created = await prisma.$transaction(async (tx) => {
        const newObs = await tx.observation.create({
          data: {
            userId: run.userId,
            kind: kind as (typeof allowedKinds)[number],
            subject: String(args.subject).slice(0, 200),
            body: String(args.body).slice(0, 4000),
            confidence: typeof args.confidence === 'number' ? args.confidence : 1.0,
            source: String(args.source),
            sourceRunId: run.id,
            sourceThreadId: args.chatThreadId ? String(args.chatThreadId) : null,
            relatedCategoryIds: Array.isArray(args.relatedCategoryIds)
              ? (args.relatedCategoryIds as string[]).map(String)
              : prior.relatedCategoryIds,
            relatedGoalIds: Array.isArray(args.relatedGoalIds)
              ? (args.relatedGoalIds as string[]).map(String)
              : prior.relatedGoalIds,
            relatedTaskIds: Array.isArray(args.relatedTaskIds)
              ? (args.relatedTaskIds as string[]).map(String)
              : prior.relatedTaskIds,
            expiresAt: args.expiresAt ? new Date(String(args.expiresAt)) : null,
            enforceLevel: enforce,
            supersedesId: prior.id,
          },
        });
        await tx.observation.update({
          where: { id: prior.id },
          data: { supersededAt: now },
        });
        return newObs;
      });
      return { ok: true, message: `Superseded ${prior.id.slice(0, 8)} → ${created.id.slice(0, 8)}.` };
    }
    case 'archive_observation': {
      const id = String(args.observationId);
      const obs = await prisma.observation.findFirst({
        where: { id, userId: run.userId },
      });
      if (!obs) return { ok: false, message: 'Observation not found' };
      await prisma.observation.update({
        where: { id },
        data: { archived: true },
      });
      return { ok: true, message: `Archived ${id.slice(0, 8)}.` };
    }
    case 'post_chat_reply': {
      const chatThreadId = String(args.chatThreadId ?? '');
      const body = String(args.body ?? '').trim();
      if (!chatThreadId) return { ok: false, message: 'chatThreadId required' };
      if (!body) return { ok: false, message: 'body required' };

      const thread = await prisma.chatThread.findUnique({ where: { id: chatThreadId } });
      if (!thread) return { ok: false, message: `ChatThread ${chatThreadId} not found` };
      if (thread.userId !== run.userId)
        return { ok: false, message: 'Thread does not belong to this run' };

      await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          role: 'AGENT',
          body,
          agentRunId: run.id,
        },
      });
      await prisma.chatThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });
      return { ok: true, message: 'Chat reply posted.' };
    }
    case 'apply_message_score': {
      const messageId = String(args.messageId ?? '');
      const importance = String(args.importance ?? '') as
        | 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      const reasoning = String(args.reasoning ?? '').trim();
      const projectIds = Array.isArray(args.projectIds)
        ? (args.projectIds as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      const dismissAsNoise = args.dismissAsNoise === true;

      if (!messageId) return { ok: false, message: 'messageId required' };
      if (!reasoning) return { ok: false, message: 'reasoning required' };

      const message = await prisma.emailMessage.findUnique({ where: { id: messageId } });
      if (!message) return { ok: false, message: `Message ${messageId} not found` };
      if (message.userId !== run.userId)
        return { ok: false, message: 'Message does not belong to this run' };

      // Resolve project names for human-readable labels. Tolerate missing IDs
      // (agent may hallucinate one occasionally).
      const projects = projectIds.length
        ? await prisma.project.findMany({
            where: { id: { in: projectIds }, userId: run.userId },
            select: { id: true, title: true },
          })
        : [];
      const projectLabels = projects.map((p) => `project:${p.title}`);

      // Drop any prior reasoning label so re-scores don't accumulate.
      const filtered = message.labels.filter((l) => !l.startsWith('reasoning:'));
      const reasoningLabel = `reasoning:${reasoning.slice(0, 240)}`;
      const mergedLabels = Array.from(
        new Set([...filtered, ...projectLabels, reasoningLabel])
      );

      const PRIORITY_RANK = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 } as const;

      await prisma.emailMessage.update({
        where: { id: messageId },
        data: {
          importance,
          labels: mergedLabels,
          isImportant: PRIORITY_RANK[importance] >= PRIORITY_RANK.HIGH,
          triageStatus: dismissAsNoise ? 'DISCARDED' : message.triageStatus,
        },
      });

      // Also stamp the AgentRun decision blob so the scoring is auditable.
      await prisma.agentRun.update({
        where: { id: run.id },
        data: {
          decision: {
            messageId,
            importance,
            projectIds,
            reasoning,
            dismissAsNoise,
          },
        },
      });

      return { ok: true, message: `Scored ${importance}${dismissAsNoise ? ' (dismissed)' : ''}` };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}` };
  }
}

function buildMcpServer(): Server {
  const server = new Server(
    { name: 'time-keeper', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await callTool(request.params.name, args);
      return {
        content: [{ type: 'text', text: result.message ?? (result.ok ? 'OK' : 'Failed') }],
        isError: !result.ok,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Persistent transports keyed by mcp-session-id. Created on initialize,
// reused across subsequent calls in the same session, cleaned on close.
const transports = new Map<string, StreamableHTTPServerTransport>();

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  app.all('/mcp', async (req, reply) => {
    const sessionId = (req.headers['mcp-session-id'] as string | undefined) ?? undefined;
    const isInitialize =
      typeof req.body === 'object' &&
      req.body !== null &&
      (req.body as { method?: string }).method === 'initialize';

    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (isInitialize) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildMcpServer();
      await server.connect(transport);
    } else {
      reply.code(400).send({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no session and not initialize' },
        id: null,
      });
      return;
    }

    reply.hijack();
    await transport!.handleRequest(req.raw, reply.raw, req.body);
  });
};
