// CalendarSource: per-calendar labels + category mapping + hide flag.
// "Discovery" lists all distinct sourceCalendarIds the user has events from
// so the user can name and categorize each in Settings.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';

const SourceUpsertSchema = {
  type: 'object',
  required: ['externalAccountId', 'sourceCalendarId', 'label'],
  properties: {
    externalAccountId: { type: 'string' },
    sourceCalendarId: { type: 'string', minLength: 1, maxLength: 500 },
    label: { type: 'string', minLength: 1, maxLength: 100 },
    categoryId: { type: ['string', 'null'] },
    hidden: { type: 'boolean' },
    color: { type: ['string', 'null'], maxLength: 32 },
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

const SourcePatchSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 100 },
    categoryId: { type: ['string', 'null'] },
    hidden: { type: 'boolean' },
    color: { type: ['string', 'null'], maxLength: 32 },
    notes: { type: ['string', 'null'], maxLength: 2000 },
  },
  additionalProperties: false,
} as const;

export const calendarSourceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // List all known sources + auto-discovered unmapped calendars in one shot.
  app.get('/api/calendar-sources', async (req) => {
    const userId = req.user.userId;

    const sources = await prisma.calendarSource.findMany({
      where: { userId },
      orderBy: [{ label: 'asc' }],
    });

    // Auto-discovery: distinct (externalAccountId, sourceCalendarId) pairs from
    // CalendarEvent that don't yet have a CalendarSource row, with counts.
    const grouped = await prisma.calendarEvent.groupBy({
      by: ['externalAccountId', 'sourceCalendarId'],
      where: { userId },
      _count: { _all: true },
    });

    const known = new Set(sources.map((s) => `${s.externalAccountId}::${s.sourceCalendarId}`));
    const unmappedRaw = grouped.filter(
      (g) => !known.has(`${g.externalAccountId}::${g.sourceCalendarId}`)
    );

    // Pull 3 sample upcoming titles per unmapped calendar so the user can
    // recognize what it is at a glance.
    const samples = await Promise.all(
      unmappedRaw.map(async (u) => {
        const events = await prisma.calendarEvent.findMany({
          where: {
            externalAccountId: u.externalAccountId,
            sourceCalendarId: u.sourceCalendarId,
            startsAt: { gte: new Date() },
          },
          select: { title: true },
          orderBy: { startsAt: 'asc' },
          take: 3,
          distinct: ['title'],
        });
        return events.map((e) => e.title);
      })
    );

    const unmapped = unmappedRaw.map((g, i) => ({
      externalAccountId: g.externalAccountId,
      sourceCalendarId: g.sourceCalendarId,
      eventCount: g._count._all,
      sampleTitles: samples[i],
    }));

    // Decorate sources with event counts too
    const countByKey = new Map(
      grouped.map((g) => [`${g.externalAccountId}::${g.sourceCalendarId}`, g._count._all])
    );
    const decorated = sources.map((s) => ({
      ...s,
      eventCount: countByKey.get(`${s.externalAccountId}::${s.sourceCalendarId}`) ?? 0,
    }));

    return { sources: decorated, unmapped };
  });

  app.post<{
    Body: {
      externalAccountId: string;
      sourceCalendarId: string;
      label: string;
      categoryId?: string | null;
      hidden?: boolean;
      color?: string | null;
      notes?: string | null;
    };
  }>('/api/calendar-sources', { schema: { body: SourceUpsertSchema } }, async (req, reply) => {
    const { externalAccountId, sourceCalendarId, label, categoryId, hidden, color, notes } = req.body;

    const account = await prisma.externalAccount.findFirst({
      where: { id: externalAccountId, userId: req.user.userId },
      select: { id: true },
    });
    if (!account) return reply.badRequest('Unknown externalAccountId');

    if (categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: categoryId, userId: req.user.userId },
        select: { id: true },
      });
      if (!cat) return reply.badRequest('Unknown categoryId');
    }

    const source = await prisma.calendarSource.upsert({
      where: { externalAccountId_sourceCalendarId: { externalAccountId, sourceCalendarId } },
      update: {
        label,
        categoryId: categoryId ?? null,
        hidden: hidden ?? undefined,
        color: color ?? null,
        notes: notes ?? null,
      },
      create: {
        userId: req.user.userId,
        externalAccountId,
        sourceCalendarId,
        label,
        categoryId: categoryId ?? null,
        hidden: hidden ?? false,
        color: color ?? null,
        notes: notes ?? null,
      },
    });
    return { source };
  });

  app.patch<{
    Params: { id: string };
    Body: {
      label?: string;
      categoryId?: string | null;
      hidden?: boolean;
      color?: string | null;
      notes?: string | null;
    };
  }>('/api/calendar-sources/:id', { schema: { body: SourcePatchSchema } }, async (req, reply) => {
    const existing = await prisma.calendarSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      select: { id: true },
    });
    if (!existing) return reply.notFound();

    if (req.body.categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: req.body.categoryId, userId: req.user.userId },
        select: { id: true },
      });
      if (!cat) return reply.badRequest('Unknown categoryId');
    }

    const source = await prisma.calendarSource.update({
      where: { id: req.params.id },
      data: {
        label: req.body.label,
        categoryId: req.body.categoryId === undefined ? undefined : req.body.categoryId,
        hidden: req.body.hidden,
        color: req.body.color === undefined ? undefined : req.body.color,
        notes: req.body.notes === undefined ? undefined : req.body.notes,
      },
    });
    return { source };
  });

  app.delete<{ Params: { id: string } }>('/api/calendar-sources/:id', async (req, reply) => {
    const existing = await prisma.calendarSource.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      select: { id: true },
    });
    if (!existing) return reply.notFound();
    await prisma.calendarSource.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
};
