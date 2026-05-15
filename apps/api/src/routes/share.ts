// Share-target ingestion: receives manually-shared payloads from the PWA's
// service worker and stores them as EmailMessage rows for triage.

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';

const ShareInputSchema = {
  type: 'object',
  required: [],
  properties: {
    title: { type: 'string', maxLength: 500 },
    text: { type: 'string', maxLength: 20000 },
    url: { type: 'string', maxLength: 2000 },
    receivedAt: { type: 'string', format: 'date-time' },
    externalAccountId: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const;

const TriageInputSchema = {
  type: 'object',
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['CONVERTED_TO_TASK', 'ATTACHED_TO_GOAL', 'NOTED', 'DISCARDED'],
    },
    externalAccountId: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const;

const SENDER_RE = /from\s+([^\s<]+@[^\s>]+)/i;

function inferFromAddress(text: string): { name: string | null; address: string } {
  const m = text.match(SENDER_RE);
  if (m) return { name: null, address: m[1] };
  return { name: null, address: 'shared' };
}

export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.post<{
    Body: {
      title?: string;
      text?: string;
      url?: string;
      receivedAt?: string;
      externalAccountId?: string | null;
    };
  }>('/api/share', { schema: { body: ShareInputSchema } }, async (req, reply) => {
    const { title = '', text = '', url = '', receivedAt, externalAccountId } = req.body;

    if (!title.trim() && !text.trim() && !url.trim()) {
      return reply.badRequest('Empty share payload');
    }

    const sender = inferFromAddress(text);
    const subject = title.trim() || (text.split('\n')[0] || '').slice(0, 200) || '(shared item)';

    if (externalAccountId) {
      const owns = await prisma.externalAccount.findFirst({
        where: { id: externalAccountId, userId: req.user.userId },
        select: { id: true },
      });
      if (!owns) return reply.badRequest('Unknown externalAccountId');
    }

    const message = await prisma.emailMessage.create({
      data: {
        userId: req.user.userId,
        externalAccountId: externalAccountId ?? null,
        source: 'SHARED',
        sourceMessageId: randomUUID(),
        fromAddress: sender.address,
        fromName: sender.name,
        toAddresses: [],
        subject,
        snippet: text.slice(0, 200) || null,
        bodyText: text || null,
        sourceUrl: url || null,
        labels: ['SHARED'],
        isUnread: true,
        triageStatus: 'PENDING',
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      },
    });

    return { share: message };
  });

  app.get<{ Params: { id: string } }>('/api/share/:id', async (req, reply) => {
    const message = await prisma.emailMessage.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!message) return reply.notFound();
    return { share: message };
  });

  app.get('/api/share/pending', async (req) => {
    const pending = await prisma.emailMessage.findMany({
      where: {
        userId: req.user.userId,
        triageStatus: 'PENDING',
      },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return { pending, count: pending.length };
  });

  // Unified inbox: ingested emails + manually-shared items.
  app.get<{
    Querystring: {
      status?: 'pending' | 'all';
      source?: 'GMAIL' | 'OUTLOOK' | 'SHARED' | 'all';
      accountId?: string;
      limit?: string;
    };
  }>('/api/messages', async (req) => {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
    const where: {
      userId: string;
      triageStatus?: 'PENDING';
      source?: 'GMAIL' | 'OUTLOOK' | 'SHARED';
      externalAccountId?: string;
    } = { userId: req.user.userId };

    if (req.query.status === 'pending') where.triageStatus = 'PENDING';
    if (req.query.source && req.query.source !== 'all') where.source = req.query.source;
    if (req.query.accountId) where.externalAccountId = req.query.accountId;

    const [messages, pendingCount, byStatus] = await Promise.all([
      prisma.emailMessage.findMany({
        where,
        orderBy: [{ triageStatus: 'asc' }, { receivedAt: 'desc' }],
        take: limit,
      }),
      prisma.emailMessage.count({
        where: { userId: req.user.userId, triageStatus: 'PENDING' },
      }),
      prisma.emailMessage.groupBy({
        by: ['source'],
        where: { userId: req.user.userId },
        _count: { _all: true },
      }),
    ]);

    return {
      messages,
      pendingCount,
      bySource: byStatus.map((b) => ({ source: b.source, count: b._count._all })),
    };
  });

  app.patch<{
    Params: { id: string };
    Body: {
      action: 'CONVERTED_TO_TASK' | 'ATTACHED_TO_GOAL' | 'NOTED' | 'DISCARDED';
      externalAccountId?: string | null;
    };
  }>('/api/share/:id', { schema: { body: TriageInputSchema } }, async (req, reply) => {
    const existing = await prisma.emailMessage.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      select: { id: true },
    });
    if (!existing) return reply.notFound();

    const message = await prisma.emailMessage.update({
      where: { id: req.params.id },
      data: {
        triageStatus: req.body.action,
        externalAccountId:
          req.body.externalAccountId !== undefined
            ? req.body.externalAccountId
            : undefined,
      },
    });
    return { share: message };
  });
};
