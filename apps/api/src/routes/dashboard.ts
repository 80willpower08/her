import type { FastifyPluginAsync } from 'fastify';
import { buildDashboardMetrics } from '../services/dashboard.js';

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Querystring: { windowDays?: string } }>('/api/dashboard', async (req) => {
    const w = parseInt(req.query.windowDays ?? '30', 10);
    const windowDays = Number.isFinite(w) && w > 0 && w <= 365 ? w : 30;
    const metrics = await buildDashboardMetrics(req.user.userId, windowDays);
    return { metrics };
  });
};
