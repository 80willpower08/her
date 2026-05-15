import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { buildAgentContext, executeProposedAction } from '../services/agent.js';
import { agentRunQueue } from '../lib/queue.js';

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Querystring: { limit?: string } }>('/api/agent-runs', async (req) => {
    const limit = Math.min(50, parseInt(req.query.limit ?? '20', 10));
    const runs = await prisma.agentRun.findMany({
      where: { userId: req.user.userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        proposedActions: {
          select: {
            id: true,
            kind: true,
            mode: true,
            status: true,
            targetType: true,
            targetId: true,
            rationale: true,
          },
        },
      },
    });
    return { runs };
  });

  app.get<{ Params: { id: string } }>('/api/agent-runs/:id', async (req, reply) => {
    const run = await prisma.agentRun.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: { proposedActions: true },
    });
    if (!run) return reply.notFound();
    return { run };
  });

  app.get<{ Querystring: { status?: string } }>('/api/proposed-actions', async (req) => {
    const status = req.query.status?.toUpperCase();
    const actions = await prisma.proposedAction.findMany({
      where: {
        userId: req.user.userId,
        ...(status ? { status: status as 'PENDING' | 'APPROVED' | 'DENIED' | 'EXECUTED' | 'EXPIRED' | 'FAILED' } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        agentRun: { select: { id: true, kind: true, startedAt: true } },
      },
    });
    return { actions };
  });

  app.post<{ Params: { id: string } }>('/api/proposed-actions/:id/approve', async (req, reply) => {
    const action = await prisma.proposedAction.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!action) return reply.notFound();
    if (action.status !== 'PENDING') {
      return reply.badRequest(`Action is ${action.status.toLowerCase()}, not pending`);
    }

    await prisma.proposedAction.update({
      where: { id: action.id },
      data: { status: 'APPROVED', decidedAt: new Date() },
    });
    const result = await executeProposedAction(action);
    if ('error' in result) {
      const failed = await prisma.proposedAction.update({
        where: { id: action.id },
        data: { status: 'FAILED', error: result.error },
      });
      return reply.badRequest(result.error).send({ action: failed });
    }
    const executed = await prisma.proposedAction.update({
      where: { id: action.id },
      data: { status: 'EXECUTED', executedAt: new Date() },
    });
    return { action: executed };
  });

  app.post<{ Params: { id: string } }>('/api/proposed-actions/:id/deny', async (req, reply) => {
    const action = await prisma.proposedAction.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!action) return reply.notFound();
    if (action.status !== 'PENDING') {
      return reply.badRequest(`Action is ${action.status.toLowerCase()}, not pending`);
    }
    const denied = await prisma.proposedAction.update({
      where: { id: action.id },
      data: { status: 'DENIED', decidedAt: new Date() },
    });
    return { action: denied };
  });

  // Manual trigger — enqueues a job that the agent container consumes.
  app.post<{ Body: { kind?: 'PRIORITIZATION' } }>('/api/agent/run', async (req) => {
    const kind = req.body?.kind ?? 'PRIORITIZATION';
    const job = await agentRunQueue.add(
      'run',
      { userId: req.user.userId, kind, trigger: 'manual' },
      { removeOnComplete: 20, removeOnFail: 20 }
    );
    return { queued: true, jobId: job.id, kind };
  });
};
