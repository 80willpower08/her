// /api/today-curation — read endpoint for the Today page.
// Writes happen via the MCP tool `set_today_curation` during agent runs.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';

export const todayCurationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/today-curation', async (req) => {
    const curation = await prisma.todayCuration.findUnique({
      where: { userId: req.user.userId },
    });
    if (!curation) {
      return { curation: null };
    }
    return {
      curation: {
        headline: curation.headline,
        pinned: curation.pinned,
        sourceRunId: curation.sourceRunId,
        updatedAt: curation.updatedAt.toISOString(),
      },
    };
  });

  // Manual reset — user can clear the curation if they want a fresh one next run.
  app.delete('/api/today-curation', async (req) => {
    await prisma.todayCuration.deleteMany({
      where: { userId: req.user.userId },
    });
    return { ok: true };
  });
};
