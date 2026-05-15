import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { ingestGoogleCalendar } from '../services/calendar-ingestion.js';

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // Events in a window. Defaults: from now to +14 days.
  // ?includeHidden=true to also return user-hidden events (for the unhide UX).
  app.get<{
    Querystring: { from?: string; to?: string; accountId?: string; includeHidden?: string };
  }>(
    '/api/calendar',
    async (req) => {
      const from = req.query.from ? new Date(req.query.from) : new Date();
      const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 14 * 86_400_000);
      const includeHidden = req.query.includeHidden === 'true';

      const rawEvents = await prisma.calendarEvent.findMany({
        where: {
          userId: req.user.userId,
          startsAt: { lt: to },
          endsAt: { gt: from },
          status: { not: 'CANCELLED' },
          ...(includeHidden ? {} : { userHidden: false }),
          ...(req.query.accountId ? { externalAccountId: req.query.accountId } : {}),
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          externalAccountId: true,
          sourceEventId: true,
          sourceCalendarId: true,
          iCalUid: true,
          title: true,
          description: true,
          location: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          isRecurring: true,
          htmlLink: true,
          status: true,
          transparency: true,
          userHidden: true,
          createdAt: true,
        },
      });

      // Cross-calendar dedup: same meeting invited to multiple of the user's
      // calendars carries the same iCalUid. Keep one copy per
      // (iCalUid, startsAt) tuple. Preference order:
      //   1. Event whose calendar has an explicit CalendarSource mapping
      //   2. Otherwise: earliest-created (stable arbitrary pick)
      const sources = await prisma.calendarSource.findMany({
        where: { userId: req.user.userId },
        select: { externalAccountId: true, sourceCalendarId: true },
      });
      const mappedKey = new Set(
        sources.map((s) => `${s.externalAccountId}::${s.sourceCalendarId ?? ''}`)
      );
      const isMapped = (e: { externalAccountId: string; sourceCalendarId: string | null }) =>
        mappedKey.has(`${e.externalAccountId}::${e.sourceCalendarId ?? ''}`);

      const byDupKey = new Map<string, typeof rawEvents[number]>();
      for (const e of rawEvents) {
        if (!e.iCalUid) {
          byDupKey.set(`__nodupkey__${e.id}`, e);
          continue;
        }
        const k = `${e.iCalUid}::${e.startsAt.getTime()}`;
        const existing = byDupKey.get(k);
        if (!existing) {
          byDupKey.set(k, e);
          continue;
        }
        // Prefer the one in a mapped calendar; fall back to oldest createdAt.
        const existingMapped = isMapped(existing);
        const candidateMapped = isMapped(e);
        if (candidateMapped && !existingMapped) {
          byDupKey.set(k, e);
        } else if (candidateMapped === existingMapped && e.createdAt < existing.createdAt) {
          byDupKey.set(k, e);
        }
      }
      const events = [...byDupKey.values()].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
      );

      // Include account color so the UI can render consistently
      const accountIds = [...new Set(events.map((e) => e.externalAccountId))];
      const accounts = await prisma.externalAccount.findMany({
        where: { id: { in: accountIds }, userId: req.user.userId },
        select: { id: true, color: true, displayName: true, accountEmail: true },
      });

      return { events, accounts };
    }
  );

  // Toggle user-hidden flag on a single calendar event.
  app.patch<{ Params: { id: string }; Body: { userHidden: boolean } }>(
    '/api/calendar-events/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userHidden'],
          properties: { userHidden: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const event = await prisma.calendarEvent.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!event) return reply.notFound();
      const updated = await prisma.calendarEvent.update({
        where: { id: req.params.id },
        data: { userHidden: req.body.userHidden },
        select: { id: true, userHidden: true },
      });
      return { event: updated };
    }
  );

  // Manual trigger: useful right after connecting an account.
  app.post<{ Params: { id: string } }>(
    '/api/accounts/:id/sync',
    async (req, reply) => {
      const account = await prisma.externalAccount.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!account) return reply.notFound();
      if (account.provider !== 'GOOGLE' || account.kind !== 'OAUTH') {
        return reply.badRequest('Only Google OAuth accounts supported in Phase 2');
      }
      const result = await ingestGoogleCalendar(account);
      return { result };
    }
  );
};
