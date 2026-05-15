import type { FastifyPluginAsync } from 'fastify';
import { buildOverview } from '../services/overview.js';
import { buildPatterns } from '../services/patterns.js';

export const overviewRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/overview', async (req) => {
    return buildOverview(req.user.userId);
  });

  app.get<{ Querystring: { windowDays?: string } }>('/api/patterns', async (req) => {
    const days = req.query.windowDays ? parseInt(req.query.windowDays, 10) : undefined;
    return buildPatterns(req.user.userId, days);
  });
};
