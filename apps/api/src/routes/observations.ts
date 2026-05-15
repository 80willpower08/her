// CRUD for Observation rows — the "what the agent knows about you" memory.
//
// All user-facing. The MCP server has its own write paths (record/supersede/
// archive) for the agent.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';

const KINDS = ['FACT', 'PATTERN', 'PREFERENCE', 'COMMITMENT', 'INSIGHT', 'CONCERN'] as const;
type Kind = (typeof KINDS)[number];

const PatchSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 4000 },
    kind: { type: 'string', enum: KINDS as unknown as string[] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    expiresAt: { type: ['string', 'null'] },
    enforceLevel: { type: 'string', enum: ['NORMAL', 'BLOCK'] },
    confirmedByUser: { type: 'boolean' },
    archived: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const CreateSchema = {
  type: 'object',
  required: ['kind', 'subject', 'body'],
  properties: {
    kind: { type: 'string', enum: KINDS as unknown as string[] },
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 4000 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    expiresAt: { type: ['string', 'null'] },
    enforceLevel: { type: 'string', enum: ['NORMAL', 'BLOCK'] },
    relatedCategoryIds: { type: 'array', items: { type: 'string' } },
    relatedGoalIds: { type: 'array', items: { type: 'string' } },
    relatedTaskIds: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const;

export const observationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // List — default: only current (not superseded, not archived, not expired).
  // ?includeArchived=true / ?includeSuperseded=true to widen.
  app.get<{
    Querystring: {
      kind?: string;
      includeArchived?: string;
      includeSuperseded?: string;
      limit?: string;
    };
  }>('/api/observations', async (req) => {
    const includeArchived = req.query.includeArchived === 'true';
    const includeSuperseded = req.query.includeSuperseded === 'true';
    const limit = Math.min(500, parseInt(req.query.limit ?? '300', 10));
    const kindFilter = req.query.kind && KINDS.includes(req.query.kind as Kind)
      ? (req.query.kind as Kind)
      : undefined;

    const now = new Date();
    const observations = await prisma.observation.findMany({
      where: {
        userId: req.user.userId,
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(includeArchived ? {} : { archived: false }),
        ...(includeSuperseded ? {} : { supersededAt: null }),
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return { observations };
  });

  // User-initiated create — usually agent records via MCP, but the /about-me
  // page lets the user add their own.
  app.post<{
    Body: {
      kind: Kind;
      subject: string;
      body: string;
      confidence?: number;
      expiresAt?: string | null;
      enforceLevel?: 'NORMAL' | 'BLOCK';
      relatedCategoryIds?: string[];
      relatedGoalIds?: string[];
      relatedTaskIds?: string[];
    };
  }>('/api/observations', { schema: { body: CreateSchema } }, async (req) => {
    const obs = await prisma.observation.create({
      data: {
        userId: req.user.userId,
        kind: req.body.kind,
        subject: req.body.subject,
        body: req.body.body,
        confidence: req.body.confidence ?? 1.0,
        source: 'user_directive',
        relatedCategoryIds: req.body.relatedCategoryIds ?? [],
        relatedGoalIds: req.body.relatedGoalIds ?? [],
        relatedTaskIds: req.body.relatedTaskIds ?? [],
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : null,
        enforceLevel: req.body.enforceLevel ?? 'NORMAL',
        confirmedByUser: true, // user-created => already confirmed
      },
    });
    return { observation: obs };
  });

  app.patch<{
    Params: { id: string };
    Body: {
      subject?: string;
      body?: string;
      kind?: Kind;
      confidence?: number;
      expiresAt?: string | null;
      enforceLevel?: 'NORMAL' | 'BLOCK';
      confirmedByUser?: boolean;
      archived?: boolean;
    };
  }>('/api/observations/:id', { schema: { body: PatchSchema } }, async (req, reply) => {
    const existing = await prisma.observation.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();
    const updated = await prisma.observation.update({
      where: { id: req.params.id },
      data: {
        subject: req.body.subject,
        body: req.body.body,
        kind: req.body.kind,
        confidence: req.body.confidence,
        expiresAt:
          req.body.expiresAt === undefined
            ? undefined
            : req.body.expiresAt
              ? new Date(req.body.expiresAt)
              : null,
        enforceLevel: req.body.enforceLevel,
        confirmedByUser: req.body.confirmedByUser,
        archived: req.body.archived,
      },
    });
    return { observation: updated };
  });

  app.delete<{ Params: { id: string } }>('/api/observations/:id', async (req, reply) => {
    const existing = await prisma.observation.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();
    // Hard delete — user explicitly wanted it gone.
    await prisma.observation.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
};
