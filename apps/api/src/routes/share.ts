// Share-target ingestion: receives manually-shared payloads from the PWA's
// service worker AND external ingestors (e.g. Tasker on phone for SMS), and
// stores them as EmailMessage rows for triage.

import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { SINGLE_USER_ID } from '../auth.js';
import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { processNewMessage } from '../services/signal-rules.js';

const ShareInputSchema = {
  type: 'object',
  required: [],
  properties: {
    title: { type: 'string', maxLength: 500 },
    text: { type: 'string', maxLength: 20000 },
    url: { type: 'string', maxLength: 2000 },
    receivedAt: { type: 'string', format: 'date-time' },
    externalAccountId: { type: ['string', 'null'] },
    // Explicit source. Defaults to SHARED if omitted.
    source: { type: 'string', enum: ['SHARED', 'SMS', 'NOTIFICATION'] },
    // For SMS (and other future external ingests) the caller knows the
    // sender directly — phone number / contact name from Android.
    fromAddress: { type: 'string', maxLength: 300 },
    fromName: { type: 'string', maxLength: 200 },
    // For NOTIFICATION source: which Android app posted it. Stored as
    // labels so the agent can disambiguate notification snippets from
    // full-body Gmail/Outlook messages.
    sourcePackage: { type: 'string', maxLength: 200 },
    sourceAppLabel: { type: 'string', maxLength: 100 },
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
  // POST /api/share allows two auth modes:
  //   1. JWT (PWA share-target flow from the browser)
  //   2. X-Ingest-Token (Tasker SMS forward, other server-to-server clients)
  async function shareIngestAuth(req: FastifyRequest, reply: FastifyReply) {
    const headerToken = req.headers['x-ingest-token'];
    if (
      env.ingestToken &&
      typeof headerToken === 'string' &&
      headerToken === env.ingestToken
    ) {
      // Synthesize req.user so the handler reads identically to JWT auth.
      (req as unknown as { user: { userId: string; username: string } }).user = {
        userId: SINGLE_USER_ID,
        username: env.adminUsername,
      };
      return;
    }
    try {
      await req.jwtVerify();
    } catch {
      return reply.unauthorized('Authentication required');
    }
  }

  app.post<{
    Body: {
      title?: string;
      text?: string;
      url?: string;
      receivedAt?: string;
      externalAccountId?: string | null;
      source?: 'SHARED' | 'SMS' | 'NOTIFICATION';
      fromAddress?: string;
      fromName?: string;
      sourcePackage?: string;
      sourceAppLabel?: string;
    };
  }>(
    '/api/share',
    { schema: { body: ShareInputSchema }, preHandler: shareIngestAuth },
    async (req, reply) => {
      const {
        title = '',
        text = '',
        url = '',
        receivedAt,
        externalAccountId,
        source = 'SHARED',
        fromAddress,
        fromName,
        sourcePackage,
        sourceAppLabel,
      } = req.body;

      if (!title.trim() && !text.trim() && !url.trim()) {
        return reply.badRequest('Empty share payload');
      }

      // If the caller supplied an explicit sender, use it. Otherwise fall back
      // to extracting from the body (legacy "from foo@bar.com" pattern).
      const sender = fromAddress
        ? { name: fromName ?? null, address: fromAddress }
        : inferFromAddress(text);

      const subject =
        title.trim() || (text.split('\n')[0] || '').slice(0, 200) || '(shared item)';

      if (externalAccountId) {
        const owns = await prisma.externalAccount.findFirst({
          where: { id: externalAccountId, userId: req.user.userId },
          select: { id: true },
        });
        if (!owns) return reply.badRequest('Unknown externalAccountId');
      }

      // Build labels: always include the source tag, plus package/app
      // identifiers for NOTIFICATION rows so the agent can tell Teams from
      // Gmail-notification snippets etc.
      const labels: string[] = [source];
      if (sourcePackage) labels.push(`package:${sourcePackage}`);
      if (sourceAppLabel) labels.push(`app:${sourceAppLabel}`);

      const message = await prisma.emailMessage.create({
        data: {
          userId: req.user.userId,
          externalAccountId: externalAccountId ?? null,
          source,
          sourceMessageId: randomUUID(),
          fromAddress: sender.address,
          fromName: sender.name,
          toAddresses: [],
          subject,
          snippet: text.slice(0, 200) || null,
          bodyText: text || null,
          sourceUrl: url || null,
          labels,
          isUnread: true,
          triageStatus: 'PENDING',
          receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
        },
      });

      // Apply signal-rules: stamps importance + extra labels, and fires an
      // immediate phone push if a rule matched with HIGH/URGENT.
      await processNewMessage(message.id, req.user.userId, {
        source,
        fromAddress: sender.address,
        fromName: sender.name,
        toAddresses: [],
        subject,
        bodyText: text || null,
        labels,
      });

      // Return the latest state (importance/labels may have been updated).
      const final = await prisma.emailMessage.findUnique({ where: { id: message.id } });
      return { share: final };
    }
  );

  // ── Everything below is JWT-only. ─────────────────────────────────────
  app.register(async (jwt) => {
    jwt.addHook('preHandler', app.authenticate);

    jwt.get<{ Params: { id: string } }>('/api/share/:id', async (req, reply) => {
      const message = await prisma.emailMessage.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!message) return reply.notFound();
      return { share: message };
    });

    jwt.get('/api/share/pending', async (req) => {
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

    // Unified inbox: ingested emails + manually-shared items + SMS.
    jwt.get<{
      Querystring: {
        status?: 'pending' | 'all';
        source?: 'GMAIL' | 'OUTLOOK' | 'SHARED' | 'SMS' | 'NOTIFICATION' | 'all';
        accountId?: string;
        limit?: string;
      };
    }>('/api/messages', async (req) => {
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);
      const where: {
        userId: string;
        triageStatus?: 'PENDING';
        source?: 'GMAIL' | 'OUTLOOK' | 'SHARED' | 'SMS' | 'NOTIFICATION';
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

    jwt.patch<{
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
  });
};
