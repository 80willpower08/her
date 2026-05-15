import type { FastifyPluginAsync } from 'fastify';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  uncompleteTask,
  addPrerequisite,
  removePrerequisite,
} from '../services/tasks.js';

const TaskInputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 500 },
    description: { type: ['string', 'null'] },
    categoryId: { type: ['string', 'null'] },
    priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    weight: { type: 'integer', minimum: 1, maximum: 10 },
    dueDate: { type: ['string', 'null'], format: 'date-time' },
    scheduledFor: { type: ['string', 'null'], format: 'date-time' },
    estimatedMinutes: { type: ['integer', 'null'], minimum: 0 },
    parentId: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    notes: { type: ['string', 'null'] },
    linkedCalendarEventId: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const;

export const taskRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get<{
    Querystring: { view?: 'today' | 'all'; categoryId?: string; goalId?: string; includeSubtasks?: string };
  }>('/api/tasks', async (req) => {
    const tasks = await listTasks(req.user.userId, {
      view: req.query.view,
      categoryId: req.query.categoryId,
      goalId: req.query.goalId,
      includeSubtasks: req.query.includeSubtasks === 'true',
    });
    return { tasks };
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const task = await getTask(req.user.userId, req.params.id);
    if (!task) return reply.notFound();
    return { task };
  });

  app.post(
    '/api/tasks',
    { schema: { body: { ...TaskInputSchema, required: ['title'] } } },
    async (req: any) => {
      const task = await createTask(req.user.userId, req.body);
      return { task };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/api/tasks/:id',
    { schema: { body: TaskInputSchema } },
    async (req: any, reply) => {
      const task = await updateTask(req.user.userId, req.params.id, req.body);
      if (!task) return reply.notFound();
      return { task };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req, reply) => {
    const ok = await deleteTask(req.user.userId, req.params.id);
    if (!ok) return reply.notFound();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/complete', async (req, reply) => {
    const result = await completeTask(req.user.userId, req.params.id);
    if ('blockedBy' in result) return reply.conflict(`Blocked by: ${result.blockedBy.join(', ')}`);
    return { task: result.task };
  });

  app.post<{ Params: { id: string } }>('/api/tasks/:id/uncomplete', async (req, reply) => {
    const task = await uncompleteTask(req.user.userId, req.params.id);
    if (!task) return reply.notFound();
    return { task };
  });

  app.post<{
    Params: { id: string };
    Body: { prerequisiteId: string };
  }>(
    '/api/tasks/:id/prerequisites',
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
      const result = await addPrerequisite(req.user.userId, req.params.id, req.body.prerequisiteId);
      if ('error' in result) return reply.badRequest(result.error);
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string; prerequisiteId: string } }>(
    '/api/tasks/:id/prerequisites/:prerequisiteId',
    async (req, reply) => {
      const ok = await removePrerequisite(req.user.userId, req.params.id, req.params.prerequisiteId);
      if (!ok) return reply.notFound();
      return { ok: true };
    }
  );
};
