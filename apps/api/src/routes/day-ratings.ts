// /api/day-ratings — daily 1-5 self-rating CRUD.
// Date is a YYYY-MM-DD string in user tz to dodge UTC-rollover issues.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { env } from '../env.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.userTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const dayRatingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // List recent ratings (default last 60 days).
  app.get<{ Querystring: { days?: string } }>('/api/day-ratings', async (req) => {
    const days = Math.min(365, parseInt(req.query.days ?? '60', 10));
    const cutoffDate = new Date(Date.now() - days * 86_400_000);
    const cutoffKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: env.userTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(cutoffDate);

    const ratings = await prisma.dayRating.findMany({
      where: { userId: req.user.userId, dateKey: { gte: cutoffKey } },
      orderBy: { dateKey: 'desc' },
    });
    return { ratings, today: todayKey() };
  });

  // Upsert a rating for a given date (or today if omitted).
  app.post<{
    Body: { dateKey?: string; rating: number; note?: string | null };
  }>(
    '/api/day-ratings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['rating'],
          properties: {
            dateKey: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            rating: { type: 'integer', minimum: 1, maximum: 5 },
            note: { type: ['string', 'null'], maxLength: 1000 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const dateKey = req.body.dateKey ?? todayKey();
      if (!DATE_RE.test(dateKey)) return reply.badRequest('Invalid dateKey');
      const rating = await prisma.dayRating.upsert({
        where: { userId_dateKey: { userId: req.user.userId, dateKey } },
        update: { rating: req.body.rating, note: req.body.note ?? null },
        create: {
          userId: req.user.userId,
          dateKey,
          rating: req.body.rating,
          note: req.body.note ?? null,
        },
      });
      return { rating };
    }
  );

  // Delete a rating (rare — but useful if user mis-tapped).
  app.delete<{ Params: { dateKey: string } }>(
    '/api/day-ratings/:dateKey',
    async (req, reply) => {
      if (!DATE_RE.test(req.params.dateKey)) return reply.badRequest('Invalid dateKey');
      await prisma.dayRating.deleteMany({
        where: { userId: req.user.userId, dateKey: req.params.dateKey },
      });
      return { ok: true };
    }
  );
};
