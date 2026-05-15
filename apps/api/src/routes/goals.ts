import type { FastifyPluginAsync } from 'fastify';
import {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  linkTask,
  unlinkTask,
  setGoalCategories,
  addGoalPrerequisite,
  removeGoalPrerequisite,
} from '../services/goals.js';

const GoalInputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    description: { type: ['string', 'null'] },
    primaryCategoryId: { type: ['string', 'null'] },
    targetDate: { type: ['string', 'null'], format: 'date-time' },
    targetValue: { type: ['integer', 'null'] },
    archived: { type: 'boolean' },
    completed: { type: 'boolean' },
    weight: { type: 'integer', minimum: 1, maximum: 10 },
  },
  additionalProperties: false,
} as const;

const GoalCategoriesSchema = {
  type: 'object',
  required: ['mappings'],
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['categoryId', 'isPrimary', 'percentage'],
        properties: {
          categoryId: { type: 'string' },
          isPrimary: { type: 'boolean' },
          percentage: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
    },
  },
} as const;

export const goalRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Querystring: { includeArchived?: string } }>('/api/goals', async (req) => {
    const goals = await listGoals(req.user.userId, req.query.includeArchived === 'true');
    return { goals };
  });

  app.get<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const goal = await getGoal(req.user.userId, req.params.id);
    if (!goal) return reply.notFound();
    return { goal };
  });

  app.post(
    '/api/goals',
    { schema: { body: { ...GoalInputSchema, required: ['title'] } } },
    async (req: any) => {
      const goal = await createGoal(req.user.userId, req.body);
      return { goal };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/api/goals/:id',
    { schema: { body: GoalInputSchema } },
    async (req: any, reply) => {
      const goal = await updateGoal(req.user.userId, req.params.id, req.body);
      if (!goal) return reply.notFound();
      return { goal };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/goals/:id', async (req, reply) => {
    const ok = await deleteGoal(req.user.userId, req.params.id);
    if (!ok) return reply.notFound();
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { taskId: string } }>(
    '/api/goals/:id/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const ok = await linkTask(req.user.userId, req.params.id, req.body.taskId);
      if (!ok) return reply.notFound();
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string; taskId: string } }>(
    '/api/goals/:id/tasks/:taskId',
    async (req, reply) => {
      const ok = await unlinkTask(req.user.userId, req.params.id, req.params.taskId);
      if (!ok) return reply.notFound();
      return { ok: true };
    }
  );

  app.put<{
    Params: { id: string };
    Body: { mappings: { categoryId: string; isPrimary: boolean; percentage: number }[] };
  }>(
    '/api/goals/:id/categories',
    { schema: { body: GoalCategoriesSchema } },
    async (req, reply) => {
      try {
        const goal = await setGoalCategories(req.user.userId, req.params.id, req.body.mappings);
        if (!goal) return reply.notFound();
        return { goal };
      } catch (err) {
        return reply.badRequest(err instanceof Error ? err.message : 'Bad request');
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { prerequisiteId: string } }>(
    '/api/goals/:id/prerequisites',
    {
      schema: {
        body: {
          type: 'object',
          required: ['prerequisiteId'],
          properties: { prerequisiteId: { type: 'string' } },
        },
      },
    },
    async (req, reply) => {
      const result = await addGoalPrerequisite(
        req.user.userId,
        req.params.id,
        req.body.prerequisiteId
      );
      if ('error' in result) return reply.badRequest(result.error);
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string; prerequisiteId: string } }>(
    '/api/goals/:id/prerequisites/:prerequisiteId',
    async (req, reply) => {
      const ok = await removeGoalPrerequisite(
        req.user.userId,
        req.params.id,
        req.params.prerequisiteId
      );
      if (!ok) return reply.notFound();
      return { ok: true };
    }
  );
};
