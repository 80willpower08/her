// Internal endpoints used by the agent container.
// Auth via X-Internal-Secret header.

import type { FastifyPluginAsync } from 'fastify';
import type { AgentKind, AgentRunStatus, ProposedActionKind, ProposedActionMode } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { buildAgentContext, DEFAULT_ACTION_MODE, executeProposedAction } from '../services/agent.js';
import { dispatchNotification } from '../services/notifications.js';

const HEADER = 'x-internal-secret';

const ACTION_KINDS = [
  'POST_NOTE',
  'CREATE_TASK',
  'UPDATE_TASK',
  'COMPLETE_TASK',
  'ADJUST_WEIGHT',
  'RESCHEDULE_TASK',
  'LINK_TASK_TO_EVENT',
  'ARCHIVE_TASK',
  'DECLINE_MEETING',
  'CREATE_GOAL',
  'CREATE_PROJECT',
  'UPDATE_PROJECT',
] as const;

const AGENT_KINDS = [
  'ORCHESTRATOR',
  'PRIORITIZATION',
  'EMAIL_TRIAGE',
  'CALENDAR_CONFLICT',
  'STATUS_SUMMARY',
  'CHAT',
  'SCORE_MESSAGE',
] as const;

export const agentInternalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (!env.internalApiSecret) {
      return reply.code(503).send({ error: 'Internal API not configured' });
    }
    if (req.headers[HEADER] !== env.internalApiSecret) {
      return reply.unauthorized();
    }
  });

  // Get the curated context for an agent kind. Optional ?anchorCategoryIds,
  // ?anchorGoalIds, ?anchorTaskIds (comma-separated UUIDs) bias observation
  // curation toward the anchor — used by CHAT runs.
  app.get<{
    Querystring: {
      userId: string;
      kind: AgentKind;
      anchorCategoryIds?: string;
      anchorGoalIds?: string;
      anchorTaskIds?: string;
    };
  }>(
    '/internal/agent-context',
    async (req, reply) => {
      if (!req.query.userId || !req.query.kind) {
        return reply.badRequest('userId and kind required');
      }
      if (!AGENT_KINDS.includes(req.query.kind as (typeof AGENT_KINDS)[number])) {
        return reply.badRequest('Invalid kind');
      }
      const split = (s: string | undefined): string[] | undefined =>
        s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
      const anchor = {
        categoryIds: split(req.query.anchorCategoryIds),
        goalIds: split(req.query.anchorGoalIds),
        taskIds: split(req.query.anchorTaskIds),
      };
      const hasAnchor =
        (anchor.categoryIds?.length ?? 0) +
          (anchor.goalIds?.length ?? 0) +
          (anchor.taskIds?.length ?? 0) >
        0;
      const context = await buildAgentContext(
        req.query.userId,
        req.query.kind,
        hasAnchor ? anchor : undefined
      );
      return { context };
    }
  );

  // Create an agent run, returning the id.
  app.post<{
    Body: { userId: string; kind: AgentKind; trigger: string; inputContext?: unknown };
  }>(
    '/internal/agent-runs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'kind', 'trigger'],
          properties: {
            userId: { type: 'string' },
            kind: { type: 'string', enum: AGENT_KINDS as unknown as string[] },
            trigger: { type: 'string' },
            inputContext: {},
          },
        },
      },
    },
    async (req) => {
      const run = await prisma.agentRun.create({
        data: {
          userId: req.body.userId,
          kind: req.body.kind,
          trigger: req.body.trigger,
          inputContext: (req.body.inputContext ?? null) as never,
        },
      });
      return { run };
    }
  );

  // Finish an agent run with output + parsed decision.
  app.patch<{
    Params: { id: string };
    Body: {
      status: AgentRunStatus;
      rawOutput?: string | null;
      decision?: unknown;
      inputTokens?: number;
      outputTokens?: number;
      error?: string | null;
    };
  }>(
    '/internal/agent-runs/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['RUNNING', 'OK', 'ERROR', 'CANCELLED'] },
            rawOutput: { type: ['string', 'null'] },
            decision: {},
            inputTokens: { type: 'integer' },
            outputTokens: { type: 'integer' },
            error: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (req, reply) => {
      const existing = await prisma.agentRun.findUnique({ where: { id: req.params.id } });
      if (!existing) return reply.notFound();
      const updated = await prisma.agentRun.update({
        where: { id: req.params.id },
        data: {
          status: req.body.status,
          rawOutput: req.body.rawOutput ?? undefined,
          decision: (req.body.decision ?? undefined) as never,
          inputTokens: req.body.inputTokens ?? undefined,
          outputTokens: req.body.outputTokens ?? undefined,
          error: req.body.error ?? undefined,
          finishedAt: req.body.status === 'RUNNING' ? undefined : new Date(),
        },
      });
      return { run: updated };
    }
  );

  // Create proposed actions in batch from an agent run.
  app.post<{
    Body: {
      agentRunId: string;
      actions: Array<{
        kind: ProposedActionKind;
        mode?: ProposedActionMode;
        targetType?: string | null;
        targetId?: string | null;
        rationale: string;
        payload: unknown;
        expiresAt?: string | null;
      }>;
    };
  }>(
    '/internal/proposed-actions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['agentRunId', 'actions'],
          properties: {
            agentRunId: { type: 'string' },
            actions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['kind', 'rationale', 'payload'],
                properties: {
                  kind: { type: 'string', enum: ACTION_KINDS as unknown as string[] },
                  mode: { type: 'string', enum: ['AUTO', 'REVIEW', 'ASK'] },
                  targetType: { type: ['string', 'null'] },
                  targetId: { type: ['string', 'null'] },
                  rationale: { type: 'string' },
                  payload: {},
                  expiresAt: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const run = await prisma.agentRun.findUnique({ where: { id: req.body.agentRunId } });
      if (!run) return reply.notFound();

      const created = [];
      for (const a of req.body.actions) {
        const mode = a.mode ?? DEFAULT_ACTION_MODE[a.kind];
        const action = await prisma.proposedAction.create({
          data: {
            userId: run.userId,
            agentRunId: run.id,
            kind: a.kind,
            mode,
            targetType: a.targetType ?? null,
            targetId: a.targetId ?? null,
            rationale: a.rationale,
            payload: a.payload as never,
            expiresAt: a.expiresAt ? new Date(a.expiresAt) : null,
          },
        });

        // AUTO-mode actions execute immediately.
        if (mode === 'AUTO') {
          const result = await executeProposedAction(action);
          if ('error' in result) {
            const failed = await prisma.proposedAction.update({
              where: { id: action.id },
              data: { status: 'FAILED', error: result.error },
            });
            created.push(failed);
          } else {
            const executed = await prisma.proposedAction.update({
              where: { id: action.id },
              data: { status: 'EXECUTED', decidedAt: new Date(), executedAt: new Date() },
            });
            created.push(executed);
          }
        } else {
          // REVIEW or ASK — notify the user there's something waiting.
          const kindLabel = action.kind.toLowerCase().replace(/_/g, ' ');
          const modeLabel = mode === 'ASK' ? 'needs your call' : 'awaiting review';
          await dispatchNotification({
            userId: run.userId,
            kind: 'AGENT_PROPOSAL',
            title: `Agent proposes: ${kindLabel}`,
            body: action.rationale.slice(0, 300),
            url: '/agent',
            sourceType: 'proposed_action',
            sourceId: action.id,
            sourceVersion: 'v1',
            priority: mode === 'ASK' ? 'URGENT' : 'NORMAL',
          }).catch(() => undefined);
          created.push(action);
        }
      }
      return { actions: created };
    }
  );

  // List actions created during a specific run — used by the agent worker for logging.
  app.get<{ Params: { id: string } }>('/internal/agent-runs/:id/actions', async (req) => {
    const actions = await prisma.proposedAction.findMany({
      where: { agentRunId: req.params.id },
      select: { id: true, kind: true, status: true, mode: true },
    });
    return { actions };
  });

  // Get a chat thread with its full message history + anchor entity context.
  // Used by the agent worker when running a CHAT job.
  app.get<{ Params: { id: string } }>('/internal/chat-threads/:id', async (req, reply) => {
    const thread = await prisma.chatThread.findUnique({
      where: { id: req.params.id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!thread) return reply.notFound();

    // Anchor entity context — minimal but useful.
    let anchor: unknown = null;
    if (thread.anchorType === 'task' && thread.anchorId) {
      anchor = await prisma.task.findUnique({
        where: { id: thread.anchorId },
        include: {
          category: { select: { id: true, name: true, weight: true } },
          goalTasks: { include: { goal: { select: { id: true, title: true } } } },
        },
      });
    } else if (thread.anchorType === 'goal' && thread.anchorId) {
      anchor = await prisma.goal.findUnique({
        where: { id: thread.anchorId },
        include: { tasks: { include: { task: { select: { id: true, title: true, completed: true } } } } },
      });
    } else if (thread.anchorType === 'event' && thread.anchorId) {
      anchor = await prisma.calendarEvent.findUnique({ where: { id: thread.anchorId } });
    } else if (thread.anchorType === 'message' && thread.anchorId) {
      anchor = await prisma.emailMessage.findUnique({ where: { id: thread.anchorId } });
    } else if (thread.anchorType === 'proposed_action' && thread.anchorId) {
      anchor = await prisma.proposedAction.findUnique({ where: { id: thread.anchorId } });
    } else if (thread.anchorType === 'project' && thread.anchorId) {
      // Project-level chat — include the project itself plus any goals/tasks
      // that share its primary category. Body is included as-is so the agent
      // sees the full narrative.
      const project = await prisma.project.findUnique({
        where: { id: thread.anchorId },
      });
      anchor = { project };
    } else if (thread.anchorType === 'category' && thread.anchorId) {
      // Category-level chat — include the category + its open goals/tasks +
      // any sheet sources mapped to it, so the agent can do planning grounded
      // in everything in that life-area.
      const [category, goals, tasks, sheetSources] = await Promise.all([
        prisma.category.findUnique({ where: { id: thread.anchorId } }),
        prisma.goal.findMany({
          where: {
            userId: thread.userId,
            primaryCategoryId: thread.anchorId,
            archived: false,
          },
          select: {
            id: true,
            title: true,
            description: true,
            weight: true,
            targetDate: true,
            progress: true,
            completed: true,
          },
          orderBy: { weight: 'desc' },
        }),
        prisma.task.findMany({
          where: {
            userId: thread.userId,
            categoryId: thread.anchorId,
            completed: false,
          },
          select: {
            id: true,
            title: true,
            weight: true,
            dueDate: true,
            scheduledFor: true,
          },
          orderBy: { weight: 'desc' },
          take: 30,
        }),
        prisma.sheetSource.findMany({
          where: {
            userId: thread.userId,
            categoryId: thread.anchorId,
            enabled: true,
          },
        }),
      ]);
      anchor = { category, goals, tasks, sheetSources };
    }

    return { thread, anchor };
  });

  // Append an agent message to a chat thread (closes a CHAT run).
  app.post<{
    Params: { id: string };
    Body: { body: string; agentRunId?: string | null };
  }>(
    '/internal/chat-threads/:id/messages',
    {
      schema: {
        body: {
          type: 'object',
          required: ['body'],
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 16000 },
            agentRunId: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (req, reply) => {
      const thread = await prisma.chatThread.findUnique({ where: { id: req.params.id } });
      if (!thread) return reply.notFound();

      const message = await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          role: 'AGENT',
          body: req.body.body,
          agentRunId: req.body.agentRunId ?? null,
        },
      });
      await prisma.chatThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });
      return { message };
    }
  );

  // Short context for a SCORE_MESSAGE run. Just the one message + active
  // projects (so the agent can tag relevance) + the user's recent triage
  // observations (so the agent learns from past actions) + active signal
  // rules (so the agent knows the default routing).
  app.get<{ Params: { id: string } }>('/internal/score-context/:id', async (req, reply) => {
    const message = await prisma.emailMessage.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        userId: true,
        source: true,
        fromAddress: true,
        fromName: true,
        toAddresses: true,
        subject: true,
        snippet: true,
        bodyText: true,
        labels: true,
        importance: true,
        receivedAt: true,
      },
    });
    if (!message) return reply.notFound();

    const [projects, observations, rules] = await Promise.all([
      prisma.project.findMany({
        where: { userId: message.userId, status: { in: ['ACTIVE', 'PAUSED'] } },
        select: { id: true, title: true, status: true, description: true },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      // Recent triage signals: items the user actively classified.
      prisma.emailMessage.findMany({
        where: {
          userId: message.userId,
          triageStatus: { in: ['DISCARDED', 'CONVERTED_TO_TASK', 'ATTACHED_TO_GOAL', 'NOTED'] },
        },
        select: {
          source: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          triageStatus: true,
          labels: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      prisma.signalRule.findMany({
        where: { userId: message.userId, enabled: true },
        select: { name: true, setImportance: true, addLabels: true },
        orderBy: { priority: 'asc' },
        take: 30,
      }),
    ]);

    return {
      message,
      projects,
      recentTriage: observations,
      signalRules: rules,
    };
  });
};
