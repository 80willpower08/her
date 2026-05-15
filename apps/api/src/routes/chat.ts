// Entity-anchored agent chat. One thread per (user, anchor entity).
// Posting a user message enqueues a CHAT agent run; the web client polls the
// thread or the run for completion.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { agentRunQueue } from '../lib/queue.js';

const VALID_ANCHORS = [
  'task',
  'goal',
  'event',
  'message',
  'proposed_action',
  'category',
  'project',
  'general',
] as const;
type AnchorType = (typeof VALID_ANCHORS)[number];

const PostMessageSchema = {
  type: 'object',
  required: ['body'],
  properties: {
    body: { type: 'string', minLength: 1, maxLength: 8000 },
  },
  additionalProperties: false,
} as const;

const ResolveSchema = {
  type: 'object',
  required: ['anchorType'],
  properties: {
    anchorType: { type: 'string', enum: VALID_ANCHORS as unknown as string[] },
    anchorId: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const;

async function getOrCreateThread(userId: string, anchorType: AnchorType, anchorId: string | null) {
  // Prisma compound unique with nullable: query first since null can't be used in
  // the unique where input.
  const existing = await prisma.chatThread.findFirst({
    where: { userId, anchorType, anchorId },
  });
  if (existing) return existing;
  return prisma.chatThread.create({
    data: { userId, anchorType, anchorId },
  });
}

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // Get-or-create the thread for an anchor.
  app.post<{
    Body: { anchorType: AnchorType; anchorId?: string | null };
  }>(
    '/api/chat-threads/resolve',
    { schema: { body: ResolveSchema } },
    async (req) => {
      const anchorType = req.body.anchorType;
      const anchorId = req.body.anchorId ?? null;
      const thread = await getOrCreateThread(req.user.userId, anchorType, anchorId);
      return { thread };
    }
  );

  // List threads (recently updated first).
  app.get('/api/chat-threads', async (req) => {
    const threads = await prisma.chatThread.findMany({
      where: { userId: req.user.userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return { threads };
  });

  // Create a new general-anchor thread (multi-thread on /chat page).
  app.post<{ Body: { anchorType: 'general'; title?: string | null } }>(
    '/api/chat-threads',
    {
      schema: {
        body: {
          type: 'object',
          required: ['anchorType'],
          properties: {
            anchorType: { type: 'string', enum: ['general'] },
            title: { type: ['string', 'null'], maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      // General threads use a randomly-generated anchorId so multiple can
      // coexist (the unique constraint is on userId+anchorType+anchorId).
      const anchorId = crypto.randomUUID();
      const thread = await prisma.chatThread.create({
        data: {
          userId: req.user.userId,
          anchorType: 'general',
          anchorId,
          title: req.body.title ?? null,
        },
      });
      return { thread };
    }
  );

  // Rename / patch a thread.
  app.patch<{ Params: { id: string }; Body: { title?: string | null } }>(
    '/api/chat-threads/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: ['string', 'null'], maxLength: 200 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const existing = await prisma.chatThread.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!existing) return reply.notFound();
      const thread = await prisma.chatThread.update({
        where: { id: req.params.id },
        data: { title: req.body.title === undefined ? undefined : req.body.title },
      });
      return { thread };
    }
  );

  // Delete a thread.
  app.delete<{ Params: { id: string } }>(
    '/api/chat-threads/:id',
    async (req, reply) => {
      const existing = await prisma.chatThread.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!existing) return reply.notFound();
      await prisma.chatThread.delete({ where: { id: req.params.id } });
      return { ok: true };
    }
  );

  // Get a thread with its messages.
  app.get<{ Params: { id: string } }>(
    '/api/chat-threads/:id',
    async (req, reply) => {
      const thread = await prisma.chatThread.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!thread) return reply.notFound();
      return { thread };
    }
  );

  // Post a user message. Saves it, enqueues a CHAT agent run, returns
  // {message, agentRunId}. UI polls the run; on OK it refetches the thread
  // to pick up the agent's reply.
  app.post<{
    Params: { id: string };
    Body: { body: string };
  }>(
    '/api/chat-threads/:id/messages',
    { schema: { body: PostMessageSchema } },
    async (req, reply) => {
      const thread = await prisma.chatThread.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!thread) return reply.notFound();

      const userMessage = await prisma.chatMessage.create({
        data: {
          threadId: thread.id,
          role: 'USER',
          body: req.body.body.trim(),
        },
      });

      // bump updatedAt so the thread sorts to top
      await prisma.chatThread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });

      const job = await agentRunQueue.add(
        'chat',
        {
          userId: req.user.userId,
          kind: 'CHAT',
          trigger: `chat:${thread.id}`,
          chatThreadId: thread.id,
          userMessageId: userMessage.id,
        },
        { removeOnComplete: 50, removeOnFail: 50 }
      );

      return { message: userMessage, jobId: job.id };
    }
  );
};
